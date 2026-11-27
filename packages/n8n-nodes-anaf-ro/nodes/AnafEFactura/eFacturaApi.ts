import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
} from 'n8n-workflow';
import type { MessageExtractor, RetryOptions } from '../shared/http';
import { bodyToText, defaultMessageExtractor, toNodeApiError, withRetry } from '../shared/http';
import { parseAnafHeader } from '../shared/xml';

export const CREDENTIAL_TYPE = 'anafEFacturaOAuth2Api';

export type AnafEnvironment = 'test' | 'prod';

export function baseUrl(environment: AnafEnvironment): string {
	return `https://api.anaf.ro/${environment === 'prod' ? 'prod' : 'test'}/FCTEL/rest`;
}

/** Upstream message extraction for every shape of error ANAF e-Factura returns. */
export const anafMessageExtractor: MessageExtractor = (body, text) => {
	const header = text.includes('<') ? parseAnafHeader(text) : undefined;
	if (header?.errors.length) return header.errors.join('; ');
	let data: unknown = body;
	if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
		try {
			data = JSON.parse(text);
		} catch {
			data = undefined;
		}
	}
	if (data && typeof data === 'object') {
		const messages = (data as IDataObject).Messages;
		if (Array.isArray(messages) && messages.length) {
			return messages
				.map((entry) => (entry as IDataObject).message)
				.filter(Boolean)
				.join('; ');
		}
	}
	return defaultMessageExtractor(data ?? body, text);
};

export interface AnafRequest {
	method: IHttpRequestMethods;
	url: string;
	qs?: IDataObject;
	body?: string;
	contentType?: string;
	binary?: boolean;
	retry?: RetryOptions;
}

/**
 * Authenticated request to api.anaf.ro. Always returns the full response so callers can
 * inspect the content type (ANAF answers some errors with HTTP 200).
 */
export async function anafRequest(
	ctx: IExecuteFunctions,
	itemIndex: number,
	request: AnafRequest,
): Promise<IN8nHttpFullResponse> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: request.url,
		qs: request.qs,
		returnFullResponse: true,
		json: false,
		headers: {},
	};
	if (request.body !== undefined) {
		options.body = request.body;
		options.headers!['Content-Type'] = request.contentType ?? 'text/plain';
	}
	if (request.binary) options.encoding = 'arraybuffer';

	const result = await withRetry(
		async () =>
			(await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				CREDENTIAL_TYPE,
				options,
			)) as IN8nHttpFullResponse,
		request.retry,
	);
	if (!result.ok)
		throw toNodeApiError(ctx.getNode(), result.error, itemIndex, anafMessageExtractor);
	return result.value;
}

export function headerValue(headers: IDataObject | undefined, name: string): string {
	if (!headers) return '';
	const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
	const value = key ? headers[key] : undefined;
	return Array.isArray(value) ? String(value[0]) : value === undefined ? '' : String(value);
}

export function responseText(response: IN8nHttpFullResponse): string {
	return bodyToText(response.body);
}

/** Parse a JSON body that may arrive as text or Buffer. Returns undefined if not JSON. */
export function responseJson(response: IN8nHttpFullResponse): IDataObject | undefined {
	if (response.body && typeof response.body === 'object' && !Buffer.isBuffer(response.body)) {
		return response.body as IDataObject;
	}
	const text = responseText(response).trim();
	if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
	try {
		return JSON.parse(text) as IDataObject;
	} catch {
		return undefined;
	}
}

/** Raise an error that ANAF returned with HTTP 200 (XML `<Errors>` or JSON `eroare`). */
export function upstreamError(
	ctx: IExecuteFunctions,
	itemIndex: number,
	message: string,
	body: string,
) {
	return toNodeApiError(
		ctx.getNode(),
		{ message, response: { data: body } },
		itemIndex,
		() => message,
	);
}
