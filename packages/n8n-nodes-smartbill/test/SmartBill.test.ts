import { describe, expect, it, vi } from 'vitest';
import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import { SmartBillApi } from '../credentials/SmartBillApi.credentials';
import { SmartBill } from '../nodes/SmartBill/SmartBill.node';
import { createContext, wrappedHttpError } from './helpers/mockContext';

// All values are fictitious placeholders.
const credentials = {
	email: 'user@example.com',
	token: 'test-token-not-real',
	companyCif: 'RO12345674',
	v3Token: 'test-bearer-not-real',
};
const node = new SmartBill();
const full = (body: unknown, headers: IDataObject = {}) => ({
	body,
	headers,
	statusCode: 200,
	statusMessage: 'OK',
});

const createParams = {
	resource: 'invoice',
	operation: 'create',
	seriesName: 'TEST',
	clientName: 'Client Test SRL',
	clientCountry: 'Romania',
	clientFields: { vatCode: 'RO23456783', isTaxPayer: true, city: '' },
	productsInput: 'fields',
	products: {
		product: [
			{
				name: 'Consulting',
				quantity: 2,
				measuringUnitName: 'ora',
				price: 100,
				taxPercentage: 21,
				code: '',
			},
		],
	},
	additionalFields: { issueDate: '2026-01-15T00:00:00', dueDate: '2026-01-30', exchangeRate: 0 },
};

describe('SmartBill credential', () => {
	const credential = new SmartBillApi();
	const authenticate = credential.authenticate as (
		c: IDataObject,
		o: IHttpRequestOptions,
	) => Promise<IHttpRequestOptions>;

	it('uses Basic auth for V1 endpoints', async () => {
		const options = await authenticate(credentials, {
			baseURL: 'https://ws.smartbill.ro/SBORO/api',
			url: '/invoice/v2',
		});
		expect(options.auth).toEqual({ username: 'user@example.com', password: 'test-token-not-real' });
		expect(options.headers?.Authorization).toBeUndefined();
	});

	it('uses the Bearer token for V3 endpoints', async () => {
		const options = await authenticate(credentials, {
			baseURL: 'https://ws.smartbill.ro/SBORO/api',
			url: '/v3/companies/RO12345674/clients',
		});
		expect(options.headers?.Authorization).toBe('Bearer test-bearer-not-real');
		expect(options.auth).toBeUndefined();
	});

	it('tests against GET /tax with the company CIF', () => {
		expect(credential.test.request).toMatchObject({
			url: '/tax',
			qs: { cif: '={{$credentials.companyCif}}' },
		});
	});
});

describe('SmartBill node', () => {
	it('creates an invoice from fields', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials,
			params: createParams,
			httpRequestWithAuthentication: async () =>
				full({
					errorText: '',
					message: '',
					number: '0007',
					series: 'TEST',
					documentId: 1,
					url: '',
				}),
		});

		const [output] = await node.execute.call(context);

		const [type, request] = httpRequestWithAuthentication.mock.calls[0];
		expect(type).toBe('smartBillApi');
		expect(request).toMatchObject({
			method: 'POST',
			baseURL: 'https://ws.smartbill.ro/SBORO/api',
			url: '/invoice/v2',
			json: true,
		});
		expect(request.body).toEqual({
			companyVatCode: 'RO12345674',
			seriesName: 'TEST',
			client: {
				name: 'Client Test SRL',
				country: 'Romania',
				vatCode: 'RO23456783',
				isTaxPayer: true,
			},
			products: [
				{
					name: 'Consulting',
					quantity: 2,
					measuringUnitName: 'ora',
					price: 100,
					taxPercentage: 21,
				},
			],
			issueDate: '2026-01-15',
			dueDate: '2026-01-30',
		});
		expect(output[0].json).toMatchObject({ number: '0007', series: 'TEST' });
	});

	it('accepts products as JSON', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials,
			params: {
				...createParams,
				productsInput: 'json',
				productsJson:
					'[{"name":"Discount","isDiscount":true,"numberOfItems":1,"discountType":2,"discountPercentage":10,"quantity":1,"price":0,"measuringUnitName":"buc","taxPercentage":21}]',
			},
			httpRequestWithAuthentication: async () =>
				full({ errorText: '', number: '0008', series: 'TEST' }),
		});
		await node.execute.call(context);
		expect((httpRequestWithAuthentication.mock.calls[0][1].body as IDataObject).products).toEqual([
			expect.objectContaining({ isDiscount: true, discountPercentage: 10 }),
		]);
	});

	it('raises errorText even when SmartBill answers HTTP 200', async () => {
		const { context } = createContext({
			credentials,
			params: createParams,
			httpRequestWithAuthentication: async () =>
				full({
					errorText: 'Seria nu a fost gasita! Folositi o serie creata in contul de cloud.',
					number: '',
				}),
		});
		await expect(node.execute.call(context)).rejects.toThrow('Seria nu a fost gasita!');
	});

	it('raises errorText from HTTP 400 and does not retry invoice creation on 5xx', async () => {
		const call = vi
			.fn()
			.mockRejectedValueOnce(wrappedHttpError(500, { errorText: 'Eroare interna' }));
		const { context } = createContext({
			credentials,
			params: createParams,
			httpRequestWithAuthentication: async (t, o) => await call(t, o),
		});
		await expect(node.execute.call(context)).rejects.toThrow('Eroare interna');
		expect(call).toHaveBeenCalledTimes(1);
	});

	it('does not retry V1 rate limits and explains the 10 minute block', async () => {
		const call = vi.fn().mockRejectedValue(wrappedHttpError(429, ''));
		const { context } = createContext({
			credentials,
			params: {
				resource: 'invoice',
				operation: 'getPaymentStatus',
				seriesName: 'TEST',
				number: '0007',
			},
			httpRequestWithAuthentication: async (t, o) => await call(t, o),
		});
		await expect(node.execute.call(context)).rejects.toThrow('blocks access for 10 minutes');
		expect(call).toHaveBeenCalledTimes(1);
	});

	it('retries read requests on 503', async () => {
		const call = vi
			.fn()
			.mockRejectedValueOnce(wrappedHttpError(503, 'busy'))
			.mockResolvedValueOnce(
				full({
					errorText: '',
					invoiceTotalAmount: 242,
					paidAmount: 0,
					unpaidAmount: 242,
					paid: false,
				}),
			);
		const { context } = createContext({
			credentials,
			params: {
				resource: 'invoice',
				operation: 'getPaymentStatus',
				seriesName: 'TEST',
				number: '0007',
			},
			httpRequestWithAuthentication: async (t, o) => await call(t, o),
		});
		const [output] = await node.execute.call(context);
		expect(call).toHaveBeenCalledTimes(2);
		expect(call.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			url: '/invoice/paymentstatus',
			qs: { cif: 'RO12345674', seriesname: 'TEST', number: '0007' },
		});
		expect(output[0].json).toMatchObject({ paid: false, unpaidAmount: 242 });
	});

	it('downloads the invoice PDF as binary', async () => {
		const pdf = Buffer.from('%PDF-1.7 fake');
		const { context, httpRequestWithAuthentication, prepareBinaryData } = createContext({
			credentials,
			params: {
				resource: 'invoice',
				operation: 'getPdf',
				seriesName: 'TEST',
				number: '0007',
				outputBinaryPropertyName: 'data',
			},
			httpRequestWithAuthentication: async () =>
				full(pdf, { 'content-type': 'application/octet-stream' }),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			url: '/invoice/pdf',
			encoding: 'arraybuffer',
			headers: { Accept: 'application/octet-stream' },
		});
		expect(prepareBinaryData).toHaveBeenCalledWith(pdf, 'TEST-0007.pdf', 'application/pdf');
		expect(output[0].json).toMatchObject({ fileName: 'TEST-0007.pdf' });
	});

	it.each([
		['cancel', 'PUT', '/invoice/cancel'],
		['restore', 'PUT', '/invoice/restore'],
		['delete', 'DELETE', '/invoice'],
	])('%s calls %s %s', async (operation, method, url) => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials,
			params: { resource: 'invoice', operation, seriesName: 'TEST', number: '0007' },
			httpRequestWithAuthentication: async () => full({ errorText: '', message: '' }),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			method,
			url,
			qs: { cif: 'RO12345674', seriesname: 'TEST', number: '0007' },
		});
		expect(output[0].json).toMatchObject({ success: true, seriesName: 'TEST', number: '0007' });
	});

	it('reverses an invoice', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials,
			params: {
				resource: 'invoice',
				operation: 'reverse',
				seriesName: 'TEST',
				number: '0007',
				reverseIssueDate: '2026-02-01T00:00:00',
			},
			httpRequestWithAuthentication: async () =>
				full({ errorText: '', number: '0009', series: 'TEST' }),
		});
		await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			url: '/invoice/reverse',
			body: {
				companyVatCode: 'RO12345674',
				seriesName: 'TEST',
				number: '0007',
				issueDate: '2026-02-01',
			},
		});
	});

	it('sends an invoice by email with Base64 subject and body', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials,
			params: {
				resource: 'invoice',
				operation: 'sendEmail',
				seriesName: 'TEST',
				number: '0007',
				emailOptions: { to: 'client@example.com', subject: 'Factura', bodyText: 'Buna ziua' },
			},
			httpRequestWithAuthentication: async () => full({ status: { code: 0, message: 'OK' } }),
		});
		await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1].body).toEqual({
			companyVatCode: 'RO12345674',
			seriesName: 'TEST',
			number: '0007',
			type: 'factura',
			to: 'client@example.com',
			subject: Buffer.from('Factura').toString('base64'),
			bodyText: Buffer.from('Buna ziua').toString('base64'),
		});
	});

	it('requires the V3 token for client operations', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials: { ...credentials, v3Token: '' },
			params: { resource: 'client', operation: 'get', clientId: '1' },
		});
		await expect(node.execute.call(context)).rejects.toThrow('Add the V3 Bearer token');
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('gets a client from V3', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			credentials,
			params: { resource: 'client', operation: 'get', clientId: 'abc' },
			httpRequestWithAuthentication: async () => full({ id: 'abc', name: 'Client Test SRL' }),
		});
		const [output] = await node.execute.call(context);
		expect(httpRequestWithAuthentication.mock.calls[0][1].url).toBe(
			'/v3/companies/RO12345674/clients/abc',
		);
		expect(output[0].json).toEqual({ id: 'abc', name: 'Client Test SRL' });
	});

	it('pages through clients with the after cursor', async () => {
		const call = vi.fn(async (_t: string, options: IDataObject) => {
			const after = (options.qs as IDataObject).after;
			if (!after) {
				return full({
					items: [{ id: 'c1' }, { id: 'c2' }],
					pagination: { next: 'https://next', previous: null },
				});
			}
			return full({ items: [{ id: 'c3' }], pagination: { next: null, previous: 'https://prev' } });
		});
		const { context } = createContext({
			credentials,
			params: {
				resource: 'client',
				operation: 'getAll',
				returnAll: true,
				filters: { name: 'Test' },
			},
			httpRequestWithAuthentication: call,
		});
		const [output] = await node.execute.call(context);
		expect(call.mock.calls[0][1].qs).toEqual({ name: 'Test', limit: 100 });
		expect(call.mock.calls[1][1].qs).toEqual({ name: 'Test', limit: 100, after: 'c2' });
		expect(output.map((item) => item.json.id)).toEqual(['c1', 'c2', 'c3']);
	});

	it('surfaces V3 validation errors with the parameter name', async () => {
		const { context } = createContext({
			credentials,
			params: { resource: 'client', operation: 'getAll', returnAll: false, limit: 5, filters: {} },
			httpRequestWithAuthentication: async () => {
				throw wrappedHttpError(400, {
					status: 400,
					type: 'validation_error',
					errors: [
						{
							code: 'invalid_field_value',
							message: "The 'limit' field must be between 1 and 100.",
							param: 'limit',
						},
					],
				});
			},
		});
		await expect(node.execute.call(context)).rejects.toThrow(
			"The 'limit' field must be between 1 and 100. (limit)",
		);
	});

	it('continues on fail', async () => {
		const { context } = createContext({
			continueOnFail: true,
			credentials,
			params: createParams,
			httpRequestWithAuthentication: async () => full({ errorText: 'Client invalid!' }),
		});
		const [output] = await node.execute.call(context);
		expect(output[0].json).toEqual({ error: 'Client invalid!' });
	});
});
