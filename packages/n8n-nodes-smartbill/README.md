# n8n-nodes-smartbill

n8n community node for [SmartBill Cloud](https://www.smartbill.ro/), the Romanian invoicing platform:
issue, download, cancel, restore, delete, reverse and email invoices, and look up clients.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

This package is not affiliated with or endorsed by SmartBill.

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [Examples](#examples)
- [Limitations](#limitations)
- [Development](#development)
- [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):
in n8n open **Settings → Community Nodes → Install** and enter `n8n-nodes-smartbill`.
For a manual self-hosted install:

```bash
npm install n8n-nodes-smartbill
```

## Operations

Based on SmartBill's official OpenAPI specification ([api.smartbill.ro](https://api.smartbill.ro/),
spec dated 2026-09-09).

### Invoice (SmartBill API V1, `https://ws.smartbill.ro/SBORO/api`)

| Operation | Endpoint | Notes |
| --- | --- | --- |
| **Create** | `POST /invoice/v2` | Series, client (name, country, plus optional VAT code, address, contact and other fields) and product lines. Product lines can be set with fields or passed as a JSON array, which supports discount lines and every SmartBill product field. Optional: issue/due/delivery dates, draft, currency, exchange rate, language, observations, mentions, precision, send email, use stock. |
| **Get PDF** | `GET /invoice/pdf` | Returns the PDF as binary, named `<series>-<number>.pdf`. |
| **Get Payment Status** | `GET /invoice/paymentstatus` | Returns `invoiceTotalAmount`, `paidAmount`, `unpaidAmount` and `paid`. |
| **Cancel** | `PUT /invoice/cancel` | |
| **Restore** | `PUT /invoice/restore` | Restores a cancelled invoice. |
| **Delete** | `DELETE /invoice` | |
| **Reverse** | `POST /invoice/reverse` | Issues a reversal (storno) invoice, with an optional issue date. |
| **Send by Email** | `POST /document/send` | Optional To, CC, BCC, subject and body. Subject and body are entered as plain text; the node Base64-encodes them as SmartBill requires. |

The company CIF (`companyVatCode` / `cif`) comes from the credential.

### Client (SmartBill API V3, `https://ws.smartbill.ro/SBORO/api/v3`)

| Operation | Endpoint | Notes |
| --- | --- | --- |
| **Get** | `GET /v3/companies/{cif}/clients/{id}` | |
| **Get Many** | `GET /v3/companies/{cif}/clients` | Filters: name (partial), client code, VAT code. Follows the `after` cursor for Return All. |

SmartBill V1 has no client endpoints. Clients are created implicitly when an invoice is issued with
**Save to Clients** turned on.

## Credentials

Create a **SmartBill API** credential with:

| Field | Where to find it |
| --- | --- |
| **Email** | SmartBill Cloud → [Integrari](https://cloud.smartbill.ro/core/integrari/) → API section |
| **API Token (V1)** | Same page. SmartBill generates it automatically when the account is created. |
| **Company CIF** | Your company's CIF exactly as configured in SmartBill (for example `RO12345674`). |
| **Bearer Token (V3)** | Optional. Generate it on the same Integrari page. Needed only for the Client operations. |

V1 requests use HTTP Basic authentication (email + API token). V3 requests use
`Authorization: Bearer <token>`. The credential picks the right one per request.

**Test:** the credential test calls `GET /tax?cif=<Company CIF>`, which needs valid V1 credentials and
access to the company. The V3 token is not tested.

## Examples

Sanitized, importable workflows are in [`examples/`](./examples). They use fictitious data and a
placeholder credential.

- `smartbill-create-invoice-and-pdf.json`: create an invoice, check its payment status and download
  the PDF.

## Limitations

- **No sandbox.** SmartBill does not document a test environment. Every call, including the credential
  test, runs against your real SmartBill account. Use a dedicated test series, or draft invoices, while
  you build workflows.
- **V1 rate limit:** 30 calls per 10 seconds per token. When it is exceeded, SmartBill blocks the
  token for **10 minutes**. The node spaces V1 calls at least 350 ms apart within one execution and
  does not retry a V1 HTTP 429, because retrying only extends the block. Several workflows that share
  one token can still exceed the limit together.
- **V3 rate limits** are separate for reads and writes, include a daily limit, and are shared per user
  and company. The node retries V3 HTTP 429 responses after the `Retry-After` delay.
- **Retries:** reads are retried on 5xx and transient network errors. Create, cancel, restore, delete,
  reverse and send are not retried on 5xx, so a document is never issued or emailed twice.
- **Errors:** SmartBill V1 can answer HTTP 200 with a non-empty `errorText`. The node treats that as an
  error and shows the message. V3 errors show each `errors[].message` and the parameter name.
- **Account-specific values:** series names, VAT rate names, measuring units and warehouse names must
  match what is configured in your SmartBill account. The default VAT percentage for new product
  lines is 21; change it to your rate.
- **Not covered in v1:** estimates (proforma), payments/receipts, stocks, products, suppliers,
  warehouses, goods receipts (NIR) and SmartBill Conta.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test       # vitest, mocked HTTP only
npm run build
```

## Resources

- [SmartBill API documentation](https://api.smartbill.ro/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](./LICENSE.md)
