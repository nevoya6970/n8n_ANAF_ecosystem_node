import type { ICredentialTestRequest, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

/**
 * OAuth2 credential for the ANAF RO e-Factura API (api.anaf.ro).
 *
 * Flow, per ANAF's "Procedura de inregistrare a aplicatiilor in portalul ANAF":
 * - Authorization code grant against logincert.anaf.ro. The user authenticates in the browser
 *   with a qualified digital certificate that has SPV rights for the company.
 * - Client authentication at the token endpoint is "Send as Basic Auth header".
 * - `token_content_type=jwt` is sent both as an authorization URL query parameter and in the
 *   token request body, so ANAF issues JWT tokens (access token 90 days, refresh token 365 days).
 * - The scope is left empty.
 */
export class AnafEFacturaOAuth2Api implements ICredentialType {
	name = 'anafEFacturaOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'ANAF E-Factura OAuth2 API';

	icon: Icon = {
		light: 'file:anafEFactura.svg',
		dark: 'file:anafEFactura.dark.svg',
	};

	documentationUrl =
		'https://github.com/nevoya6970/n8n_ANAF_ecosystem_node/tree/main/packages/n8n-nodes-anaf-ro#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			options: [
				{
					name: 'Test',
					value: 'test',
					description: 'https://api.anaf.ro/test/FCTEL/rest (invoices are not legally submitted)',
				},
				{
					name: 'Production',
					value: 'prod',
					description: 'https://api.anaf.ro/prod/FCTEL/rest (invoices are legally submitted)',
				},
			],
			default: 'test',
			description:
				'Which e-Factura environment to use for upload, status, list and download. Validate XML and Convert XML to PDF always use production, the only environment ANAF documents for them.',
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://logincert.anaf.ro/anaf-oauth2/v1/token',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: 'token_content_type=jwt',
		},
		{
			displayName: 'Additional Body Properties',
			name: 'additionalBodyProperties',
			type: 'hidden',
			default: '{"token_content_type":"jwt"}',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'header',
		},
	];

	// ANAF's test endpoint for OAuth applications, documented in the registration procedure.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anaf.ro',
			url: '/TestOauth/jaxrs/hello',
			qs: { name: 'n8n' },
		},
	};
}
