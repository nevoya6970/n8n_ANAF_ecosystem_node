import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { jsonParse, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { asNodeError } from '../shared/http';
import {
	clientFields,
	clientOperations,
	invoiceFields,
	invoiceOperations,
	resourceProperty,
} from './descriptions';
import {
	createThrottle,
	CREDENTIAL_TYPE,
	responseBuffer,
	smartBillRequest,
	V1_MIN_INTERVAL_MS,
} from './smartBillApi';

/** Accept `YYYY-MM-DD` or any ISO date-time and return `YYYY-MM-DD`. */
function toDate(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const text = String(value).trim();
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
	if (match) return match[1];
	const date = new Date(text);
	return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function compact(object: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(object)) {
		if (value === '' || value === undefined || value === null) continue;
		result[key] = value;
	}
	return result;
}

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

export class SmartBill implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SmartBill',
		name: 'smartBill',
		icon: { light: 'file:smartBill.svg', dark: 'file:smartBill.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create and manage invoices and look up clients in SmartBill Cloud',
		defaults: {
			name: 'SmartBill',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		properties: [
			resourceProperty,
			invoiceOperations,
			clientOperations,
			...invoiceFields,
			...clientFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials(CREDENTIAL_TYPE);
		const companyCif = String(credentials.companyCif ?? '').replace(/\s/g, '');
		const hasV3Token = typeof credentials.v3Token === 'string' && credentials.v3Token !== '';
		const throttle = createThrottle(V1_MIN_INTERVAL_MS);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const pairedItem = { item: i };

				if (resource === 'invoice') {
					const seriesName = (this.getNodeParameter('seriesName', i) as string).trim();
					const documentQuery = (): IDataObject => ({
						cif: companyCif,
						seriesname: seriesName,
						number: String(this.getNodeParameter('number', i)).trim(),
					});

					if (operation === 'create') {
						const productsInput = this.getNodeParameter('productsInput', i) as string;
						let products: IDataObject[];
						if (productsInput === 'json') {
							const raw = this.getNodeParameter('productsJson', i);
							const parsed = typeof raw === 'string' ? jsonParse<unknown>(raw) : raw;
							if (!Array.isArray(parsed) || parsed.length === 0) {
								throw new NodeOperationError(
									this.getNode(),
									'Products (JSON) must be a non-empty array',
									{ itemIndex: i },
								);
							}
							products = parsed as IDataObject[];
						} else {
							const collection = this.getNodeParameter('products', i, {}) as IDataObject;
							products = ((collection.product as IDataObject[] | undefined) ?? []).map(compact);
							if (products.length === 0) {
								throw new NodeOperationError(this.getNode(), 'Add at least one product', {
									itemIndex: i,
								});
							}
						}

						const clientFields = this.getNodeParameter('clientFields', i, {}) as IDataObject;
						const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						const body: IDataObject = compact({
							...additional,
							companyVatCode: companyCif,
							seriesName,
							client: compact({
								name: this.getNodeParameter('clientName', i) as string,
								country: this.getNodeParameter('clientCountry', i) as string,
								...clientFields,
							}),
							products,
							issueDate: toDate(additional.issueDate),
							dueDate: toDate(additional.dueDate),
							deliveryDate: toDate(additional.deliveryDate),
						});
						if (body.exchangeRate === 0) delete body.exchangeRate;

						const response = await smartBillRequest(this, i, throttle, {
							method: 'POST',
							path: '/invoice/v2',
							body,
							write: true,
						});
						returnData.push({ json: response.body as IDataObject, pairedItem });
						continue;
					}

					if (operation === 'getPdf') {
						const outputProperty = this.getNodeParameter('outputBinaryPropertyName', i) as string;
						const query = documentQuery();
						const response = await smartBillRequest(this, i, throttle, {
							method: 'GET',
							path: '/invoice/pdf',
							qs: query,
							binary: true,
						});
						const buffer = responseBuffer(response);
						if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
							throw new NodeOperationError(this.getNode(), 'SmartBill did not return a PDF', {
								itemIndex: i,
								description: buffer.subarray(0, 300).toString('utf8'),
							});
						}
						const fileName = `${seriesName}-${query.number as string}.pdf`;
						const binary = await this.helpers.prepareBinaryData(
							buffer,
							fileName,
							'application/pdf',
						);
						returnData.push({
							json: { seriesName, number: query.number, fileName, fileSize: buffer.length },
							binary: { [outputProperty]: binary },
							pairedItem,
						});
						continue;
					}

					if (operation === 'getPaymentStatus') {
						const response = await smartBillRequest(this, i, throttle, {
							method: 'GET',
							path: '/invoice/paymentstatus',
							qs: documentQuery(),
						});
						returnData.push({ json: response.body as IDataObject, pairedItem });
						continue;
					}

					if (operation === 'cancel' || operation === 'restore' || operation === 'delete') {
						const response = await smartBillRequest(this, i, throttle, {
							method: operation === 'delete' ? 'DELETE' : 'PUT',
							path: operation === 'delete' ? '/invoice' : `/invoice/${operation}`,
							qs: documentQuery(),
							write: true,
						});
						const query = documentQuery();
						returnData.push({
							json: {
								success: true,
								seriesName,
								number: query.number,
								...(response.body as IDataObject),
							},
							pairedItem,
						});
						continue;
					}

					if (operation === 'reverse') {
						const response = await smartBillRequest(this, i, throttle, {
							method: 'POST',
							path: '/invoice/reverse',
							body: compact({
								companyVatCode: companyCif,
								seriesName,
								number: String(this.getNodeParameter('number', i)).trim(),
								issueDate: toDate(this.getNodeParameter('reverseIssueDate', i, '')),
							}),
							write: true,
						});
						returnData.push({ json: response.body as IDataObject, pairedItem });
						continue;
					}

					if (operation === 'sendEmail') {
						const options = this.getNodeParameter('emailOptions', i, {}) as IDataObject;
						const body = compact({
							companyVatCode: companyCif,
							seriesName,
							number: String(this.getNodeParameter('number', i)).trim(),
							type: 'factura',
							to: options.to,
							cc: options.cc,
							bcc: options.bcc,
							subject: options.subject ? base64(String(options.subject)) : undefined,
							bodyText: options.bodyText ? base64(String(options.bodyText)) : undefined,
						});
						const response = await smartBillRequest(this, i, throttle, {
							method: 'POST',
							path: '/document/send',
							body,
							write: true,
						});
						returnData.push({ json: response.body as IDataObject, pairedItem });
						continue;
					}
				}

				if (resource === 'client') {
					if (!hasV3Token) {
						throw new NodeOperationError(
							this.getNode(),
							'Client operations use the SmartBill V3 API. Add the V3 Bearer token to the SmartBill credential.',
							{ itemIndex: i },
						);
					}
					const clientsPath = `/v3/companies/${encodeURIComponent(companyCif)}/clients`;

					if (operation === 'get') {
						const clientId = String(this.getNodeParameter('clientId', i)).trim();
						const response = await smartBillRequest(this, i, throttle, {
							method: 'GET',
							path: `${clientsPath}/${encodeURIComponent(clientId)}`,
						});
						returnData.push({ json: response.body as IDataObject, pairedItem });
						continue;
					}

					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
						const filters = compact(this.getNodeParameter('filters', i, {}) as IDataObject);
						const clients: IDataObject[] = [];
						let after: string | undefined;

						while (clients.length < limit) {
							const pageSize = Math.min(100, limit - clients.length);
							const response = await smartBillRequest(this, i, throttle, {
								method: 'GET',
								path: clientsPath,
								qs: compact({ ...filters, limit: pageSize, after }),
							});
							const body = (response.body ?? {}) as IDataObject;
							const page = (body.items as IDataObject[] | undefined) ?? [];
							clients.push(...page);
							const pagination = (body.pagination ?? {}) as IDataObject;
							const last = page[page.length - 1];
							if (!pagination.next || !last?.id) break;
							after = String(last.id);
						}

						for (const client of clients.slice(0, limit)) {
							returnData.push({ json: client, pairedItem });
						}
						continue;
					}
				}

				throw new NodeOperationError(
					this.getNode(),
					`Unsupported operation "${operation}" for resource "${resource}"`,
					{ itemIndex: i },
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw asNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
