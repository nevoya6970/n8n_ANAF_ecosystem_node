# n8n-nodes-anaf-ro

n8n community nodes for **ANAF**, the Romanian National Agency for Fiscal Administration:

- **ANAF Company Lookup**: the public company and VAT registry (no authentication).
- **ANAF e-Factura**: the RO e-Factura API (OAuth2): upload invoices, check their status, list and
  download messages, validate XML and convert XML to PDF. Test and production environments.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

This package is not affiliated with or endorsed by ANAF.

- [Installation](#installation)
- [ANAF Company Lookup](#anaf-company-lookup)
- [ANAF e-Factura](#anaf-e-factura)
- [Credentials](#credentials)
- [Examples](#examples)
- [Limitations](#limitations)
- [Development](#development)
- [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):

1. In n8n, open **Settings → Community Nodes**.
2. Select **Install**, enter `n8n-nodes-anaf-ro` and confirm.

For a self-hosted instance installed manually:

```bash
npm install n8n-nodes-anaf-ro
```

Requires n8n 1.x or later (`n8nNodesApiVersion` 1). Developed against n8n-workflow 2.49.

## ANAF Company Lookup

Uses ANAF's public synchronous web service
`POST https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva`
([documentation](https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt)).
No account or credential is needed.

| Operation | What it does |
| --- | --- |
| **Look Up Company** | Returns the full ANAF record for the CUI of each input item: general data (name, address, trade register number, CAEN code, registration status), VAT registration and periods, VAT on cash basis, inactive/reactivated status, split VAT, registered office and fiscal domicile addresses, and whether the company is in the RO e-Factura registry. |
| **Batch Look Up** | Takes a list of CUIs (comma, space or newline separated) from every input item, queries them in chunks of 100 and returns one item per CUI. |
| **Get VAT Status** | Same query, condensed to the flags most workflows need: `vatRegistered`, `vatOnCashBasis`, `splitVat`, `inactive`, `deregisteredOn`, `eInvoiceRegistry` and the related dates. |
| **Validate CUI** | Checks the CUI format and check digit locally. No request is sent. |

Options for the three lookup operations:

- **Query Date**: the date ANAF reports the status for. Defaults to today in Romania (Europe/Bucharest).
- **Validate CUI Before Request** (on by default): CUIs with a wrong check digit fail locally instead of being sent to ANAF.
- **Error If Not Found** (off by default): when off, an unknown CUI returns `{ "found": false }` instead of failing.

Look Up Company and Get VAT Status also combine all input items into as few requests as possible,
so 300 input items cost 3 requests, not 300.

### CUI check digit

The validator strips spaces, dots, dashes and an optional `RO` prefix, requires 2 to 10 digits
(no leading zero), and checks the last digit against the test key `753217532`:
the digits before the check digit are right-aligned to the key, multiplied position by position and
summed; the check digit is `(sum × 10) mod 11`, with 10 becoming 0. The helper is exported from
`nodes/shared/cui.ts`.

## ANAF e-Factura

Uses the RO e-Factura REST API behind `api.anaf.ro`, authorized with OAuth2
([technical documentation](https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice),
[API overview PDF](https://mfinante.gov.ro/static/10/eFactura/prezentare%20api%20efactura.pdf)).
It does not generate invoice XML: produce the UBL/CII XML with another tool and pass it in.

| Resource | Operation | ANAF endpoint | Notes |
| --- | --- | --- | --- |
| Invoice | **Upload** | `POST /{env}/FCTEL/rest/upload` or `/uploadb2c` | Standard UBL, CN (credit note), CII or RASP (buyer message). Options: B2C, foreign buyer (`extern=DA`), self-billing (`autofactura=DA`), enforcement authority (`executare=DA`). Returns `uploadIndex`. |
| Invoice | **Get Status** | `GET /{env}/FCTEL/rest/stareMesaj` | Returns `status` (`ok`, `nok`, `in prelucrare`, `XML cu erori nepreluat de sistem`) and `downloadId`. |
| Invoice | **Validate XML** | `POST /prod/FCTEL/rest/validare/{FACT1\|FCN}` | Returns `valid`, `messages` and `traceId`. Optionally fails the item when invalid. |
| Invoice | **Convert to PDF** | `POST /prod/FCTEL/rest/transformare/{FACT1\|FCN}[/DA]` | Returns the PDF as binary. Optional "Skip Validation" (`novld=DA`). |
| Message | **Get Many** | `GET /{env}/FCTEL/rest/listaMesajeFactura` or `listaMesajePaginatieFactura` | Last 1–60 days, or a time range with automatic pagination. Filter by type: E (errors), T (sent), P (received), R (buyer messages). One item per message. |
| Message | **Download** | `GET /{env}/FCTEL/rest/descarcare` | Returns the ZIP (invoice or errors XML plus the Ministry of Finance signature) as binary, named `<id>.zip`. |

`{env}` is `test` or `prod`, chosen in the credential.

The XML for Upload, Validate XML and Convert to PDF can come from a binary property
(for example from Read/Write Files from Disk or an HTTP Request) or from a text parameter.

### Error handling

ANAF reports many errors with HTTP 200: upload and status responses carry
`<Errors errorMessage="..."/>`, and list and download responses carry `{"eroare": "..."}`.
The node turns these into node errors that show ANAF's message, for example
`Nu aveti drept in SPV pentru CIF=...`. An empty message list
(`Nu exista mesaje ...`) returns zero items instead of an error.

### Retries

| Operation | Retries |
| --- | --- |
| Upload | Only on HTTP 429. Never on 5xx or network errors: the invoice might have been accepted, and a retry would submit it twice. Check with Get Status or Get Many instead. |
| Download | At most 1 retry, because ANAF allows only 10 downloads per message per day. |
| Others | Up to 3 retries on 429, 500, 502, 503, 504 and transient network errors, with exponential backoff that honours `Retry-After`. |

## Credentials

ANAF Company Lookup needs no credentials.

### ANAF e-Factura OAuth2 API

ANAF issues OAuth2 tokens through `logincert.anaf.ro`. You authenticate with a **qualified digital
certificate** that has SPV (Spațiul Privat Virtual) rights for the company. The browser that clicks
**Connect** in n8n must have the certificate available (USB token or installed certificate).

1. **Register an OAuth application in the ANAF portal.** Follow ANAF's procedure
   ([PDF](https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf)):
   sign in on [anaf.ro](https://www.anaf.ro) with your certificate, open the application registration
   page for OAuth web services, create an application for the e-Factura service and add a callback URL.
2. **Use n8n's OAuth callback URL** as the application's callback URL. n8n shows it in the credential
   dialog (`OAuth Redirect URL`). It looks like `https://<your-n8n-host>/rest/oauth2-credential/callback`.
3. **Create the credential in n8n.** Add an **ANAF E-Factura OAuth2 API** credential and fill in:
   - **Client ID** and **Client Secret** from the ANAF application.
   - **Environment**: `Test` (default) or `Production`.
4. Click **Connect my account**, choose the certificate when the browser asks, and approve.

The credential is preconfigured with ANAF's endpoints and settings:

| Setting | Value |
| --- | --- |
| Grant type | Authorization code |
| Authorization URL | `https://logincert.anaf.ro/anaf-oauth2/v1/authorize` |
| Access token URL | `https://logincert.anaf.ro/anaf-oauth2/v1/token` |
| Client authentication | Basic Auth header |
| Auth URL query parameter | `token_content_type=jwt` |
| Token request body parameter | `token_content_type=jwt` |
| Scope | empty |

ANAF documents the access token as valid for 90 days and the refresh token for 365 days. n8n refreshes
the access token automatically when ANAF answers HTTP 401. After the refresh token expires, reconnect
the credential with your certificate.

The credential test calls ANAF's OAuth test service `GET https://api.anaf.ro/TestOauth/jaxrs/hello`.

## Examples

Sanitized, importable workflows are in [`examples/`](./examples). They contain fictitious CUIs only.

- `anaf-company-lookup.json`: validate a list of CUIs, then look them up in one batch.
- `anaf-efactura-upload-and-status.json`: validate an invoice XML, upload it to the test environment,
  wait, then check its status.
- `anaf-efactura-download-received.json`: every morning, list invoices received in the last day and
  download each one as a ZIP.

## Limitations

- **ANAF rate limits.** ANAF allows at most 100 CUIs per request and 1 request per second per client,
  and warns that abuse is sanctioned. The node waits 1.1 s between requests within one execution,
  but it cannot coordinate with other workflows or n8n instances calling ANAF from the same IP.
  Space out parallel workflows yourself.
- **Not found vs. error.** ANAF answers HTTP 404 when none of the requested CUIs exist. The node treats
  this as "not found" rather than an error.
- **Check digit source.** ANAF does not publish the CUI check digit algorithm in its web service docs.
  The implementation follows widely used open-source validators (python-stdnum `stdnum.ro.cui`).
  Turn off **Validate CUI Before Request** if you need to send a CUI that fails the local check.
- **Synchronous service only.** ANAF's asynchronous variant of the VAT service is not implemented.
- **No invoice generation.** e-Factura operations take finished XML. Building UBL/CII XML is out of
  scope for v1.
- **Certificate required for OAuth.** Connecting the e-Factura credential needs a qualified digital
  certificate in the browser. This cannot be automated.
- **OAuth details not tested against a live ANAF account.** The endpoints and parameters follow ANAF's
  documentation, and n8n's OAuth code sends the `token_content_type=jwt` body parameter during the
  authorization code exchange. Whether n8n's automatic token refresh also needs that parameter, and
  whether ANAF accepts an empty scope, has not been tested against a live ANAF account.
- **Validate XML and Convert to PDF use production.** ANAF only documents these endpoints on `/prod`,
  so they call production even when the credential is set to Test. They do not submit invoices.
- **ANAF call limits** ([source](https://mfinante.gov.ro/static/10/eFactura/limiteApeluriAPI.txt)):
  1000 calls per minute overall; Get Status max 100 queries per message per day; Get Many max 1500
  simple-list queries or 100 000 paginated queries per CUI per day; Download max 10 downloads per
  message per day; Upload max 1000 RASP messages per CUI per day. ANAF reports these as error
  messages, which the node surfaces. ANAF warns that repeatedly ignoring them can block the
  application.
- **Upload content type.** ANAF's swagger accepts any content type for uploads. The node sends
  `text/plain`, as ANAF documents for Validate XML and Convert to PDF.
- **Binary operations and AI agents.** The node is marked usable as an AI tool. Download and Convert
  to PDF return binary files, which agent tools only see as metadata.
- **Not covered:** signature validation (`/api/validate/signature`) and e-Transport.

## Development

```bash
npm ci
npm run lint       # n8n-node lint (n8n community node rules)
npm run typecheck
npm test           # vitest, mocked HTTP only
npm run build
npm run dev        # starts a local n8n with these nodes (needs Docker or Podman)
```

Releases are published from GitHub Actions with npm provenance. See the repository
[README](../../README.md#releasing).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [ANAF web services](https://www.anaf.ro/anaf/internet/ANAF/servicii_online/servicii_web_anaf)
- [ANAF VAT web service v9 documentation](https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt)
- [RO e-Factura technical information](https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice)
- [ANAF OAuth application registration procedure](https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf)

## License

[MIT](./LICENSE.md)
