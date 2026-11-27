import { describe, expect, it, vi } from 'vitest';
import type { IDataObject } from 'n8n-workflow';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import { AnafEFactura } from '../nodes/AnafEFactura/AnafEFactura.node';
import { parseAnafHeader } from '../nodes/shared/xml';
import { createContext, wrappedHttpError } from './helpers/mockContext';

// Fictitious invoice XML: not a real invoice, only used as an opaque payload.
const SAMPLE_XML =
	'<?xml version="1.0" encoding="UTF-8"?><Invoice><cbc:ID>TEST-0001</cbc:ID></Invoice>';
const node = new AnafEFactura();

function full(body: unknown, headers: IDataObject = {}, statusCode = 200) {
	return { body, headers, statusCode, statusMessage: 'OK' };
}

const testCredentials = { environment: 'test' };

describe('ANAF XML envelope parser', () => {
	it('reads header attributes and error messages, decoding entities', () => {
		const parsed = parseAnafHeader(
			'<?xml version="1.0"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" ExecutionStatus="1">' +
				'<Errors errorMessage="Nu aveti drept in SPV pentru CIF=1234 &amp; altele"/></header>',
		);
		expect(parsed).toEqual({
			attributes: { ExecutionStatus: '1' },
			errors: ['Nu aveti drept in SPV pentru CIF=1234 & altele'],
		});
	});

	it('returns undefined for non-envelope text', () => {
		expect(parseAnafHeader('{"eroare":"x"}')).toBeUndefined();
	});
});

describe('ANAF e-Factura', () => {
	it('uploads XML text to the test environment and returns the upload index', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'upload',
				uploadStandard: 'UBL',
				cif: 'RO12345674',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				uploadOptions: { extern: true },
			},
			httpRequestWithAuthentication: async () =>
				full(
					'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202601151140" ExecutionStatus="0" index_incarcare="3828"/>',
				),
		});

		const [output] = await node.execute.call(context);

		const [credentialType, request] = httpRequestWithAuthentication.mock.calls[0];
		expect(credentialType).toBe('anafEFacturaOAuth2Api');
		expect(request).toMatchObject({
			method: 'POST',
			url: 'https://api.anaf.ro/test/FCTEL/rest/upload',
			qs: { standard: 'UBL', cif: '12345674', extern: 'DA' },
			body: SAMPLE_XML,
			headers: { 'Content-Type': 'text/plain' },
		});
		expect(output[0].json).toEqual({
			environment: 'test',
			standard: 'UBL',
			uploadIndex: '3828',
			executionStatus: '0',
			dateResponse: '202601151140',
		});
	});

	it('uses the production and B2C endpoint when configured, reading XML from binary', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: { environment: 'prod' },
			binary: { data: Buffer.from(SAMPLE_XML) },
			params: {
				resource: 'invoice',
				operation: 'upload',
				uploadStandard: 'UBL',
				cif: '12345674',
				xmlSource: 'binary',
				binaryPropertyName: 'data',
				uploadOptions: { b2c: true },
			},
			httpRequestWithAuthentication: async () =>
				full('<header ExecutionStatus="0" index_incarcare="99"/>'),
		});
		await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			url: 'https://api.anaf.ro/prod/FCTEL/rest/uploadb2c',
			body: SAMPLE_XML,
		});
	});

	it('raises the ANAF error message when an upload is rejected with HTTP 200', async () => {
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'upload',
				uploadStandard: 'UBL',
				cif: '12345674',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				uploadOptions: {},
			},
			httpRequestWithAuthentication: async () =>
				full(
					'<header ExecutionStatus="1"><Errors errorMessage="Nu exista niciun CIF pentru care sa aveti drept in SPV"/></header>',
				),
		});
		await expect(node.execute.call(context)).rejects.toThrow(
			'Nu exista niciun CIF pentru care sa aveti drept in SPV',
		);
	});

	it('does not retry an upload on a server error', async () => {
		const call = vi.fn(async () => {
			throw wrappedHttpError(502, 'Bad gateway');
		});
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'upload',
				uploadStandard: 'UBL',
				cif: '12345674',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				uploadOptions: {},
			},
			httpRequestWithAuthentication: call,
		});
		await expect(node.execute.call(context)).rejects.toThrow('Bad gateway');
		expect(call).toHaveBeenCalledTimes(1);
	});

	it('rejects a non-numeric CIF before calling ANAF', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'upload',
				uploadStandard: 'UBL',
				cif: 'ABC',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				uploadOptions: {},
			},
		});
		await expect(node.execute.call(context)).rejects.toThrow('must be numeric');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('gets the upload status', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: testCredentials,
			params: { resource: 'invoice', operation: 'getStatus', uploadIndex: '3828' },
			httpRequestWithAuthentication: async () =>
				full(
					'<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1" stare="ok" id_descarcare="1234"/>',
				),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			url: 'https://api.anaf.ro/test/FCTEL/rest/stareMesaj',
			qs: { id_incarcare: '3828' },
		});
		expect(output[0].json).toEqual({ uploadIndex: '3828', status: 'ok', downloadId: '1234' });
	});

	it('retries status checks on 503 and surfaces status errors', async () => {
		const call = vi
			.fn()
			.mockRejectedValueOnce(wrappedHttpError(503, 'busy'))
			.mockResolvedValueOnce(
				full('<header><Errors errorMessage="Nu exista factura cu id_incarcare= 15000"/></header>'),
			);
		const { context } = createContext({
			credentials: testCredentials,
			params: { resource: 'invoice', operation: 'getStatus', uploadIndex: '15000' },
			httpRequestWithAuthentication: async (type, options) => await call(type, options),
		});
		await expect(node.execute.call(context)).rejects.toThrow(
			'Nu exista factura cu id_incarcare= 15000',
		);
		expect(call).toHaveBeenCalledTimes(2);
	});

	it('lists messages for the last N days with a filter', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'message',
				operation: 'getAll',
				cif: '12345674',
				period: 'days',
				days: 10,
				returnAll: true,
				filters: { filtru: 'P' },
			},
			httpRequestWithAuthentication: async () =>
				full(
					JSON.stringify({
						mesaje: [
							{
								data_creare: '202601151452',
								cif: '12345674',
								id_solicitare: '1',
								tip: 'FACTURA PRIMITA',
								id: '11',
							},
							{
								data_creare: '202601151453',
								cif: '12345674',
								id_solicitare: '2',
								tip: 'FACTURA PRIMITA',
								id: '12',
							},
						],
						serial: 'test',
						cui: '12345674',
						titlu: 'Lista Mesaje',
					}),
				),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			url: 'https://api.anaf.ro/test/FCTEL/rest/listaMesajeFactura',
			qs: { zile: 10, cif: '12345674', filtru: 'P' },
		});
		expect(output.map((item) => item.json.id)).toEqual(['11', '12']);
	});

	it('treats "no messages" as an empty result', async () => {
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'message',
				operation: 'getAll',
				cif: '12345674',
				period: 'days',
				days: 15,
				returnAll: true,
				filters: {},
			},
			httpRequestWithAuthentication: async () =>
				full('{"eroare":"Nu exista mesaje in ultimele 15 zile","titlu":"Lista Mesaje"}'),
		});
		const [output] = await node.execute.call(context);
		expect(output).toEqual([]);
	});

	it('pages through a time range until the limit is reached', async () => {
		const page = (n: number) =>
			full(
				JSON.stringify({
					mesaje: [{ id: `${n}a` }, { id: `${n}b` }],
					numar_total_pagini: 3,
					index_pagina_curenta: n,
				}),
			);
		const call = vi.fn(async (_type: string, options: IDataObject) =>
			page(Number((options.qs as IDataObject).pagina)),
		);
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'message',
				operation: 'getAll',
				cif: '12345674',
				period: 'range',
				startTime: '2026-01-01T00:00:00Z',
				endTime: '2026-01-31T00:00:00Z',
				returnAll: false,
				limit: 3,
				filters: {},
			},
			httpRequestWithAuthentication: call,
		});
		const [output] = await node.execute.call(context);
		expect(call).toHaveBeenCalledTimes(2);
		expect(call.mock.calls[0][1]).toMatchObject({
			url: 'https://api.anaf.ro/test/FCTEL/rest/listaMesajePaginatieFactura',
			qs: {
				startTime: Date.parse('2026-01-01T00:00:00Z'),
				endTime: Date.parse('2026-01-31T00:00:00Z'),
				pagina: 1,
			},
		});
		expect(output.map((item) => item.json.id)).toEqual(['1a', '1b', '2a']);
	});

	it('downloads a message ZIP as binary', async () => {
		const zip = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(20)]);
		const { context, httpRequestWithAuthentication, prepareBinaryData } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'message',
				operation: 'download',
				downloadId: '3001474425',
				outputBinaryPropertyName: 'data',
			},
			httpRequestWithAuthentication: async () => full(zip, { 'content-type': 'application/zip' }),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			url: 'https://api.anaf.ro/test/FCTEL/rest/descarcare',
			qs: { id: '3001474425' },
			encoding: 'arraybuffer',
		});
		expect(prepareBinaryData).toHaveBeenCalledWith(zip, '3001474425.zip', 'application/zip');
		expect(output[0].json).toEqual({
			downloadId: '3001474425',
			fileName: '3001474425.zip',
			fileSize: 24,
		});
		expect(output[0].binary?.data.mimeType).toBe('application/zip');
	});

	it('raises the ANAF message when a download returns a JSON error', async () => {
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'message',
				operation: 'download',
				downloadId: '21',
				outputBinaryPropertyName: 'data',
			},
			httpRequestWithAuthentication: async () =>
				full(
					Buffer.from(
						'{"eroare":"Pentru id=21 nu exista inregistrata nici o factura","titlu":"Descarcare mesaj"}',
					),
					{ 'content-type': 'application/json' },
				),
		});
		await expect(node.execute.call(context)).rejects.toThrow(
			'Pentru id=21 nu exista inregistrata nici o factura',
		);
	});

	it('validates XML on the production endpoint and returns messages', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'validate',
				documentStandard: 'FACT1',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				errorIfInvalid: false,
			},
			httpRequestWithAuthentication: async () =>
				full(
					JSON.stringify({
						stare: 'nok',
						Messages: [{ message: 'E: validari globale SCHEMATRON eroare: [BR-CO-09]' }],
						trace_id: 'trace-1',
					}),
				),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			url: 'https://api.anaf.ro/prod/FCTEL/rest/validare/FACT1',
			headers: { 'Content-Type': 'text/plain' },
		});
		expect(output[0].json).toEqual({
			valid: false,
			status: 'nok',
			messages: ['E: validari globale SCHEMATRON eroare: [BR-CO-09]'],
			traceId: 'trace-1',
		});
	});

	it('fails validation when Error If Invalid is on', async () => {
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'validate',
				documentStandard: 'FCN',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				errorIfInvalid: true,
			},
			httpRequestWithAuthentication: async () =>
				full(
					'{"stare":"nok","Messages":[{"message":"Valorile acceptate pentru parametrul standard sunt FACT1 si FCN"}]}',
				),
		});
		await expect(node.execute.call(context)).rejects.toThrow('Valorile acceptate');
	});

	it('converts XML to PDF and skips validation when asked', async () => {
		const pdf = Buffer.from('%PDF-1.4 test');
		const { context, httpRequestWithAuthentication, prepareBinaryData } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'convertToPdf',
				documentStandard: 'FACT1',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				pdfOptions: { skipValidation: true, fileName: 'test.pdf' },
			},
			httpRequestWithAuthentication: async () => full(pdf, { 'content-type': 'application/pdf' }),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			url: 'https://api.anaf.ro/prod/FCTEL/rest/transformare/FACT1/DA',
			encoding: 'arraybuffer',
		});
		expect(prepareBinaryData).toHaveBeenCalledWith(pdf, 'test.pdf', 'application/pdf');
		expect(output[0].binary?.data.fileName).toBe('test.pdf');
	});

	it('raises validation messages when PDF conversion fails', async () => {
		const { context } = createContext({
			credentials: testCredentials,
			params: {
				resource: 'invoice',
				operation: 'convertToPdf',
				documentStandard: 'FACT1',
				xmlSource: 'text',
				xmlContent: SAMPLE_XML,
				pdfOptions: {},
			},
			httpRequestWithAuthentication: async () =>
				full(
					Buffer.from(
						'{"stare":"nok","Messages":[{"message":"R_BT_32_cui: Cui vanzator incorect"}]}',
					),
					{
						'content-type': 'application/json',
					},
				),
		});
		await expect(node.execute.call(context)).rejects.toThrow('R_BT_32_cui: Cui vanzator incorect');
	});

	it('surfaces HTTP errors from the API with the upstream message', async () => {
		const { context } = createContext({
			credentials: testCredentials,
			params: { resource: 'invoice', operation: 'getStatus', uploadIndex: 'x' },
			httpRequestWithAuthentication: async () => {
				throw wrappedHttpError(400, {
					timestamp: '19-08-2021 11:01:56',
					status: 400,
					error: 'Bad Request',
					message: 'Parametrul id_incarcare este obligatoriu',
				});
			},
		});
		await expect(node.execute.call(context)).rejects.toThrow(
			'Parametrul id_incarcare este obligatoriu',
		);
	});

	it('continues on fail with an error item', async () => {
		const { context } = createContext({
			continueOnFail: true,
			credentials: testCredentials,
			params: { resource: 'invoice', operation: 'getStatus', uploadIndex: '1' },
			httpRequestWithAuthentication: async () => full('not xml'),
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json.error).toBe('Unexpected status response from ANAF');
		expect(output[0].pairedItem).toEqual({ item: 0 });
	});
});
