import { randomUUID } from 'node:crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { jsonParse, NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { asNodeError } from '../shared/http';
import {
	clientFields,
	clientOperations,
	companyProperty,
	invoiceFields,
	invoiceOperations,
	resourceProperty,
} from './descriptions';
import { BASE_URL, createThrottle, CREDENTIAL_TYPE, oblioRequest } from './oblioApi';

const CLIENT_PAGE_SIZE = 250;
const INVOICE_PAGE_SIZE = 100;

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

/** Oblio expects 0/1 for boolean flags. */
function flags(object: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(object)) {
		result[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
	}
	return result;
}

export class Oblio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Oblio',
		name: 'oblio',
		icon: { light: 'file:oblio.svg', dark: 'file:oblio.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create and manage invoices and list clients in Oblio',
		defaults: {
			name: 'Oblio',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		properties: [
			resourceProperty,
			invoiceOperations,
			clientOperations,
			companyProperty,
			...invoiceFields,
			...clientFields,
		],
	};

	methods = {
		loadOptions: {
			async getCompanies(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				let response: IDataObject;
				try {
					response = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
						method: 'GET',
						baseURL: BASE_URL,
						url: '/nomenclature/companies',
						headers: { Accept: 'application/json' },
						json: true,
					})) as IDataObject;
				} catch (error) {
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}
				const companies = (response.data as IDataObject[] | undefined) ?? [];
				return companies.map((company) => ({
					name: `${company.company as string} (${company.cif as string})`,
					value: company.cif as string,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const throttle = createThrottle();

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const cif = String(this.getNodeParameter('cif', i)).trim();
				const pairedItem = { item: i };

				if (resource === 'invoice') {
					const seriesName = (this.getNodeParameter('seriesName', i, '') as string).trim();
					const number = (): string => String(this.getNodeParameter('number', i)).trim();

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
							products = ((collection.product as IDataObject[] | undefined) ?? []).map((product) =>
								flags(compact(product)),
							);
							if (products.length === 0) {
								throw new NodeOperationError(this.getNode(), 'Add at least one product', {
									itemIndex: i,
								});
							}
						}

						const clientFields = this.getNodeParameter('clientFields', i, {}) as IDataObject;
						const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						const body: IDataObject = flags(
							compact({
								...additional,
								cif,
								seriesName,
								client: flags(
									compact({
										name: this.getNodeParameter('clientName', i) as string,
										...clientFields,
									}),
								),
								products,
								issueDate: toDate(additional.issueDate),
								dueDate: toDate(additional.dueDate),
								deliveryDate: toDate(additional.deliveryDate),
								collectDate: toDate(additional.collectDate),
								idempotencyKey: (additional.idempotencyKey as string) || randomUUID(),
							}),
						);
						if (body.exchangeRate === 0) delete body.exchangeRate;

						const response = await oblioRequest(this, i, throttle, {
							method: 'POST',
							path: '/docs/invoice',
							json: body,
							generatesDocument: true,
							// The idempotency key makes a retry after a lost response safe.
							retrySafe: true,
						});
						returnData.push({
							json: {
								...((response.data as IDataObject) ?? {}),
								idempotencyKey: body.idempotencyKey,
							},
							pairedItem,
						});
						continue;
					}

					if (operation === 'get') {
						const response = await oblioRequest(this, i, throttle, {
							method: 'GET',
							path: '/docs/invoice',
							qs: { cif, seriesName, number: number() },
							retrySafe: true,
						});
						returnData.push({ json: (response.data as IDataObject) ?? {}, pairedItem });
						continue;
					}

					if (operation === 'cancel' || operation === 'restore' || operation === 'delete') {
						const form: IDataObject = { cif, seriesName, number: number() };
						if (operation === 'delete' && this.getNodeParameter('deleteCollect', i, false)) {
							form.deleteCollect = 1;
						}
						const response = await oblioRequest(this, i, throttle, {
							method: operation === 'delete' ? 'DELETE' : 'PUT',
							path: operation === 'delete' ? '/docs/invoice' : `/docs/invoice/${operation}`,
							form,
						});
						returnData.push({
							json: {
								success: true,
								statusMessage: response.statusMessage,
								...((response.data as IDataObject) ?? {}),
							},
							pairedItem,
						});
						continue;
					}

					if (operation === 'collect') {
						const fields = this.getNodeParameter('collectFields', i, {}) as IDataObject;
						const collect = compact({
							type: this.getNodeParameter('collectType', i) as string,
							seriesName: fields.seriesName,
							documentNumber: fields.documentNumber,
							value: fields.value === 0 ? undefined : fields.value,
							issueDate: toDate(fields.issueDate),
							mentions: fields.mentions,
						});
						const response = await oblioRequest(this, i, throttle, {
							method: 'PUT',
							path: '/docs/invoice/collect',
							form: { cif, seriesName, number: number(), collect },
						});
						returnData.push({ json: (response.data as IDataObject) ?? {}, pairedItem });
						continue;
					}

					if (operation === 'reverse') {
						const reverseSeries =
							(this.getNodeParameter('reverseSeriesName', i, '') as string).trim() || seriesName;
						const body: IDataObject = {
							cif,
							seriesName: reverseSeries,
							referenceDocument: {
								type: 'Factura',
								seriesName,
								number: number(),
								refund: this.getNodeParameter('refund', i, false) ? 1 : 0,
							},
							idempotencyKey: randomUUID(),
						};
						const response = await oblioRequest(this, i, throttle, {
							method: 'POST',
							path: '/docs/invoice',
							json: body,
							generatesDocument: true,
							retrySafe: true,
						});
						returnData.push({ json: (response.data as IDataObject) ?? {}, pairedItem });
						continue;
					}

					if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
						const filters = this.getNodeParameter('invoiceFilters', i, {}) as IDataObject;
						const { clientCif, clientEmail, issuedAfter, issuedBefore, ...rest } = filters;
						const baseQuery = compact({
							...rest,
							cif,
							issuedAfter: toDate(issuedAfter),
							issuedBefore: toDate(issuedBefore),
							client:
								clientCif || clientEmail
									? compact({ cif: clientCif, email: clientEmail })
									: undefined,
						});
						const invoices: IDataObject[] = [];
						for (let offset = 0; invoices.length < limit; offset += INVOICE_PAGE_SIZE) {
							const response = await oblioRequest(this, i, throttle, {
								method: 'GET',
								path: '/docs/invoice/list',
								qs: { ...baseQuery, limitPerPage: INVOICE_PAGE_SIZE, offset },
								retrySafe: true,
							});
							const page = (response.data as IDataObject[] | undefined) ?? [];
							invoices.push(...page);
							if (page.length < INVOICE_PAGE_SIZE) break;
						}
						for (const invoice of invoices.slice(0, limit))
							returnData.push({ json: invoice, pairedItem });
						continue;
					}
				}

				if (resource === 'client' && operation === 'getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					const filters = compact(this.getNodeParameter('clientFilters', i, {}) as IDataObject);
					const clients: IDataObject[] = [];
					for (let offset = 0; clients.length < limit; offset += CLIENT_PAGE_SIZE) {
						const response = await oblioRequest(this, i, throttle, {
							method: 'GET',
							path: '/nomenclature/clients',
							qs: { ...filters, cif, offset },
							retrySafe: true,
						});
						const page = (response.data as IDataObject[] | undefined) ?? [];
						clients.push(...page);
						if (page.length < CLIENT_PAGE_SIZE) break;
					}
					for (const client of clients.slice(0, limit))
						returnData.push({ json: client, pairedItem });
					continue;
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
