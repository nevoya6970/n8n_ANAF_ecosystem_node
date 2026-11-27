import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { normalizeCui } from '../shared/cui';
import { asNodeError } from '../shared/http';
import { parseAnafHeader } from '../shared/xml';
import type { AnafEnvironment } from './eFacturaApi';
import {
	anafRequest,
	baseUrl,
	CREDENTIAL_TYPE,
	headerValue,
	responseJson,
	responseText,
	upstreamError,
} from './eFacturaApi';
import {
	invoiceFields,
	invoiceOperations,
	messageFields,
	messageOperations,
	resourceProperty,
} from './descriptions';

/** ANAF returns this text (HTTP 200) when a list has no messages; it is not an error. */
const NO_MESSAGES = /^Nu exista mesaje/i;

function toMillis(value: unknown): number {
	return value ? new Date(String(value)).getTime() : NaN;
}

export class AnafEFactura implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ANAF e-Factura',
		name: 'anafEFactura',
		icon: { light: 'file:anafEFactura.svg', dark: 'file:anafEFactura.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Upload, track, list, download, validate and convert invoices in RO e-Factura (ANAF)',
		defaults: {
			name: 'ANAF e-Factura',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		// Upload, status, validation and listing work with XML text and JSON, so AI agents can use them.
		// Download and Convert to PDF return binary files, which agent tools only see as metadata.
		usableAsTool: true,
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		properties: [
			resourceProperty,
			invoiceOperations,
			messageOperations,
			...invoiceFields,
			...messageFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials(CREDENTIAL_TYPE);
		const environment: AnafEnvironment = credentials.environment === 'prod' ? 'prod' : 'test';
		const envUrl = baseUrl(environment);
		const prodUrl = baseUrl('prod');

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const pairedItem = { item: i };

				const readXml = async (): Promise<string> => {
					const source = this.getNodeParameter('xmlSource', i) as string;
					if (source === 'text') {
						const xml = (this.getNodeParameter('xmlContent', i) as string).trim();
						if (!xml)
							throw new NodeOperationError(this.getNode(), 'XML is empty', { itemIndex: i });
						return xml;
					}
					const property = this.getNodeParameter('binaryPropertyName', i) as string;
					this.helpers.assertBinaryData(i, property);
					const buffer = await this.helpers.getBinaryDataBuffer(i, property);
					return buffer.toString('utf8');
				};

				if (resource === 'invoice' && operation === 'upload') {
					const standard = this.getNodeParameter('uploadStandard', i) as string;
					const cif = normalizeCui(this.getNodeParameter('cif', i) as string).cui;
					if (!/^\d+$/.test(cif)) {
						throw new NodeOperationError(this.getNode(), `CIF "${cif}" must be numeric`, {
							itemIndex: i,
						});
					}
					const options = this.getNodeParameter('uploadOptions', i, {}) as IDataObject;
					const qs: IDataObject = { standard, cif };
					if (options.extern) qs.extern = 'DA';
					if (options.autofactura) qs.autofactura = 'DA';
					if (options.executare) qs.executare = 'DA';
					const xml = await readXml();

					const response = await anafRequest(this, i, {
						method: 'POST',
						url: `${envUrl}/${options.b2c ? 'uploadb2c' : 'upload'}`,
						qs,
						body: xml,
						// An upload creates an invoice; never retry it on 5xx or network errors.
						retry: { retryOnServerError: false },
					});
					const text = responseText(response);
					const header = parseAnafHeader(text);
					if (!header) throw upstreamError(this, i, 'Unexpected upload response from ANAF', text);
					if (header.errors.length || header.attributes.ExecutionStatus === '1') {
						throw upstreamError(
							this,
							i,
							header.errors.join('; ') || 'ANAF rejected the upload',
							text,
						);
					}
					returnData.push({
						json: {
							environment,
							standard,
							uploadIndex: header.attributes.index_incarcare,
							executionStatus: header.attributes.ExecutionStatus,
							dateResponse: header.attributes.dateResponse,
						},
						pairedItem,
					});
					continue;
				}

				if (resource === 'invoice' && operation === 'getStatus') {
					const uploadIndex = String(this.getNodeParameter('uploadIndex', i)).trim();
					const response = await anafRequest(this, i, {
						method: 'GET',
						url: `${envUrl}/stareMesaj`,
						qs: { id_incarcare: uploadIndex },
					});
					const text = responseText(response);
					const header = parseAnafHeader(text);
					if (!header) throw upstreamError(this, i, 'Unexpected status response from ANAF', text);
					if (header.errors.length) throw upstreamError(this, i, header.errors.join('; '), text);
					returnData.push({
						json: {
							uploadIndex,
							status: header.attributes.stare,
							downloadId: header.attributes.id_descarcare ?? null,
						},
						pairedItem,
					});
					continue;
				}

				if (resource === 'invoice' && operation === 'validate') {
					const standard = this.getNodeParameter('documentStandard', i) as string;
					const xml = await readXml();
					const response = await anafRequest(this, i, {
						method: 'POST',
						url: `${prodUrl}/validare/${standard}`,
						body: xml,
						contentType: 'text/plain',
					});
					const data = responseJson(response);
					if (!data)
						throw upstreamError(
							this,
							i,
							'Unexpected validation response from ANAF',
							responseText(response),
						);
					const messages = ((data.Messages as IDataObject[] | undefined) ?? []).map(
						(entry) => entry.message as string,
					);
					const valid = data.stare === 'ok';
					if (!valid && this.getNodeParameter('errorIfInvalid', i, false)) {
						throw upstreamError(
							this,
							i,
							messages.join('; ') || 'XML is not valid',
							responseText(response),
						);
					}
					returnData.push({
						json: { valid, status: data.stare, messages, traceId: data.trace_id },
						pairedItem,
					});
					continue;
				}

				if (resource === 'invoice' && operation === 'convertToPdf') {
					const standard = this.getNodeParameter('documentStandard', i) as string;
					const options = this.getNodeParameter('pdfOptions', i, {}) as IDataObject;
					const xml = await readXml();
					const response = await anafRequest(this, i, {
						method: 'POST',
						url: `${prodUrl}/transformare/${standard}${options.skipValidation ? '/DA' : ''}`,
						body: xml,
						contentType: 'text/plain',
						binary: true,
					});
					const contentType = headerValue(response.headers, 'content-type');
					const data = contentType.includes('json') ? responseJson(response) : undefined;
					const buffer = Buffer.isBuffer(response.body)
						? response.body
						: Buffer.from(response.body as ArrayBuffer);
					if (data || !buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
						const json = data ?? responseJson(response);
						const messages = ((json?.Messages as IDataObject[] | undefined) ?? []).map(
							(entry) => entry.message as string,
						);
						throw upstreamError(
							this,
							i,
							messages.join('; ') || 'ANAF did not return a PDF',
							responseText(response),
						);
					}
					const outputProperty = (options.outputBinaryPropertyName as string) || 'data';
					const fileName = (options.fileName as string) || 'invoice.pdf';
					const binary = await this.helpers.prepareBinaryData(buffer, fileName, 'application/pdf');
					returnData.push({
						json: { ...items[i].json, fileName, fileSize: buffer.length },
						binary: { ...(items[i].binary ?? {}), [outputProperty]: binary },
						pairedItem,
					});
					continue;
				}

				if (resource === 'message' && operation === 'getAll') {
					const cif = normalizeCui(this.getNodeParameter('cif', i) as string).cui;
					if (!/^\d+$/.test(cif)) {
						throw new NodeOperationError(this.getNode(), `CIF "${cif}" must be numeric`, {
							itemIndex: i,
						});
					}
					const period = this.getNodeParameter('period', i) as string;
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const messages: IDataObject[] = [];

					const fetchList = async (
						url: string,
						qs: IDataObject,
					): Promise<IDataObject | undefined> => {
						const response = await anafRequest(this, i, { method: 'GET', url, qs });
						const data = responseJson(response);
						if (!data)
							throw upstreamError(
								this,
								i,
								'Unexpected list response from ANAF',
								responseText(response),
							);
						if (typeof data.eroare === 'string') {
							if (NO_MESSAGES.test(data.eroare)) return undefined;
							throw upstreamError(this, i, data.eroare, responseText(response));
						}
						return data;
					};

					if (period === 'days') {
						const days = this.getNodeParameter('days', i) as number;
						if (!Number.isInteger(days) || days < 1 || days > 60) {
							throw new NodeOperationError(this.getNode(), 'Days must be between 1 and 60', {
								itemIndex: i,
							});
						}
						const qs: IDataObject = { zile: days, cif };
						if (filters.filtru) qs.filtru = filters.filtru;
						const data = await fetchList(`${envUrl}/listaMesajeFactura`, qs);
						messages.push(...((data?.mesaje as IDataObject[] | undefined) ?? []));
					} else {
						const startTime = toMillis(this.getNodeParameter('startTime', i));
						const endTime = toMillis(this.getNodeParameter('endTime', i));
						if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
							throw new NodeOperationError(
								this.getNode(),
								'Start Time and End Time must be valid dates',
								{ itemIndex: i },
							);
						}
						if (endTime <= startTime) {
							throw new NodeOperationError(this.getNode(), 'End Time must be after Start Time', {
								itemIndex: i,
							});
						}
						for (let page = 1; messages.length < limit; page++) {
							const qs: IDataObject = { startTime, endTime, cif, pagina: page };
							if (filters.filtru) qs.filtru = filters.filtru;
							const data = await fetchList(`${envUrl}/listaMesajePaginatieFactura`, qs);
							if (!data) break;
							messages.push(...((data.mesaje as IDataObject[] | undefined) ?? []));
							const totalPages = Number(data.numar_total_pagini ?? 1);
							if (!Number.isFinite(totalPages) || page >= totalPages) break;
						}
					}

					for (const message of messages.slice(0, limit)) {
						returnData.push({ json: message, pairedItem });
					}
					continue;
				}

				if (resource === 'message' && operation === 'download') {
					const downloadId = String(this.getNodeParameter('downloadId', i)).trim();
					const outputProperty = this.getNodeParameter('outputBinaryPropertyName', i) as string;
					const response = await anafRequest(this, i, {
						method: 'GET',
						url: `${envUrl}/descarcare`,
						qs: { id: downloadId },
						binary: true,
						// ANAF allows only 10 downloads per message per day: keep retries low.
						retry: { maxRetries: 1 },
					});
					const buffer = Buffer.isBuffer(response.body)
						? response.body
						: Buffer.from(response.body as ArrayBuffer);
					// A ZIP starts with "PK". Errors come back as JSON with HTTP 200.
					if (buffer.subarray(0, 2).toString('latin1') !== 'PK') {
						const data = responseJson(response);
						const message =
							(typeof data?.eroare === 'string' && data.eroare) ||
							(typeof data?.message === 'string' && data.message) ||
							'ANAF did not return a ZIP file';
						throw upstreamError(this, i, message, responseText(response));
					}
					const fileName = `${downloadId}.zip`;
					const binary = await this.helpers.prepareBinaryData(buffer, fileName, 'application/zip');
					returnData.push({
						json: { downloadId, fileName, fileSize: buffer.length },
						binary: { [outputProperty]: binary },
						pairedItem,
					});
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
