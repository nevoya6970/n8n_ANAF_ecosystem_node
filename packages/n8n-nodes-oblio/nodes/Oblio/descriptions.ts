import type { INodeProperties } from 'n8n-workflow';

const DOCUMENT_OPERATIONS = ['get', 'cancel', 'restore', 'delete', 'collect', 'reverse'];

const COLLECT_TYPES = [
	'Alta incasare banca',
	'Alta incasare numerar',
	'Bilet ordin',
	'Bon fiscal',
	'Bon fiscal card',
	'Card',
	'CEC',
	'Chitanta',
	'Mandat postal',
	'Ordin de plata',
	'Ramburs',
].map((value) => ({ name: value, value }));

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

export const companyProperty: INodeProperties = {
	displayName: 'Company Name or ID',
	name: 'cif',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCompanies' },
	required: true,
	default: '',
	description:
		'The company in your Oblio account (sent as its CIF). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
			name: 'Collect Payment',
			value: 'collect',
			description: 'Record a payment for an invoice',
			action: 'Collect payment for an invoice',
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
			description: 'Delete an invoice (only the last invoice in a series)',
			action: 'Delete an invoice',
		},
		{ name: 'Get', value: 'get', description: 'Get an invoice', action: 'Get an invoice' },
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'List invoices',
			action: 'Get many invoices',
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
			description: 'Issue a full reversal (storno) of an invoice',
			action: 'Reverse an invoice',
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
		{ name: 'Get Many', value: 'getAll', description: 'List clients', action: 'Get many clients' },
	],
	default: 'getAll',
};

const productValues: INodeProperties[] = [
	{ displayName: 'Name', name: 'name', type: 'string', default: '', required: true },
	{ displayName: 'Code', name: 'code', type: 'string', default: '' },
	{ displayName: 'Description', name: 'description', type: 'string', default: '' },
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		default: 0,
		typeOptions: { numberPrecision: 4 },
	},
	{
		displayName: 'Quantity',
		name: 'quantity',
		type: 'number',
		default: 1,
		typeOptions: { numberPrecision: 4 },
	},
	{ displayName: 'Measuring Unit', name: 'measuringUnit', type: 'string', default: 'buc' },
	{
		displayName: 'VAT Name',
		name: 'vatName',
		type: 'string',
		default: '',
		placeholder: 'e.g. Normala',
		description: 'VAT rate name from the Oblio VAT rates list. Optional.',
	},
	{
		displayName: 'VAT Percentage',
		name: 'vatPercentage',
		type: 'number',
		default: 21,
		description: 'Must match a VAT rate configured in Oblio',
	},
	{
		displayName: 'Price Includes VAT',
		name: 'vatIncluded',
		type: 'boolean',
		default: true,
		description: 'Whether the price includes VAT (Oblio default: yes)',
	},
	{
		displayName: 'Product Type',
		name: 'productType',
		type: 'string',
		default: '',
		placeholder: 'e.g. Serviciu',
		description: 'Only used when stock management is enabled, for example Marfa or Serviciu',
	},
	{
		displayName: 'Warehouse',
		name: 'management',
		type: 'string',
		default: '',
		description: 'Warehouse (gestiune) name. Only used when stock management is enabled.',
	},
];

export const invoiceFields: INodeProperties[] = [
	{
		displayName: 'Series Name',
		name: 'seriesName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. FCT',
		description: 'Invoice series name, as defined in Oblio',
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
		placeholder: 'e.g. 0055',
		displayOptions: { show: { resource: ['invoice'], operation: DOCUMENT_OPERATIONS } },
	},

	// ---------------- create ----------------
	{
		displayName: 'Client Name',
		name: 'clientName',
		type: 'string',
		required: true,
		default: '',
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
			{
				displayName: 'Autocomplete From CIF',
				name: 'autocomplete',
				type: 'boolean',
				default: false,
				description: 'Whether Oblio should fill in the client details from a Romanian CIF',
			},
			{ displayName: 'Bank', name: 'bank', type: 'string', default: '' },
			{
				displayName: 'CIF',
				name: 'cif',
				type: 'string',
				default: '',
				description: 'Company CIF or personal CNP',
			},
			{ displayName: 'City', name: 'city', type: 'string', default: '' },
			{ displayName: 'Client Code', name: 'code', type: 'string', default: '' },
			{ displayName: 'Contact Person', name: 'contact', type: 'string', default: '' },
			{ displayName: 'Country', name: 'country', type: 'string', default: '' },
			{ displayName: 'County', name: 'state', type: 'string', default: '' },
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{ displayName: 'IBAN', name: 'iban', type: 'string', default: '' },
			{ displayName: 'Is VAT Payer', name: 'vatPayer', type: 'boolean', default: false },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
			{
				displayName: 'Save Client Data',
				name: 'save',
				type: 'boolean',
				default: false,
				description: 'Whether Oblio should update the stored client data',
			},
			{ displayName: 'Trade Register Number', name: 'rc', type: 'string', default: '' },
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
					'Pass the products array as JSON (supports discount lines and every Oblio field)',
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
			'[\n  {\n    "name": "Service",\n    "price": 100,\n    "quantity": 1,\n    "measuringUnit": "buc",\n    "vatPercentage": 21,\n    "vatIncluded": 0\n  }\n]',
		description: 'Array of Oblio product objects, as documented for POST /api/docs/invoice',
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
			{ displayName: 'Collect Date', name: 'collectDate', type: 'dateTime', default: '' },
			{ displayName: 'Contract Number', name: 'contractNumber', type: 'string', default: '' },
			{ displayName: 'Currency', name: 'currency', type: 'string', default: 'RON' },
			{ displayName: 'Delivery Date', name: 'deliveryDate', type: 'dateTime', default: '' },
			{ displayName: 'Due Date', name: 'dueDate', type: 'dateTime', default: '' },
			{
				displayName: 'Exchange Rate',
				name: 'exchangeRate',
				type: 'number',
				default: 0,
				typeOptions: { numberPrecision: 4 },
				description: 'Leave 0 to use the rate set in the company settings',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Unique key that stops Oblio from creating the same invoice twice. If empty, the node generates one per item.',
			},
			{ displayName: 'Internal Note', name: 'internalNote', type: 'string', default: '' },
			{
				displayName: 'Issue Date',
				name: 'issueDate',
				type: 'dateTime',
				default: '',
				description: 'Defaults to today',
			},
			{ displayName: 'Issuer Name', name: 'issuerName', type: 'string', default: '' },
			{ displayName: 'Language', name: 'language', type: 'string', default: 'RO' },
			{ displayName: 'Mentions', name: 'mentions', type: 'string', default: '' },
			{ displayName: 'Order Number', name: 'orderNumber', type: 'string', default: '' },
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
				description: 'Whether to email the invoice using the template from Oblio settings',
			},
			{
				displayName: 'Send to E-Factura (SPV)',
				name: 'spvExtern',
				type: 'boolean',
				default: false,
				description:
					'Whether Oblio should send the invoice to SPV, if automatic e-Factura sending is enabled in Oblio settings',
			},
			{
				displayName: 'Use Stock',
				name: 'useStock',
				type: 'boolean',
				default: false,
				description: 'Whether to discharge stock (when stock management is enabled)',
			},
		],
	},

	// ---------------- delete ----------------
	{
		displayName: 'Delete Associated Payment',
		name: 'deleteCollect',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['invoice'], operation: ['delete'] } },
	},

	// ---------------- reverse ----------------
	{
		displayName: 'Reversal Series Name',
		name: 'reverseSeriesName',
		type: 'string',
		default: '',
		description: 'Series for the reversal invoice. Defaults to the series of the original invoice.',
		displayOptions: { show: { resource: ['invoice'], operation: ['reverse'] } },
	},
	{
		displayName: 'Delete Associated Payment',
		name: 'refund',
		type: 'boolean',
		default: false,
		description: 'Whether to delete the payment associated with the reversed invoice',
		displayOptions: { show: { resource: ['invoice'], operation: ['reverse'] } },
	},

	// ---------------- collect ----------------
	{
		displayName: 'Payment Type',
		name: 'collectType',
		type: 'options',
		options: COLLECT_TYPES,
		default: 'Ordin de plata',
		displayOptions: { show: { resource: ['invoice'], operation: ['collect'] } },
	},
	{
		displayName: 'Payment Fields',
		name: 'collectFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['collect'] } },
		options: [
			{
				displayName: 'Document Number',
				name: 'documentNumber',
				type: 'string',
				default: '',
				description: 'Payment document number. Required unless the payment type is Chitanta.',
			},
			{ displayName: 'Issue Date', name: 'issueDate', type: 'dateTime', default: '' },
			{ displayName: 'Mentions', name: 'mentions', type: 'string', default: '' },
			{
				displayName: 'Receipt Series Name',
				name: 'seriesName',
				type: 'string',
				default: '',
				description: 'Receipt series. Required when the payment type is Chitanta.',
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'number',
				default: 0,
				typeOptions: { numberPrecision: 2 },
				description: 'Amount collected. Leave 0 to collect the invoice total.',
			},
		],
	},

	// ---------------- getAll ----------------
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['invoice', 'client'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['invoice', 'client'], operation: ['getAll'], returnAll: [false] },
		},
	},
	{
		displayName: 'Filters',
		name: 'invoiceFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Cancelled',
				name: 'canceled',
				type: 'options',
				options: [
					{ name: 'Any', value: -1 },
					{ name: 'Not Cancelled', value: 0 },
					{ name: 'Cancelled', value: 1 },
				],
				default: -1,
			},
			{ displayName: 'Client CIF', name: 'clientCif', type: 'string', default: '' },
			{
				displayName: 'Client Email',
				name: 'clientEmail',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{
				displayName: 'Collected',
				name: 'collected',
				type: 'options',
				options: [
					{ name: 'Any', value: -1 },
					{ name: 'Not Collected', value: 0 },
					{ name: 'Collected', value: 1 },
				],
				default: -1,
			},
			{
				displayName: 'Draft',
				name: 'draft',
				type: 'options',
				options: [
					{ name: 'Any', value: -1 },
					{ name: 'Not Draft', value: 0 },
					{ name: 'Draft', value: 1 },
				],
				default: -1,
			},
			{ displayName: 'Include Collects', name: 'withCollects', type: 'boolean', default: false },
			{
				displayName: 'Include E-Factura Status',
				name: 'withEinvoiceStatus',
				type: 'boolean',
				default: false,
			},
			{ displayName: 'Include Products', name: 'withProducts', type: 'boolean', default: false },
			{ displayName: 'Issued After', name: 'issuedAfter', type: 'dateTime', default: '' },
			{ displayName: 'Issued Before', name: 'issuedBefore', type: 'dateTime', default: '' },
			{ displayName: 'Number', name: 'number', type: 'string', default: '' },
			{
				displayName: 'Order By',
				name: 'orderBy',
				type: 'options',
				options: [
					{ name: 'ID', value: 'id' },
					{ name: 'Issue Date', value: 'issueDate' },
					{ name: 'Number', value: 'number' },
				],
				default: 'issueDate',
			},
			{
				displayName: 'Order Direction',
				name: 'orderDir',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'ASC' },
					{ name: 'Descending', value: 'DESC' },
				],
				default: 'DESC',
			},
			{ displayName: 'Series Name', name: 'seriesName', type: 'string', default: '' },
		],
	},
];

export const clientFields: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'clientFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['client'], operation: ['getAll'] } },
		options: [
			{ displayName: 'Client CIF', name: 'clientCif', type: 'string', default: '' },
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
		],
	},
];
