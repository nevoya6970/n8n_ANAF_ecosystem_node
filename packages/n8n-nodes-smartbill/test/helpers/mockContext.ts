import { vi } from 'vitest';
import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';

export type ParamMap = Record<string, unknown>;

export interface MockContextOptions {
	/** Parameters for every item, or one map per item. */
	params: ParamMap | ParamMap[];
	items?: INodeExecutionData[];
	continueOnFail?: boolean;
	httpRequest?: (options: IDataObject) => unknown;
	httpRequestWithAuthentication?: (credentialType: string, options: IDataObject) => unknown;
	credentials?: IDataObject;
	binary?: Record<string, Buffer>;
}

const node: INode = {
	id: 'test-node',
	name: 'Test Node',
	type: 'test',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function getPath(source: unknown, path: string): unknown {
	return path.split('.').reduce<unknown>((value, key) => {
		if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
		return undefined;
	}, source);
}

/** A fake IExecuteFunctions with mocked HTTP helpers. No network access is possible. */
export function createContext(options: MockContextOptions) {
	const items = options.items ?? [{ json: {} }];
	const paramsFor = (index: number): ParamMap =>
		Array.isArray(options.params) ? (options.params[index] ?? options.params[0]) : options.params;

	const httpRequest = vi.fn(async (requestOptions: IDataObject) => {
		if (!options.httpRequest) throw new Error('Unexpected unauthenticated HTTP request');
		return await options.httpRequest(requestOptions);
	});
	const httpRequestWithAuthentication = vi.fn(
		async (credentialType: string, requestOptions: IDataObject) => {
			if (!options.httpRequestWithAuthentication)
				throw new Error('Unexpected authenticated HTTP request');
			return await options.httpRequestWithAuthentication(credentialType, requestOptions);
		},
	);
	const prepareBinaryData = vi.fn(
		async (data: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> => ({
			data: data.toString('base64'),
			fileName,
			mimeType: mimeType ?? 'application/octet-stream',
			fileSize: String(data.length),
		}),
	);

	const context = {
		getInputData: () => items,
		getNode: () => node,
		continueOnFail: () => options.continueOnFail ?? false,
		getNodeParameter: (name: string, index: number, fallback?: unknown) => {
			const value = getPath(paramsFor(index), name);
			if (value === undefined) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Missing parameter "${name}" in test`);
			}
			return value;
		},
		getCredentials: vi.fn(async () => options.credentials ?? {}),
		helpers: {
			httpRequest,
			httpRequestWithAuthentication,
			prepareBinaryData,
			assertBinaryData: (index: number, property: string) => {
				const buffer = options.binary?.[property];
				if (!buffer) throw new Error(`No binary data in property "${property}" of item ${index}`);
				return { data: '', mimeType: 'application/xml', fileName: 'invoice.xml' } as IBinaryData;
			},
			getBinaryDataBuffer: async (_index: number, property: string) => {
				const buffer = options.binary?.[property];
				if (!buffer) throw new Error(`No binary data in property "${property}"`);
				return buffer;
			},
		},
	};

	return {
		context: context as unknown as IExecuteFunctions,
		httpRequest,
		httpRequestWithAuthentication,
		prepareBinaryData,
	};
}

/** Build an axios-like HTTP error, the shape thrown by n8n's httpRequest helper. */
export function httpError(status: number, data: unknown, headers: Record<string, string> = {}) {
	const error = new Error(`Request failed with status code ${status}`) as Error & IDataObject;
	error.response = { status, data, headers } as unknown as IDataObject;
	return error;
}

/** Same failure as wrapped by httpRequestWithAuthentication (a NodeApiError-like object with `cause`). */
export function wrappedHttpError(
	status: number,
	data: unknown,
	headers: Record<string, string> = {},
) {
	const error = new Error('The service was not able to process your request') as Error &
		IDataObject;
	error.httpCode = String(status);
	(error as unknown as { cause: unknown }).cause = httpError(status, data, headers);
	return error;
}
