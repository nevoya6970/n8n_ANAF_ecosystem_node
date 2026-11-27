import { describe, expect, it, vi } from 'vitest';
import type { IDataObject } from 'n8n-workflow';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import { sleep } from 'n8n-workflow';
import { AnafCompanyLookup } from '../nodes/AnafCompanyLookup/AnafCompanyLookup.node';
import { ANAF_VAT_URL } from '../nodes/AnafCompanyLookup/anafVatApi';
import { createContext, httpError } from './helpers/mockContext';

// All data below is fictitious.
function record(cui: number, name = 'TEST COMPANY SRL'): IDataObject {
	return {
		date_generale: {
			cui,
			data: '2026-01-15',
			denumire: name,
			adresa: 'MUN. TEST, STR. EXEMPLU NR. 1',
			statusRO_e_Factura: true,
			stare_inregistrare: 'INREGISTRAT',
		},
		inregistrare_scop_Tva: { scpTVA: true, perioade_TVA: [] },
		inregistrare_RTVAI: { statusTvaIncasare: false },
		stare_inactiv: { statusInactivi: false, dataRadiere: '' },
		inregistrare_SplitTVA: { statusSplitTVA: false },
	};
}

const node = new AnafCompanyLookup();

describe('ANAF Company Lookup', () => {
	it('looks up one company per item, combining items into a single request', async () => {
		const { context, httpRequest } = createContext({
			items: [{ json: {} }, { json: {} }],
			params: [
				{ operation: 'lookUp', cui: 'RO12345674', options: { date: '2026-01-15' } },
				{ operation: 'lookUp', cui: '23456783', options: { date: '2026-01-15' } },
			],
			httpRequest: async () => ({
				cod: 200,
				message: 'SUCCESS',
				found: [record(12345674), record(23456783, 'OTHER TEST SRL')],
				notFound: [],
			}),
		});

		const [output] = await node.execute.call(context);

		expect(httpRequest).toHaveBeenCalledTimes(1);
		const request = httpRequest.mock.calls[0][0];
		expect(request).toMatchObject({ method: 'POST', url: ANAF_VAT_URL, json: true });
		expect(request.body).toEqual([
			{ cui: 12345674, data: '2026-01-15' },
			{ cui: 23456783, data: '2026-01-15' },
		]);
		expect(output).toHaveLength(2);
		expect(output[0].json).toMatchObject({ found: true, cui: '12345674' });
		expect(output[1].json.date_generale).toMatchObject({ denumire: 'OTHER TEST SRL' });
		expect(output[1].pairedItem).toEqual({ item: 1 });
	});

	it('treats ANAF 404 with a notFound list as "not found", not as an error', async () => {
		const { context } = createContext({
			params: { operation: 'lookUp', cui: '12345674', options: { date: '2026-01-15' } },
			httpRequest: async () => {
				throw httpError(404, { found: [], notFound: [12345674] });
			},
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json).toEqual({
			cui: '12345674',
			input: '12345674',
			date: '2026-01-15',
			found: false,
		});
	});

	it('fails when Error If Not Found is on', async () => {
		const { context } = createContext({
			params: {
				operation: 'lookUp',
				cui: '12345674',
				options: { date: '2026-01-15', errorIfNotFound: true },
			},
			httpRequest: async () => ({ found: [], notFound: [12345674] }),
		});
		await expect(node.execute.call(context)).rejects.toThrow('ANAF has no record for CUI 12345674');
	});

	it('rejects invalid check digits locally without calling ANAF', async () => {
		const { context, httpRequest } = createContext({
			params: { operation: 'lookUp', cui: '12345675', options: {} },
			httpRequest: async () => ({ found: [] }),
		});
		await expect(node.execute.call(context)).rejects.toThrow('invalid check digit');
		expect(httpRequest).not.toHaveBeenCalled();
	});

	it('returns per-item errors with continueOnFail', async () => {
		const { context } = createContext({
			continueOnFail: true,
			params: { operation: 'lookUp', cui: '12345675', options: {} },
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json.error).toContain('invalid check digit');
	});

	it('batches more than 100 CUIs into chunks spaced at least one second apart', async () => {
		vi.mocked(sleep).mockClear();
		const cuis = Array.from({ length: 150 }, (_, index) => String(1000 + index));
		const { context, httpRequest } = createContext({
			params: {
				operation: 'batchLookup',
				cuis: cuis.join(', '),
				options: { date: '2026-01-15', validateChecksum: false },
			},
			httpRequest: async (options) => {
				const body = options.body as Array<{ cui: number }>;
				return { found: body.slice(0, 1).map((entry) => record(entry.cui)), notFound: [] };
			},
		});

		const [output] = await node.execute.call(context);

		expect(httpRequest).toHaveBeenCalledTimes(2);
		expect((httpRequest.mock.calls[0][0].body as unknown[]).length).toBe(100);
		expect((httpRequest.mock.calls[1][0].body as unknown[]).length).toBe(50);
		expect(sleep).toHaveBeenCalledWith(1100);
		expect(output).toHaveLength(150);
		expect(output.filter((item) => item.json.found === true)).toHaveLength(2);
	});

	it('condenses the record for Get VAT Status', async () => {
		const { context } = createContext({
			params: { operation: 'getVatStatus', cui: '12345674', options: { date: '2026-01-15' } },
			httpRequest: async () => ({ found: [record(12345674)], notFound: [] }),
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json).toMatchObject({
			found: true,
			cui: 12345674,
			vatRegistered: true,
			vatOnCashBasis: false,
			splitVat: false,
			inactive: false,
			eInvoiceRegistry: true,
		});
	});

	it('surfaces the upstream message on HTTP errors and retries rate limits', async () => {
		const httpRequest = vi
			.fn()
			.mockRejectedValueOnce(httpError(429, { message: 'Too many requests' }))
			.mockRejectedValueOnce(httpError(400, { cod: 400, message: 'Formatul datei este invalid' }));
		const { context } = createContext({
			params: { operation: 'lookUp', cui: '12345674', options: { date: '2026-01-15' } },
			httpRequest: async (options) => await httpRequest(options),
		});
		await expect(node.execute.call(context)).rejects.toThrow('Formatul datei este invalid');
		expect(httpRequest).toHaveBeenCalledTimes(2);
	});

	it('validates CUIs locally', async () => {
		const { context, httpRequest } = createContext({
			items: [{ json: {} }, { json: {} }],
			params: [
				{ operation: 'validateCui', cui: 'RO18547290' },
				{ operation: 'validateCui', cui: '18547291' },
			],
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json).toMatchObject({ valid: true, cui: '18547290', hasRoPrefix: true });
		expect(output[1].json).toMatchObject({ valid: false, reason: 'checksum' });
		expect(httpRequest).not.toHaveBeenCalled();
	});
});
