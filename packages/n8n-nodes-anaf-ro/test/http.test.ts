import { describe, expect, it, vi } from 'vitest';
import type { INode } from 'n8n-workflow';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

import { sleep } from 'n8n-workflow';
import { extractHttpError, parseRetryAfter, toNodeApiError, withRetry } from '../nodes/shared/http';
import { httpError, wrappedHttpError } from './helpers/mockContext';

const node: INode = {
	id: '1',
	name: 'Test',
	type: 'test',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

describe('http helpers', () => {
	it('reads status, headers and body from axios-style and wrapped errors', () => {
		expect(extractHttpError(httpError(429, { a: 1 }, { 'retry-after': '3' }))).toMatchObject({
			status: 429,
			headers: { 'retry-after': '3' },
			body: { a: 1 },
		});
		expect(extractHttpError(wrappedHttpError(503, 'down'))).toMatchObject({
			status: 503,
			body: 'down',
		});
	});

	it('parses Retry-After seconds and HTTP dates', () => {
		expect(parseRetryAfter({ 'retry-after': '5' })).toBe(5000);
		const now = Date.parse('2026-01-01T00:00:00Z');
		expect(parseRetryAfter({ 'retry-after': 'Thu, 01 Jan 2026 00:00:10 GMT' }, now)).toBe(10000);
		expect(parseRetryAfter({})).toBeUndefined();
	});

	it('retries 429 using Retry-After, then succeeds', async () => {
		vi.mocked(sleep).mockClear();
		const request = vi
			.fn()
			.mockRejectedValueOnce(httpError(429, {}, { 'retry-after': '2' }))
			.mockResolvedValueOnce('ok');
		const result = await withRetry(request, { retryOnServerError: false });
		expect(result).toEqual({ ok: true, value: 'ok' });
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('does not retry 5xx when retryOnServerError is off', async () => {
		const request = vi.fn().mockRejectedValue(httpError(500, 'boom'));
		const result = await withRetry(request, { retryOnServerError: false });
		expect(result.ok).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('gives up after maxRetries', async () => {
		const request = vi.fn().mockRejectedValue(httpError(503, 'busy'));
		const result = await withRetry(request, { maxRetries: 2 });
		expect(result.ok).toBe(false);
		expect(request).toHaveBeenCalledTimes(3);
	});

	it('never retries 4xx other than 429', async () => {
		const request = vi.fn().mockRejectedValue(httpError(400, { message: 'bad' }));
		await withRetry(request);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('builds a NodeApiError with the upstream message and HTTP code', () => {
		const error = toNodeApiError(node, httpError(400, { message: 'CUI invalid' }), 2);
		expect(error.message).toBe('CUI invalid');
		expect(error.httpCode).toBe('400');
		expect(error.context.itemIndex).toBe(2);
	});

	it('decodes Buffer bodies when extracting messages', () => {
		const error = toNodeApiError(node, httpError(400, Buffer.from('{"eroare":"Id invalid"}')), 0);
		expect(error.message).toBe('Id invalid');
	});
});
