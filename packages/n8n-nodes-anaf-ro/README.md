# n8n-nodes-anaf-ro

n8n community nodes for **ANAF**, the Romanian National Agency for Fiscal Administration:

- **ANAF Company Lookup**: the public company and VAT registry (no authentication).

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

This package is not affiliated with or endorsed by ANAF.

- [Installation](#installation)
- [ANAF Company Lookup](#anaf-company-lookup)
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

## Credentials

ANAF Company Lookup needs no credentials.

## Examples

Sanitized, importable workflows are in [`examples/`](./examples). They contain fictitious CUIs only.

- `anaf-company-lookup.json`: validate a list of CUIs, then look them up in one batch.

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

## License

[MIT](./LICENSE.md)
