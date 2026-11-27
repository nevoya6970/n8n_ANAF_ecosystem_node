import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import { sleep } from 'n8n-workflow';
import { OblioApi, OBLIO_TOKEN_URL } from '../credentials/OblioApi.credentials';
import { Oblio } from '../nodes/Oblio/Oblio.node';
import { flattenQuery, toFormBody } from '../nodes/Oblio/oblioApi';
import { createContext, wrappedHttpError } from './helpers/mockContext';

// All values are fictitious placeholders.
const node = new Oblio();
const ok = (data: unknown, statusMessage = 'Success') => ({ status: 200, statusMessage, data });

const createParams = {
	resource: 'invoice',
	operation: 'create',
	cif: 'RO12345674',
	seriesName: 'TEST',
	clientName: 'Client Test SRL',
	clientFields: { cif: 'RO23456783', vatPayer: true, email: '' },
	productsInput: 'fields',
	products: {
		product: [
			{
				name: 'Consulting',
				price: 100,
				quantity: 2,
				measuringUnit: 'ora',
				vatPercentage: 21,
				vatIncluded: false,
				code: '',
			},
		],
	},
	additionalFields: { issueDate: '2026-01-15T00:00:00', sendEmail: true, exchangeRate: 0 },
};

describe('Oblio credential', () => {
	it('exchanges email and secret for an access token (form encoded)', async () => {
		const httpRequest = vi.fn(async () => ({
			access_token: 'token-abc',
			expires_in: '3600',
			token_type: 'Bearer',
		}));
		const credential = new OblioApi();
		const result = await credential.preAuthentication.call({ helpers: { httpRequest } } as never, {
			email: 'user@example.com',
			secret: 'secret-not-real',
		});
		expect(result).toEqual({ accessToken: 'token-abc' });
		expect(httpRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'POST',
				url: OBLIO_TOKEN_URL,
				body: 'client_id=user%40example.com&client_secret=secret-not-real',
				headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
			}),
		);
	});

	it('sends the token as a Bearer header and tests against the companies list', () => {
		const credential = new OblioApi();
		expect(credential.authenticate.properties.headers).toEqual({
			Authorization: '=Bearer {{$credentials.accessToken}}',
		});
		expect(credential.test.request.url).toBe('/nomenclature/companies');
		const tokenProperty = credential.properties.find((property) => property.name === 'accessToken');
		expect(tokenProperty?.typeOptions?.expirable).toBe(true);
	});
});

describe('Oblio encoding helpers', () => {
	it('encodes nested form bodies with bracket notation and booleans as 0/1', () => {
		expect(
			toFormBody({
				cif: 'RO1',
				collect: { type: 'Ordin de plata', documentNumber: 'OP 1' },
				flag: true,
			}),
		).toBe('cif=RO1&collect%5Btype%5D=Ordin+de+plata&collect%5BdocumentNumber%5D=OP+1&flag=1');
	});

	it('flattens nested query parameters', () => {
		expect(flattenQuery({ cif: 'RO1', client: { cif: '2' }, withProducts: true })).toEqual({
			cif: 'RO1',
			'client[cif]': '2',
			withProducts: 1,
		});
	});
});

describe('Oblio node', () => {
	it('creates an invoice with 0/1 flags and an idempotency key', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: createParams,
			httpRequestWithAuthentication: async () =>
				ok({ seriesName: 'TEST', number: '0053', link: 'https://example.com/doc' }),
		});
		const [output] = await node.execute.call(context);

		const [type, request] = httpRequestWithAuthentication.mock.calls[0];
		expect(type).toBe('oblioApi');
		expect(request).toMatchObject({
			method: 'POST',
			baseURL: 'https://www.oblio.eu/api',
			url: '/docs/invoice',
		});
		const body = request.body as IDataObject;
		expect(body).toMatchObject({
			cif: 'RO12345674',
			seriesName: 'TEST',
			client: { name: 'Client Test SRL', cif: 'RO23456783', vatPayer: 1 },
			products: [
				{
					name: 'Consulting',
					price: 100,
					quantity: 2,
					measuringUnit: 'ora',
					vatPercentage: 21,
					vatIncluded: 0,
				},
			],
			issueDate: '2026-01-15',
			sendEmail: 1,
		});
		expect(body.exchangeRate).toBeUndefined();
		expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
		expect(output[0].json).toMatchObject({ number: '0053', idempotencyKey: body.idempotencyKey });
	});

	it('retries invoice creation on 5xx with the same idempotency key', async () => {
		const call = vi
			.fn()
			.mockRejectedValueOnce(wrappedHttpError(502, 'Bad gateway'))
			.mockResolvedValueOnce(ok({ number: '0054' }));
		const { context } = createContext({
			params: { ...createParams, additionalFields: { idempotencyKey: 'key-1' } },
			httpRequestWithAuthentication: async (t, o) => await call(t, o),
		});
		await node.execute.call(context);
		expect(call).toHaveBeenCalledTimes(2);
		expect((call.mock.calls[0][1].body as IDataObject).idempotencyKey).toBe('key-1');
		expect((call.mock.calls[1][1].body as IDataObject).idempotencyKey).toBe('key-1');
	});

	it('spaces document-generating calls to respect 30 per 100 seconds', async () => {
		vi.mocked(sleep).mockClear();
		const { context } = createContext({
			items: [{ json: {} }, { json: {} }],
			params: createParams,
			httpRequestWithAuthentication: async () => ok({ number: '1' }),
		});
		await node.execute.call(context);
		const waits = vi.mocked(sleep).mock.calls.map(([ms]) => ms as number);
		expect(waits.length).toBe(1);
		expect(waits[0]).toBeGreaterThan(3000);
	});

	it('surfaces statusMessage from 400 responses', async () => {
		const { context } = createContext({
			params: createParams,
			httpRequestWithAuthentication: async () => {
				throw wrappedHttpError(400, { status: 400, statusMessage: 'Seria TEST nu exista' });
			},
		});
		await expect(node.execute.call(context)).rejects.toThrow('Seria TEST nu exista');
	});

	it('gets an invoice', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: {
				resource: 'invoice',
				operation: 'get',
				cif: 'RO12345674',
				seriesName: 'TEST',
				number: '0055',
			},
			httpRequestWithAuthentication: async () =>
				ok({ documentType: 'Factura', seriesName: 'TEST', number: '0055' }),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			url: '/docs/invoice',
			qs: { cif: 'RO12345674', seriesName: 'TEST', number: '0055' },
		});
		expect(output[0].json).toMatchObject({ documentType: 'Factura' });
	});

	it.each([
		['cancel', 'PUT', '/docs/invoice/cancel'],
		['restore', 'PUT', '/docs/invoice/restore'],
		['delete', 'DELETE', '/docs/invoice'],
	])('%s sends a form body to %s %s', async (operation, method, url) => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: {
				resource: 'invoice',
				operation,
				cif: 'RO12345674',
				seriesName: 'TEST',
				number: '0055',
				deleteCollect: true,
			},
			httpRequestWithAuthentication: async () =>
				ok({ seriesName: 'TEST', number: '0055' }, 'Documentul a fost anulat.'),
		});
		const [output] = await node.execute.call(context);
		const request = httpRequestWithAuthentication.mock.calls[0][1];
		expect(request).toMatchObject({
			method,
			url,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		});
		expect(request.body).toBe(
			`cif=RO12345674&seriesName=TEST&number=0055${operation === 'delete' ? '&deleteCollect=1' : ''}`,
		);
		expect(output[0].json).toMatchObject({ success: true, number: '0055' });
	});

	it('does not retry cancel on 5xx', async () => {
		const call = vi
			.fn()
			.mockRejectedValue(wrappedHttpError(500, { status: 500, statusMessage: 'Eroare' }));
		const { context } = createContext({
			params: {
				resource: 'invoice',
				operation: 'cancel',
				cif: 'RO12345674',
				seriesName: 'TEST',
				number: '1',
			},
			httpRequestWithAuthentication: async (t, o) => await call(t, o),
		});
		await expect(node.execute.call(context)).rejects.toThrow('Eroare');
		expect(call).toHaveBeenCalledTimes(1);
	});

	it('collects a payment', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: {
				resource: 'invoice',
				operation: 'collect',
				cif: 'RO12345674',
				seriesName: 'TEST',
				number: '0055',
				collectType: 'Ordin de plata',
				collectFields: { documentNumber: 'OP 7001', value: 0 },
			},
			httpRequestWithAuthentication: async () =>
				ok({ collects: [{ type: 'Ordin de plata', value: 100 }] }),
		});
		await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1].body).toBe(
			'cif=RO12345674&seriesName=TEST&number=0055&collect%5Btype%5D=Ordin+de+plata&collect%5BdocumentNumber%5D=OP+7001',
		);
	});

	it('reverses an invoice with a reference document', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: {
				resource: 'invoice',
				operation: 'reverse',
				cif: 'RO12345674',
				seriesName: 'TEST',
				number: '0568',
				reverseSeriesName: '',
				refund: true,
			},
			httpRequestWithAuthentication: async () => ok({ seriesName: 'TEST', number: '0569' }),
		});
		await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1].body).toMatchObject({
			cif: 'RO12345674',
			seriesName: 'TEST',
			referenceDocument: { type: 'Factura', seriesName: 'TEST', number: '0568', refund: 1 },
		});
	});

	it('lists invoices across pages with filters', async () => {
		const call = vi.fn(async (_t: string, options: IDataObject) => {
			const offset = (options.qs as IDataObject).offset as number;
			const size = offset === 0 ? 100 : 5;
			return ok(Array.from({ length: size }, (_, index) => ({ id: String(offset + index) })));
		});
		const { context } = createContext({
			params: {
				resource: 'invoice',
				operation: 'getAll',
				cif: 'RO12345674',
				returnAll: true,
				invoiceFilters: { clientCif: '23456783', issuedAfter: '2026-01-01T00:00:00', canceled: 0 },
			},
			httpRequestWithAuthentication: call,
		});
		const [output] = await node.execute.call(context);
		expect(call).toHaveBeenCalledTimes(2);
		expect(call.mock.calls[0][1].qs).toEqual({
			cif: 'RO12345674',
			canceled: 0,
			issuedAfter: '2026-01-01',
			'client[cif]': '23456783',
			limitPerPage: 100,
			offset: 0,
		});
		expect(output).toHaveLength(105);
	});

	it('lists clients with a limit', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: {
				resource: 'client',
				operation: 'getAll',
				cif: 'RO12345674',
				returnAll: false,
				limit: 2,
				clientFilters: { name: 'Test' },
			},
			httpRequestWithAuthentication: async () => ok([{ name: 'A' }, { name: 'B' }, { name: 'C' }]),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			url: '/nomenclature/clients',
			qs: { name: 'Test', cif: 'RO12345674', offset: 0 },
		});
		expect(output.map((item) => item.json.name)).toEqual(['A', 'B']);
	});

	it('loads companies for the company dropdown', async () => {
		const httpRequestWithAuthentication = vi.fn(async () =>
			ok([{ cif: 'RO12345674', company: 'TEST SRL' }]),
		);
		const context = {
			helpers: { httpRequestWithAuthentication },
			getNode: () => ({ name: 'Oblio' }),
		} as unknown as ILoadOptionsFunctions;
		const options = await node.methods.loadOptions.getCompanies.call(context);
		expect(options).toEqual([{ name: 'TEST SRL (RO12345674)', value: 'RO12345674' }]);
	});

	it('continues on fail', async () => {
		const { context } = createContext({
			continueOnFail: true,
			params: {
				resource: 'invoice',
				operation: 'get',
				cif: 'RO12345674',
				seriesName: 'TEST',
				number: '9',
			},
			httpRequestWithAuthentication: async () => {
				throw wrappedHttpError(404, { status: 404, statusMessage: 'Documentul nu exista' });
			},
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json).toEqual({ error: 'Documentul nu exista' });
	});
});
