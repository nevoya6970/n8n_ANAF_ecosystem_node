import type { INodeProperties } from 'n8n-workflow';

const DOCUMENT_OPERATIONS = [
	'getPdf',
	'getPaymentStatus',
	'cancel',
	'restore',
	'delete',
	'reverse',
	'sendEmail',
];

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Client', value: 'client' },
		{ name: 'Invoice', value: 'invoice' },
	],
	default: 'invoice',
};

export const invoiceOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['invoice'] } },
	options: [
		{
			name: 'Cancel',
			value: 'cancel',
			description: 'Cancel an invoice',
			action: 'Cancel an invoice',
		},
		{
			name: 'Create',
			value: 'create',
			description: 'Issue an invoice',
			action: 'Create an invoice',
		},
		{
			name: 'Delete',
			value: 'delete',
			description: 'Delete an invoice',
			action: 'Delete an invoice',
		},
		{
			name: 'Get Payment Status',
			value: 'getPaymentStatus',
			description: 'Get the paid and unpaid amounts of an invoice',
			action: 'Get the payment status of an invoice',
		},
		{
			name: 'Get PDF',
			value: 'getPdf',
			description: 'Download an invoice as PDF',
			action: 'Get an invoice as PDF',
		},
		{
			name: 'Restore',
			value: 'restore',
			description: 'Restore a cancelled invoice',
			action: 'Restore a cancelled invoice',
		},
		{
			name: 'Reverse',
			value: 'reverse',
			description: 'Issue a reversal (storno) invoice for an existing invoice',
			action: 'Reverse an invoice',
		},
		{
			name: 'Send by Email',
			value: 'sendEmail',
			description: 'Email an invoice to the client or other recipients',
			action: 'Send an invoice by email',
		},
	],
	default: 'create',
};

export const clientOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['client'] } },
	options: [
		{ name: 'Get', value: 'get', description: 'Get a client by ID', action: 'Get a client' },
		{ name: 'Get Many', value: 'getAll', description: 'List clients', action: 'Get many clients' },
	],
	default: 'getAll',
};

const productValues: INodeProperties[] = [
	{ displayName: 'Name', name: 'name', type: 'string', default: '', required: true },
	{
		displayName: 'Code',
		name: 'code',
		type: 'string',
		default: '',
		description:
			'Product code (SKU). Required if your SmartBill account identifies products by code.',
	},
	{
		displayName: 'Quantity',
		name: 'quantity',
		type: 'number',
		default: 1,
		typeOptions: { numberPrecision: 4 },
	},
	{
		displayName: 'Measuring Unit',
		name: 'measuringUnitName',
		type: 'string',
		default: 'buc',
		description: 'Must match a measuring unit name configured in SmartBill',
	},
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		default: 0,
		typeOptions: { numberPrecision: 4 },
		description: 'Unit price, without VAT unless "Price Includes VAT" is on',
	},
	{
		displayName: 'VAT Percentage',
		name: 'taxPercentage',
		type: 'number',
		default: 21,
		description: 'Must match a VAT rate configured in your SmartBill account',
	},
	{
		displayName: 'VAT Name',
		name: 'taxName',
		type: 'string',
		default: '',
		placeholder: 'e.g. Normala',
		description: 'VAT rate name exactly as configured in SmartBill. Optional.',
	},
	{ displayName: 'Price Includes VAT', name: 'isTaxIncluded', type: 'boolean', default: false },
	{ displayName: 'Is Service', name: 'isService', type: 'boolean', default: false },
	{ displayName: 'Description', name: 'productDescription', type: 'string', default: '' },
	{
		displayName: 'Warehouse',
		name: 'warehouseName',
		type: 'string',
		default: '',
		description: 'Warehouse name for stock discharge (case-sensitive). Optional.',
	},
	{
		displayName: 'Save to Products',
		name: 'saveToDb',
		type: 'boolean',
		default: false,
		description: 'Whether to save the product in the SmartBill product list if it is new',
	},
];

export const invoiceFields: INodeProperties[] = [
	// ---------------- create ----------------
	{
		displayName: 'Series Name',
		name: 'seriesName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. FCT',
		description: 'Invoice series exactly as configured in SmartBill',
		displayOptions: {
			show: { resource: ['invoice'], operation: ['create', ...DOCUMENT_OPERATIONS] },
		},
	},
	{
		displayName: 'Number',
		name: 'number',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 0001',
		description: 'Invoice number',
		displayOptions: { show: { resource: ['invoice'], operation: DOCUMENT_OPERATIONS } },
	},
	{
		displayName: 'Client Name',
		name: 'clientName',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['invoice'], operation: ['create'] } },
	},
	{
		displayName: 'Client Country',
		name: 'clientCountry',
		type: 'string',
		required: true,
		default: 'Romania',
		displayOptions: { show: { resource: ['invoice'], operation: ['create'] } },
	},
	{
		displayName: 'Client Fields',
		name: 'clientFields',
		type: 'collection',
		placeholder: 'Add Client Field',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['create'] } },
		options: [
			{ displayName: 'Address', name: 'address', type: 'string', default: '' },
			{ displayName: 'Bank', name: 'bank', type: 'string', default: '' },
			{
				displayName: 'City',
				name: 'city',
				type: 'string',
				default: '',
				description: 'For Bucharest, use the sector, for example "Sector 1"',
			},
			{ displayName: 'Client Code', name: 'code', type: 'string', default: '' },
			{ displayName: 'Contact Person', name: 'contact', type: 'string', default: '' },
			{ displayName: 'County', name: 'county', type: 'string', default: '' },
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{ displayName: 'IBAN', name: 'iban', type: 'string', default: '' },
			{ displayName: 'Is VAT Payer', name: 'isTaxPayer', type: 'boolean', default: false },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
			{
				displayName: 'Save to Clients',
				name: 'saveToDb',
				type: 'boolean',
				default: false,
				description: 'Whether to save the client in the SmartBill client list if it is new',
			},
			{ displayName: 'Trade Register Number', name: 'regCom', type: 'string', default: '' },
			{
				displayName: 'VAT Code',
				name: 'vatCode',
				type: 'string',
				default: '',
				description: 'Client CUI/CIF or foreign VAT code',
			},
		],
	},
	{
		displayName: 'Products Input',
		name: 'productsInput',
		type: 'options',
		options: [
			{ name: 'Fields', value: 'fields', description: 'Define product lines with fields' },
			{
				name: 'JSON',
				value: 'json',
				description:
					'Pass the products array as JSON (supports discount lines and every SmartBill field)',
			},
		],
		default: 'fields',
		displayOptions: { show: { resource: ['invoice'], operation: ['create'] } },
	},
	{
		displayName: 'Products',
		name: 'products',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Product',
		default: {},
		displayOptions: {
			show: { resource: ['invoice'], operation: ['create'], productsInput: ['fields'] },
		},
		options: [{ displayName: 'Product', name: 'product', values: productValues }],
	},
	{
		displayName: 'Products (JSON)',
		name: 'productsJson',
		type: 'json',
		required: true,
		default:
			'[\n  {\n    "name": "Service",\n    "quantity": 1,\n    "price": 100,\n    "measuringUnitName": "buc",\n    "taxPercentage": 21\n  }\n]',
		description: 'Array of SmartBill product objects, as documented for POST /invoice/v2',
		displayOptions: {
			show: { resource: ['invoice'], operation: ['create'], productsInput: ['json'] },
		},
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['create'] } },
		options: [
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: 'RON',
				description: 'Document currency code, for example RON or EUR',
			},
			{ displayName: 'Delivery Date', name: 'deliveryDate', type: 'dateTime', default: '' },
			{ displayName: 'Due Date', name: 'dueDate', type: 'dateTime', default: '' },
			{
				displayName: 'Exchange Rate',
				name: 'exchangeRate',
				type: 'number',
				default: 0,
				typeOptions: { numberPrecision: 4 },
				description: 'Leave 0 to let SmartBill use its available rate',
			},
			{
				displayName: 'Is Draft',
				name: 'isDraft',
				type: 'boolean',
				default: false,
				description: 'Whether to create the invoice as a draft, without a number',
			},
			{
				displayName: 'Issue Date',
				name: 'issueDate',
				type: 'dateTime',
				default: '',
				description: 'Defaults to today',
			},
			{ displayName: 'Issuer Name', name: 'issuerName', type: 'string', default: '' },
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. RO',
				description: 'Document language as configured in SmartBill',
			},
			{ displayName: 'Mentions', name: 'mentions', type: 'string', default: '' },
			{ displayName: 'Observations', name: 'observations', type: 'string', default: '' },
			{
				displayName: 'Precision',
				name: 'precision',
				type: 'options',
				options: [
					{ name: '2 Decimals', value: 2 },
					{ name: '3 Decimals', value: 3 },
					{ name: '4 Decimals', value: 4 },
				],
				default: 2,
			},
			{
				displayName: 'Send Email',
				name: 'sendEmail',
				type: 'boolean',
				default: false,
				description: 'Whether SmartBill should email the invoice to the client after issuing it',
			},
			{
				displayName: 'Use Stock',
				name: 'useStock',
				type: 'boolean',
				default: false,
				description: 'Whether to discharge stock. Product lines must include the warehouse.',
			},
		],
	},

	// ---------------- reverse ----------------
	{
		displayName: 'Reversal Issue Date',
		name: 'reverseIssueDate',
		type: 'dateTime',
		default: '',
		description: 'Date of the reversal invoice. Defaults to today.',
		displayOptions: { show: { resource: ['invoice'], operation: ['reverse'] } },
	},

	// ---------------- getPdf ----------------
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['invoice'], operation: ['getPdf'] } },
	},

	// ---------------- sendEmail ----------------
	{
		displayName: 'Email Options',
		name: 'emailOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['sendEmail'] } },
		options: [
			{
				displayName: 'BCC',
				name: 'bcc',
				type: 'string',
				default: '',
				description: 'Comma-separated addresses',
			},
			{
				displayName: 'Body',
				name: 'bodyText',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description:
					'Plain text, may contain SmartBill template variables. The node Base64-encodes it. Defaults to the account template.',
			},
			{
				displayName: 'CC',
				name: 'cc',
				type: 'string',
				default: '',
				description: 'Comma-separated addresses',
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				description:
					'Plain text. The node Base64-encodes it as SmartBill requires. Defaults to the account template.',
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				default: '',
				placeholder: 'name@email.com',
				description: 'Recipient. Defaults to the client email on the invoice.',
			},
		],
	},
];

export const clientFields: INodeProperties[] = [
	{
		displayName: 'Client ID',
		name: 'clientId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['client'], operation: ['get'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['client'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['client'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['client'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Partial, case-insensitive match',
			},
			{
				displayName: 'Client Code',
				name: 'code',
				type: 'string',
				default: '',
				description: 'Exact, case-sensitive match',
			},
			{
				displayName: 'VAT Code',
				name: 'vatCode',
				type: 'string',
				default: '',
				description: 'Exact CIF match',
			},
		],
	},
];
