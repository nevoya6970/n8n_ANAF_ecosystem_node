import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { sleep } from 'n8n-workflow';
import type { MessageExtractor } from '../shared/http';
import { defaultMessageExtractor, toNodeApiError, withRetry } from '../shared/http';

export const CREDENTIAL_TYPE = 'oblioApi';
export const BASE_URL = 'https://www.oblio.eu/api';

/**
 * Oblio limits: 30 requests per 100 seconds for requests that generate documents, and
 * 30 requests per 10 seconds for every other request. One execution spaces its calls
 * accordingly.
 */
export const DOCUMENT_INTERVAL_MS = 3400;
export const DEFAULT_INTERVAL_MS = 350;

export interface OblioResponse {
	status?: number;
	statusMessage?: string;
	data?: unknown;
}

export const oblioMessageExtractor: MessageExtractor = (body, text) => {
	let data: unknown = body;
	if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
		try {
			data = JSON.parse(text);
		} catch {
			data = undefined;
		}
	}
	if (data && typeof data === 'object') {
		const message = (data as IDataObject).statusMessage;
		if (typeof message === 'string' && message) return message;
	}
	return defaultMessageExtractor(data ?? body, text);
};

/** Encode an object as application/x-www-form-urlencoded, nesting like `collect[type]=...`. */
export function toFormBody(data: IDataObject): string {
	const params = new URLSearchParams();
	const append = (prefix: string, value: unknown) => {
		if (value === undefined || value === null || value === '') return;
		if (typeof value === 'object' && !Array.isArray(value)) {
			for (const [key, nested] of Object.entries(value as IDataObject))
				append(`${prefix}[${key}]`, nested);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((nested, index) => append(`${prefix}[${index}]`, nested));
			return;
		}
		params.append(prefix, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
	};
	for (const [key, value] of Object.entries(data)) append(key, value);
	return params.toString();
}

/** Flatten nested query objects (`client[cif]`) because Oblio expects bracket notation. */
export function flattenQuery(data: IDataObject): IDataObject {
	const result: IDataObject = {};
	const walk = (prefix: string, value: unknown) => {
		if (value === undefined || value === null || value === '') return;
		if (typeof value === 'object' && !Array.isArray(value)) {
			for (const [key, nested] of Object.entries(value as IDataObject))
				walk(`${prefix}[${key}]`, nested);
			return;
		}
		result[prefix] = typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number);
	};
	for (const [key, value] of Object.entries(data)) walk(key, value);
	return result;
}

export function createThrottle() {
	let last = 0;
	return async (intervalMs: number) => {
		const wait = last + intervalMs - Date.now();
		if (wait > 0) await sleep(wait);
		last = Date.now();
	};
}

export interface OblioRequest {
	method: IHttpRequestMethods;
	path: string;
	qs?: IDataObject;
	/** JSON body (document creation). */
	json?: IDataObject;
	/** Form body (cancel, restore, delete, collect). */
	form?: IDataObject;
	/** Generates a document: uses the stricter rate limit. */
	generatesDocument?: boolean;
	/** Safe to retry on 5xx / network errors (reads, or writes carrying an idempotency key). */
	retrySafe?: boolean;
}

export async function oblioRequest(
	ctx: IExecuteFunctions,
	itemIndex: number,
	throttle: (intervalMs: number) => Promise<void>,
	request: OblioRequest,
): Promise<OblioResponse> {
	const options: IHttpRequestOptions = {
		method: request.method,
		baseURL: BASE_URL,
		url: request.path,
		qs: request.qs ? flattenQuery(request.qs) : undefined,
		headers: { Accept: 'application/json' },
		json: true,
	};
	if (request.json) {
		options.body = request.json;
		options.headers!['Content-Type'] = 'application/json';
	} else if (request.form) {
		options.body = toFormBody(request.form);
		options.headers!['Content-Type'] = 'application/x-www-form-urlencoded';
	}

	const result = await withRetry(
		async () => {
			await throttle(request.generatesDocument ? DOCUMENT_INTERVAL_MS : DEFAULT_INTERVAL_MS);
			return (await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				CREDENTIAL_TYPE,
				options,
			)) as OblioResponse;
		},
		{ retryOnServerError: request.retrySafe ?? false, maxDelayMs: 100000 },
	);
	if (!result.ok)
		throw toNodeApiError(ctx.getNode(), result.error, itemIndex, oblioMessageExtractor);

	const response = result.value;
	if (typeof response?.status === 'number' && response.status >= 400) {
		throw toNodeApiError(
			ctx.getNode(),
			{ message: response.statusMessage, response: { status: response.status, data: response } },
			itemIndex,
			oblioMessageExtractor,
		);
	}
	return response;
}
