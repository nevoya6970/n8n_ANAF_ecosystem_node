import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

/**
 * Normalised view of an HTTP failure thrown by `this.helpers.httpRequest` or
 * `this.helpers.httpRequestWithAuthentication`. The first throws an axios-style error,
 * the second wraps it in a NodeApiError whose `cause` holds the original error.
 */
export interface HttpErrorInfo {
	status?: number;
	headers: Record<string, unknown>;
	body: unknown;
	code?: string;
}

const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN']);
const RETRYABLE_SERVER_STATUSES = new Set([500, 502, 503, 504]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object'
		? (value as Record<string, unknown>)
		: undefined;
}

export function extractHttpError(error: unknown): HttpErrorInfo {
	const err = asRecord(error) ?? {};
	const cause = asRecord(err.cause) ?? {};
	const response = asRecord(err.response) ?? asRecord(cause.response) ?? {};

	const rawStatus =
		response.status ?? response.statusCode ?? err.httpCode ?? err.statusCode ?? cause.status;
	const status = rawStatus === undefined || rawStatus === null ? undefined : Number(rawStatus);

	return {
		status: Number.isFinite(status) ? status : undefined,
		headers: asRecord(response.headers) ?? {},
		body: response.data ?? response.body,
		code:
			(typeof err.code === 'string' ? err.code : undefined) ??
			(typeof cause.code === 'string' ? cause.code : undefined),
	};
}

/** Decode a response body that may arrive as a Buffer, ArrayBuffer, string or object. */
export function bodyToText(body: unknown): string {
	if (body === undefined || body === null) return '';
	if (typeof body === 'string') return body;
	if (Buffer.isBuffer(body)) return body.toString('utf8');
	if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
	try {
		return JSON.stringify(body);
	} catch {
		return String(body);
	}
}

/** Parse a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(
	headers: Record<string, unknown>,
	now = Date.now(),
): number | undefined {
	const raw = headers['retry-after'] ?? headers['Retry-After'];
	if (raw === undefined || raw === null || raw === '') return undefined;
	const value = String(Array.isArray(raw) ? raw[0] : raw).trim();
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, date - now);
	return undefined;
}

export interface RetryOptions {
	/** How many times to retry after the first attempt. */
	maxRetries?: number;
	/**
	 * Retry on 5xx and transient network errors. Turn this off for requests that create
	 * something upstream (uploads, invoices), where a lost response could mean the request
	 * was processed and a retry would duplicate it. 429 is always retried, because the
	 * server rejected the request before processing it.
	 */
	retryOnServerError?: boolean;
	/**
	 * Retry HTTP 429 responses (default true). Turn off for APIs that block the client for a long
	 * period once the limit is exceeded, where retrying only extends the block.
	 */
	retryRateLimit?: boolean;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

export function isRetryable(
	info: HttpErrorInfo,
	retryOnServerError: boolean,
	retryRateLimit = true,
): boolean {
	if (info.status === 429) return retryRateLimit;
	if (!retryOnServerError) return false;
	if (info.status !== undefined) return RETRYABLE_SERVER_STATUSES.has(info.status);
	return info.code !== undefined && RETRYABLE_NETWORK_CODES.has(info.code);
}

export type RequestResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Run `request`, retrying on rate limits (and optionally transient failures) with
 * exponential backoff. A `Retry-After` header always wins over the computed delay.
 * Never throws: the final failure is returned so callers can map it to a NodeApiError.
 */
export async function withRetry<T>(
	request: () => Promise<T>,
	options: RetryOptions = {},
): Promise<RequestResult<T>> {
	const maxRetries = options.maxRetries ?? 3;
	const retryOnServerError = options.retryOnServerError ?? true;
	const retryRateLimit = options.retryRateLimit ?? true;
	const baseDelayMs = options.baseDelayMs ?? 1000;
	const maxDelayMs = options.maxDelayMs ?? 30000;

	for (let attempt = 0; ; attempt++) {
		let failure: unknown;
		try {
			return { ok: true, value: await request() };
		} catch (error) {
			failure = error;
		}
		const info = extractHttpError(failure);
		if (attempt >= maxRetries || !isRetryable(info, retryOnServerError, retryRateLimit)) {
			return { ok: false, error: failure };
		}
		const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
		const retryAfter = parseRetryAfter(info.headers);
		await sleep(retryAfter !== undefined ? Math.min(retryAfter, 10 * maxDelayMs) : backoff);
	}
}

/** Re-raise anything caught in a node as an n8n error with the right item index. */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError) {
		return new NodeApiError(node, error as unknown as JsonObject, { itemIndex });
	}
	return new NodeOperationError(node, error as Error, { itemIndex });
}

export type MessageExtractor = (body: unknown, text: string) => string | undefined;

/** Generic upstream message extraction for JSON bodies (`message`, `error`, `errors[]`). */
export const defaultMessageExtractor: MessageExtractor = (body, text) => {
	let data: unknown = body;
	if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
		try {
			data = JSON.parse(text);
		} catch {
			return text.trim() ? text.trim().slice(0, 1000) : undefined;
		}
	}
	const obj = asRecord(data);
	if (!obj) return undefined;
	for (const key of ['message', 'eroare', 'error_description', 'errorMessage', 'statusMessage']) {
		if (typeof obj[key] === 'string' && obj[key]) return obj[key] as string;
	}
	if (typeof obj.error === 'string' && obj.error) return obj.error;
	return undefined;
};

/**
 * Convert any thrown request error into a NodeApiError whose message is the upstream
 * error message. Request options (and therefore credentials) are never copied into the
 * error, so nothing secret ends up in execution logs.
 */
export function toNodeApiError(
	node: INode,
	error: unknown,
	itemIndex: number,
	extract: MessageExtractor = defaultMessageExtractor,
): NodeApiError {
	const info = extractHttpError(error);
	const text = bodyToText(info.body);
	const upstream = extract(info.body, text) ?? defaultMessageExtractor(info.body, text);
	const fallback = error instanceof Error ? error.message : 'Request failed';
	const message = upstream ?? fallback;
	const httpCode = info.status !== undefined ? String(info.status) : undefined;

	const errorResponse: IDataObject = { message };
	if (httpCode) errorResponse.httpCode = httpCode;
	if (text) errorResponse.body = text.slice(0, 5000);

	return new NodeApiError(node, errorResponse as JsonObject, {
		message,
		description: httpCode ? `Upstream responded with HTTP ${httpCode}` : undefined,
		httpCode,
		itemIndex,
	});
}
