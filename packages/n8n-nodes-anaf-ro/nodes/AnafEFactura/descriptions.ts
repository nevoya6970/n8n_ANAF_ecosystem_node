import type { INodeProperties } from 'n8n-workflow';

const xmlSourceFields = (operations: string[]): INodeProperties[] => [
	{
		displayName: 'XML Source',
		name: 'xmlSource',
		type: 'options',
		options: [
			{ name: 'Binary File', value: 'binary', description: 'Read the XML from a binary property' },
			{ name: 'Text', value: 'text', description: 'Use XML text from a parameter or expression' },
		],
		default: 'binary',
		displayOptions: { show: { resource: ['invoice'], operation: operations } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field containing the XML file',
		displayOptions: {
			show: { resource: ['invoice'], operation: operations, xmlSource: ['binary'] },
		},
	},
	{
		displayName: 'XML',
		name: 'xmlContent',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		required: true,
		placeholder: '<?xml version="1.0" encoding="UTF-8"?><Invoice ...',
		displayOptions: { show: { resource: ['invoice'], operation: operations, xmlSource: ['text'] } },
	},
];

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Invoice', value: 'invoice' },
		{ name: 'Message', value: 'message' },
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
			name: 'Upload',
			value: 'upload',
			description: 'Upload an invoice, credit note or buyer message XML to e-Factura',
			action: 'Upload an invoice XML',
		},
		{
			name: 'Get Status',
			value: 'getStatus',
			description: 'Get the processing status of an upload by its upload index',
			action: 'Get the status of an uploaded invoice',
		},
		{
			name: 'Validate XML',
			value: 'validate',
			description: 'Validate an invoice XML against the RO e-Factura rules (production endpoint)',
			action: 'Validate an invoice XML',
		},
		{
			name: 'Convert to PDF',
			value: 'convertToPdf',
			description: 'Convert an invoice XML to PDF (production endpoint)',
			action: 'Convert an invoice XML to PDF',
		},
	],
	default: 'upload',
};

export const messageOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['message'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'List the messages (sent and received invoices, errors) available for download',
			action: 'Get many messages',
		},
		{
			name: 'Download',
			value: 'download',
			description: 'Download a message as a ZIP file (invoice or errors XML plus the MF signature)',
			action: 'Download a message',
		},
	],
	default: 'getAll',
};

export const invoiceFields: INodeProperties[] = [
	// ---------------- upload ----------------
	{
		displayName: 'Standard',
		name: 'uploadStandard',
		type: 'options',
		options: [
			{ name: 'UBL Invoice', value: 'UBL' },
			{ name: 'UBL Credit Note', value: 'CN' },
			{ name: 'CII Invoice', value: 'CII' },
			{ name: 'Buyer Message (RASP)', value: 'RASP' },
		],
		default: 'UBL',
		description: 'Type of the XML being uploaded',
		displayOptions: { show: { resource: ['invoice'], operation: ['upload'] } },
	},
	{
		displayName: 'CIF',
		name: 'cif',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 12345674',
		description:
			'Numeric CIF that receives the error message if ANAF cannot identify the seller from the XML. You must have SPV rights for it. An RO prefix is removed.',
		displayOptions: { show: { resource: ['invoice'], operation: ['upload'] } },
	},
	...xmlSourceFields(['upload', 'validate', 'convertToPdf']),
	{
		displayName: 'Options',
		name: 'uploadOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['upload'] } },
		options: [
			{
				displayName: 'B2C Invoice',
				name: 'b2c',
				type: 'boolean',
				default: false,
				description:
					'Whether to use the B2C upload endpoint (/uploadb2c) for invoices to consumers',
			},
			{
				displayName: 'Foreign Buyer',
				name: 'extern',
				type: 'boolean',
				default: false,
				description: 'Whether the buyer is outside Romania and has no CUI/NIF (sends extern=DA)',
			},
			{
				displayName: 'Self-Billing',
				name: 'autofactura',
				type: 'boolean',
				default: false,
				description:
					'Whether the beneficiary issues the invoice on behalf of the supplier (sends autofactura=DA)',
			},
			{
				displayName: 'Enforcement Authority',
				name: 'executare',
				type: 'boolean',
				default: false,
				description:
					'Whether the invoice is filed by an enforcement body on behalf of the debtor (sends executare=DA)',
			},
		],
	},

	// ---------------- getStatus ----------------
	{
		displayName: 'Upload Index',
		name: 'uploadIndex',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 5001120362',
		description: 'The index_incarcare returned by the Upload operation',
		displayOptions: { show: { resource: ['invoice'], operation: ['getStatus'] } },
	},

	// ---------------- validate / convertToPdf ----------------
	{
		displayName: 'Standard',
		name: 'documentStandard',
		type: 'options',
		options: [
			{ name: 'Invoice (FACT1)', value: 'FACT1' },
			{ name: 'Credit Note (FCN)', value: 'FCN' },
		],
		default: 'FACT1',
		displayOptions: { show: { resource: ['invoice'], operation: ['validate', 'convertToPdf'] } },
	},
	{
		displayName: 'Error If Invalid',
		name: 'errorIfInvalid',
		type: 'boolean',
		default: false,
		description:
			'Whether to fail the item when ANAF reports validation errors. When off, the result is returned with valid set to false.',
		displayOptions: { show: { resource: ['invoice'], operation: ['validate'] } },
	},
	{
		displayName: 'Options',
		name: 'pdfOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['invoice'], operation: ['convertToPdf'] } },
		options: [
			{
				displayName: 'Skip Validation',
				name: 'skipValidation',
				type: 'boolean',
				default: false,
				description:
					'Whether to convert without validating the XML first (novld=DA). ANAF does not guarantee the PDF is correct for unvalidated XML.',
			},
			{
				displayName: 'Output Binary Field',
				name: 'outputBinaryPropertyName',
				type: 'string',
				default: 'data',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: 'invoice.pdf',
			},
		],
	},
];

export const messageFields: INodeProperties[] = [
	// ---------------- getAll ----------------
	{
		displayName: 'CIF',
		name: 'cif',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 12345674',
		description: 'Numeric CIF to list messages for. An RO prefix is removed.',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'] } },
	},
	{
		displayName: 'Period',
		name: 'period',
		type: 'options',
		options: [
			{
				name: 'Last N Days',
				value: 'days',
				description: 'Simple list for the last 1 to 60 days',
			},
			{
				name: 'Time Range',
				value: 'range',
				description: 'Paginated list between two timestamps',
			},
		],
		default: 'days',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'] } },
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 60 },
		default: 7,
		description: 'Number of days to look back (1 to 60)',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'], period: ['days'] } },
	},
	{
		displayName: 'Start Time',
		name: 'startTime',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'], period: ['range'] } },
	},
	{
		displayName: 'End Time',
		name: 'endTime',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'], period: ['range'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['message'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Message Type',
				name: 'filtru',
				type: 'options',
				options: [
					{ name: 'Buyer Messages (R)', value: 'R' },
					{ name: 'Invoice Errors (E)', value: 'E' },
					{ name: 'Received Invoices (P)', value: 'P' },
					{ name: 'Sent Invoices (T)', value: 'T' },
				],
				default: 'T',
			},
		],
	},

	// ---------------- download ----------------
	{
		displayName: 'Download ID',
		name: 'downloadId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 3001474425',
		description:
			'The message ID: the ID field returned by Get Many, or the download ID returned by Get Status',
		displayOptions: { show: { resource: ['message'], operation: ['download'] } },
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['message'], operation: ['download'] } },
	},
];
