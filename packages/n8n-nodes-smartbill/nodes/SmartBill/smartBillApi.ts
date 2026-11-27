import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
} from 'n8n-workflow';
import { sleep } from 'n8n-workflow';
import type { MessageExtractor } from '../shared/http';
import {
	bodyToText,
	defaultMessageExtractor,
	extractHttpError,
	toNodeApiError,
	withRetry,
} from '../shared/http';

export const CREDENTIAL_TYPE = 'smartBillApi';
export const BASE_URL = 'https://ws.smartbill.ro/SBORO/api';

/**
 * SmartBill V1 allows 30 calls per 10 seconds per token and blocks the token for 10 minutes
 * when the limit is exceeded. Spacing calls 350 ms apart keeps one execution under the limit.
 */
export const V1_MIN_INTERVAL_MS = 350;

const V1_RATE_LIMIT_MESSAGE =
	'SmartBill rate limit exceeded. V1 allows 30 calls per 10 seconds per token and blocks access for 10 minutes when the limit is exceeded.';

/** V1 reports errors in `errorText`; V3 in `errors[].message`. */
export const smartBillMessageExtractor: MessageExtractor = (body, text) => {
	let data: unknown = body;
	if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
		try {
			data = JSON.parse(text);
		} catch {
			data = undefined;
		}
	}
	if (data && typeof data === 'object') {
		const obj = data as IDataObject;
		if (typeof obj.errorText === 'string' && obj.errorText) return obj.errorText;
		if (Array.isArray(obj.errors) && obj.errors.length) {
			return obj.errors
				.map((entry) => {
					const error = entry as IDataObject;
					return error.param
						? `${error.message as string} (${error.param as string})`
						: error.message;
				})
				.filter(Boolean)
				.join('; ');
		}
	}
	return defaultMessageExtractor(data ?? body, text);
};

/** Keeps a minimum spacing between calls within one node execution. */
export function createThrottle(minIntervalMs: number) {
	let last = 0;
	return async () => {
		const wait = last + minIntervalMs - Date.now();
		if (wait > 0) await sleep(wait);
		last = Date.now();
	};
}

export interface SmartBillRequest {
	method: IHttpRequestMethods;
	/** Path relative to BASE_URL, for example `/invoice/v2` or `/v3/companies/{cif}/clients`. */
	path: string;
	qs?: IDataObject;
	body?: IDataObject;
	binary?: boolean;
	/** True for requests that create or change data: these are never retried on 5xx. */
	write?: boolean;
}

export async function smartBillRequest(
	ctx: IExecuteFunctions,
	itemIndex: number,
	throttle: () => Promise<void>,
	request: SmartBillRequest,
): Promise<IN8nHttpFullResponse> {
	const isV3 = request.path.startsWith('/v3/');
	const options: IHttpRequestOptions = {
		method: request.method,
		baseURL: BASE_URL,
		url: request.path,
		qs: request.qs,
		headers: { Accept: request.binary ? 'application/octet-stream' : 'application/json' },
		returnFullResponse: true,
		json: !request.binary,
	};
	if (request.body) {
		options.body = request.body;
		options.headers!['Content-Type'] = 'application/json';
	}
	if (request.binary) options.encoding = 'arraybuffer';

	const result = await withRetry(
		async () => {
			if (!isV3) await throttle();
			return (await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				CREDENTIAL_TYPE,
				options,
			)) as IN8nHttpFullResponse;
		},
		{
			retryOnServerError: !request.write,
			// V1 blocks the token for 10 minutes on overrun, so retrying only extends the block.
			retryRateLimit: isV3,
			maxDelayMs: 60000,
		},
	);

	if (!result.ok) {
		const info = extractHttpError(result.error);
		if (info.status === 429 && !isV3) {
			throw toNodeApiError(ctx.getNode(), result.error, itemIndex, () => V1_RATE_LIMIT_MESSAGE);
		}
		throw toNodeApiError(ctx.getNode(), result.error, itemIndex, smartBillMessageExtractor);
	}

	// V1 can answer HTTP 200 with a non-empty errorText.
	const body = result.value.body as IDataObject | undefined;
	if (!request.binary && body && typeof body.errorText === 'string' && body.errorText) {
		throw toNodeApiError(
			ctx.getNode(),
			{ message: body.errorText, response: { data: body } },
			itemIndex,
			smartBillMessageExtractor,
		);
	}
	return result.value;
}

export function responseBuffer(response: IN8nHttpFullResponse): Buffer {
	const body = response.body;
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof ArrayBuffer) return Buffer.from(body);
	return Buffer.from(bodyToText(body));
}
