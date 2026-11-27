# n8n-nodes-oblio

n8n community node for [Oblio](https://www.oblio.eu/), the Romanian invoicing platform: issue, get,
list, cancel, restore, delete and reverse invoices, record payments, and list clients.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

This package is not affiliated with or endorsed by Oblio.

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [Examples](#examples)
- [Limitations](#limitations)
- [Development](#development)
- [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):
in n8n open **Settings → Community Nodes → Install** and enter `n8n-nodes-oblio`.
For a manual self-hosted install:

```bash
npm install n8n-nodes-oblio
```

## Operations

Based on the official [Oblio REST API documentation](https://www.oblio.eu/api)
(base URL `https://www.oblio.eu/api`). Every operation asks for the **Company**, a dropdown loaded from
`GET /nomenclature/companies` (or a CIF given by expression).

### Invoice

| Operation | Endpoint | Notes |
| --- | --- | --- |
| **Create** | `POST /docs/invoice` | Series, client (name plus optional CIF, address, contact, VAT payer, autocomplete from CIF, save) and product lines. Product lines can be set with fields or passed as a JSON array, which supports discount lines and every Oblio product field. Optional: issue/due/delivery/collect dates, currency, exchange rate, language, precision, mentions, internal note, order and contract numbers, send email, send to e-Factura (SPV), use stock, idempotency key. |
| **Get** | `GET /docs/invoice` | Returns the document type, series, number, PDF link and payments. |
| **Get Many** | `GET /docs/invoice/list` | Filters: series, number, client CIF or email, draft, cancelled, collected, issued after/before, include products, payments or e-Factura status, order. Pages of 100. |
| **Cancel** | `PUT /docs/invoice/cancel` | |
| **Restore** | `PUT /docs/invoice/restore` | |
| **Delete** | `DELETE /docs/invoice` | Oblio only allows deleting the last invoice of a series. Optionally deletes the associated payment. |
| **Collect Payment** | `PUT /docs/invoice/collect` | Payment type (Chitanta, Ordin de plata, Card, …), document number or receipt series, value (defaults to the invoice total), date, mentions. |
| **Reverse** | `POST /docs/invoice` with `referenceDocument` | Full reversal (storno) of an invoice. Optionally deletes the associated payment. |

Boolean options are sent as `0`/`1`, as Oblio expects.

### Client

| Operation | Endpoint | Notes |
| --- | --- | --- |
| **Get Many** | `GET /nomenclature/clients` | Filters: name, client CIF. Pages of 250. |

Oblio's API has no endpoint to create or update clients directly. Clients are created or updated when an
invoice is issued (use **Client Fields → Save Client Data**).

## Credentials

Create an **Oblio API** credential with:

| Field | Where to find it |
| --- | --- |
| **Email** | The email you sign in to Oblio with. Sent as `client_id`. |
| **API Secret** | Oblio → **Settings → Account Data** (Setari → Date Cont). Sent as `client_secret`. Oblio regenerates it every time the account password is reset. |

The credential exchanges these at `POST https://www.oblio.eu/api/authorize/token` for a Bearer access
token, which Oblio issues for 3600 seconds. n8n caches the token and requests a new one when it is
missing or when Oblio answers HTTP 401. The token is stored encrypted with the credential and never
written to output.

**Test:** the credential test calls `GET /nomenclature/companies`.

## Examples

Sanitized, importable workflows are in [`examples/`](./examples), with fictitious data and a
placeholder credential.

- `oblio-create-invoice-and-collect.json`: create an invoice, record a bank transfer payment, then
  read the invoice back.

## Limitations

- **No sandbox.** Oblio does not document a test environment. Every call, including the credential
  test, runs against your real Oblio account. Use a dedicated test series while you build workflows.
- **Rate limits:** 30 requests per 100 seconds for requests that generate documents, and 30 requests
  per 10 seconds for all other requests. Within one execution the node waits 3.4 s between
  document-generating calls (Create, Reverse) and 350 ms between other calls, and retries HTTP 429
  with backoff that honours `Retry-After`. Several workflows that share one account can still exceed
  the limit together.
- **Retries:** reads are retried on 5xx and transient network errors. Create and Reverse are retried
  too, because the node sends an `idempotencyKey` with every document (generated per item unless you
  set one), which Oblio documents as preventing duplicates. Cancel, Restore, Delete and Collect Payment
  are not retried on 5xx.
- **Errors:** Oblio's `statusMessage` is shown as the node error message.
- **Account-specific values:** series names, VAT names and percentages, measuring units and warehouse
  names must match your Oblio configuration. The default VAT percentage for new product lines is 21;
  change it to your rate. Oblio's own default for "price includes VAT" is yes, and the node keeps that
  default.
- **Not covered in v1:** proformas, delivery notices (avize), products, series and VAT nomenclatures
  (other than the company list), webhooks, and sending to e-Factura on demand (`/docs/einvoice`). The
  **Send to E-Factura (SPV)** option on Create only works when automatic sending is enabled in Oblio.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test       # vitest, mocked HTTP only
npm run build
```

## Resources

- [Oblio API documentation](https://www.oblio.eu/api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](./LICENSE.md)
