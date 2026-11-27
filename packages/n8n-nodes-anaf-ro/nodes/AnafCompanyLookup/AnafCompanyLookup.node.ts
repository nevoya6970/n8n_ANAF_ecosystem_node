import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { describeCuiProblem, validateCui } from '../shared/cui';
import { asNodeError, toNodeApiError } from '../shared/http';
import { lookupCuis, toAnafDate, toVatStatus } from './anafVatApi';

type Operation = 'lookUp' | 'batchLookup' | 'getVatStatus' | 'validateCui';

interface PendingCui {
	itemIndex: number;
	input: string;
	cui?: string;
	date: string;
	problem?: string;
}

function splitCuiList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
	return String(value ?? '')
		.split(/[\s,;]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export class AnafCompanyLookup implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ANAF Company Lookup',
		name: 'anafCompanyLookup',
		icon: { light: 'file:anafCompanyLookup.svg', dark: 'file:anafCompanyLookup.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Look up Romanian companies, VAT status and e-Factura registry status in the public ANAF registry',
		defaults: {
			name: 'ANAF Company Lookup',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Look Up Company',
						value: 'lookUp',
						description: 'Get the ANAF registry record for one CUI per input item',
						action: 'Look up a company by CUI',
					},
					{
						name: 'Batch Look Up',
						value: 'batchLookup',
						description:
							'Look up a list of CUIs (from all input items) in as few requests as possible, one output item per CUI',
						action: 'Look up many companies by CUI',
					},
					{
						name: 'Get VAT Status',
						value: 'getVatStatus',
						description: 'Get only the VAT, cash-basis VAT, split VAT and inactive flags for a CUI',
						action: 'Get the VAT status of a company',
					},
					{
						name: 'Validate CUI',
						value: 'validateCui',
						description: 'Check the format and check digit of a CUI locally, without calling ANAF',
						action: 'Validate a CUI check digit',
					},
				],
				default: 'lookUp',
			},
			{
				displayName: 'CUI',
				name: 'cui',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. RO12345678',
				description: 'Romanian fiscal code (CUI/CIF), with or without the RO prefix',
				displayOptions: {
					show: {
						operation: ['lookUp', 'getVatStatus', 'validateCui'],
					},
				},
			},
			{
				displayName: 'CUIs',
				name: 'cuis',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 12345678, RO23456789',
				description:
					'CUIs separated by commas, spaces or new lines. Values from all input items are combined and sent in chunks of 100.',
				displayOptions: {
					show: {
						operation: ['batchLookup'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						operation: ['lookUp', 'batchLookup', 'getVatStatus'],
					},
				},
				options: [
					{
						displayName: 'Query Date',
						name: 'date',
						type: 'dateTime',
						default: '',
						description:
							'Date for which ANAF reports the company status. Defaults to today (Romania time).',
					},
					{
						displayName: 'Validate CUI Before Request',
						name: 'validateChecksum',
						type: 'boolean',
						default: true,
						description:
							'Whether to check the CUI check digit locally and skip invalid CUIs instead of sending them to ANAF',
					},
					{
						displayName: 'Error If Not Found',
						name: 'errorIfNotFound',
						type: 'boolean',
						default: false,
						description:
							'Whether to fail the item when ANAF has no record for the CUI. When off, the item is returned with found set to false.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as Operation;
		const returnData: INodeExecutionData[] = [];

		if (operation === 'validateCui') {
			for (let i = 0; i < items.length; i++) {
				const cui = this.getNodeParameter('cui', i) as string;
				returnData.push({ json: { ...validateCui(cui) }, pairedItem: { item: i } });
			}
			return [returnData];
		}

		// Collect every CUI first so they can be sent to ANAF in as few requests as possible.
		const pending: PendingCui[] = [];
		const optionsByItem: IDataObject[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				optionsByItem[i] = options;
				const date = toAnafDate(options.date);
				const validate = options.validateChecksum !== false;
				const inputs =
					operation === 'batchLookup'
						? splitCuiList(this.getNodeParameter('cuis', i))
						: [String(this.getNodeParameter('cui', i) ?? '').trim()];

				if (inputs.length === 0 || (inputs.length === 1 && inputs[0] === '')) {
					throw new NodeOperationError(this.getNode(), 'No CUI provided', { itemIndex: i });
				}

				for (const input of inputs) {
					const result = validateCui(input);
					const formatOk =
						result.reason !== 'empty' && result.reason !== 'format' && result.reason !== 'length';
					if (!formatOk || (validate && !result.valid)) {
						pending.push({ itemIndex: i, input, date, problem: describeCuiProblem(result) });
					} else {
						pending.push({ itemIndex: i, input, cui: result.cui, date });
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw asNodeError(this.getNode(), error, i);
			}
		}

		// Group by query date, then query ANAF once per group (chunked by 100).
		const byDate = new Map<string, Set<string>>();
		for (const entry of pending) {
			if (!entry.cui) continue;
			if (!byDate.has(entry.date)) byDate.set(entry.date, new Set());
			byDate.get(entry.date)!.add(entry.cui);
		}

		const results = new Map<string, { record?: IDataObject; error?: unknown }>();
		for (const [date, cuiSet] of byDate) {
			const cuis = [...cuiSet];
			const lookup = await lookupCuis(this, cuis, date);
			for (const cui of cuis) {
				results.set(
					`${date}|${cui}`,
					lookup.ok ? { record: lookup.value.found.get(cui) } : { error: lookup.error },
				);
			}
		}

		for (const entry of pending) {
			const pairedItem = { item: entry.itemIndex };
			const options = optionsByItem[entry.itemIndex] ?? {};
			try {
				if (entry.problem) {
					throw new NodeOperationError(this.getNode(), entry.problem, {
						itemIndex: entry.itemIndex,
					});
				}
				const result = results.get(`${entry.date}|${entry.cui}`);
				if (result?.error) throw toNodeApiError(this.getNode(), result.error, entry.itemIndex);

				const record = result?.record;
				if (!record) {
					if (options.errorIfNotFound === true) {
						throw new NodeOperationError(
							this.getNode(),
							`ANAF has no record for CUI ${entry.cui} on ${entry.date}`,
							{ itemIndex: entry.itemIndex },
						);
					}
					returnData.push({
						json: { cui: entry.cui, input: entry.input, date: entry.date, found: false },
						pairedItem,
					});
					continue;
				}

				const json =
					operation === 'getVatStatus'
						? { found: true, ...toVatStatus(record) }
						: { found: true, cui: entry.cui, ...record };
				returnData.push({ json, pairedItem });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { cui: entry.cui ?? entry.input, error: (error as Error).message },
						pairedItem,
					});
					continue;
				}
				throw asNodeError(this.getNode(), error, entry.itemIndex);
			}
		}

		return [returnData];
	}
}
