import type {
	IAuthenticate,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * SmartBill Cloud API credential.
 *
 * - V1 endpoints (invoices) use HTTP Basic auth with the account email and the API token.
 * - V3 endpoints (clients) use a separate Bearer token and carry the company CIF in the path.
 * Both tokens are generated on https://cloud.smartbill.ro/core/integrari/ (section API).
 */
export class SmartBillApi implements ICredentialType {
	name = 'smartBillApi';

	displayName = 'SmartBill API';

	icon: Icon = { light: 'file:smartBill.svg', dark: 'file:smartBill.dark.svg' };

	documentationUrl =
		'https://github.com/nevoya6970/n8n_ANAF_ecosystem_node/tree/main/packages/n8n-nodes-smartbill#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@email.com',
			default: '',
			required: true,
			description: 'The email address shown in SmartBill Cloud under Integrari → API',
		},
		{
			displayName: 'API Token (V1)',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The API token shown in SmartBill Cloud under Integrari → API. Used for invoices.',
		},
		{
			displayName: 'Company CIF',
			name: 'companyCif',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. RO12345674',
			description: 'The CIF of your company exactly as configured in SmartBill Cloud',
		},
		{
			displayName: 'Bearer Token (V3)',
			name: 'v3Token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional. The V3 Bearer token generated in SmartBill Cloud under Integrari. Required only for the Client operations.',
		},
	];

	authenticate: IAuthenticate = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => {
		const url = `${requestOptions.baseURL ?? ''}${requestOptions.url ?? ''}`;
		const headers = { ...(requestOptions.headers ?? {}) };
		if (/\/SBORO\/api\/v3\//.test(url)) {
			headers.Authorization = `Bearer ${credentials.v3Token as string}`;
			return { ...requestOptions, headers };
		}
		return {
			...requestOptions,
			headers,
			auth: { username: credentials.email as string, password: credentials.token as string },
		};
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://ws.smartbill.ro/SBORO/api',
			url: '/tax',
			qs: { cif: '={{$credentials.companyCif}}' },
			headers: { Accept: 'application/json' },
		},
	};
}
