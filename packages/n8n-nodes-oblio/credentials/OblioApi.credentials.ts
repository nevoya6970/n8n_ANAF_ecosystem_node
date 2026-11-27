import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export const OBLIO_TOKEN_URL = 'https://www.oblio.eu/api/authorize/token';

/**
 * Oblio REST API credential.
 *
 * Oblio issues a Bearer access token (valid 3600 s) from POST /api/authorize/token, using the
 * account email as client_id and the API secret from Settings → Account Data as client_secret.
 * n8n calls preAuthentication when the cached token is empty and again after a 401, so the
 * token is refreshed automatically.
 */
export class OblioApi implements ICredentialType {
	name = 'oblioApi';

	displayName = 'Oblio API';

	icon: Icon = { light: 'file:oblio.svg', dark: 'file:oblio.dark.svg' };

	documentationUrl =
		'https://github.com/nevoya6970/n8n_ANAF_ecosystem_node/tree/main/packages/n8n-nodes-oblio#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@email.com',
			default: '',
			required: true,
			description: 'The email address you sign in to Oblio with (sent as client_id)',
		},
		{
			displayName: 'API Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The API secret from Oblio → Settings → Account Data (sent as client_secret). Oblio regenerates it whenever the password is reset.',
		},
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const body = new URLSearchParams({
			client_id: String(credentials.email ?? ''),
			client_secret: String(credentials.secret ?? ''),
		}).toString();
		const response = (await this.helpers.httpRequest({
			method: 'POST',
			url: OBLIO_TOKEN_URL,
			body,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
			json: true,
		})) as IDataObject;
		return { accessToken: response.access_token };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://www.oblio.eu/api',
			url: '/nomenclature/companies',
			headers: { Accept: 'application/json' },
		},
	};
}
