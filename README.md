# n8n ANAF ecosystem nodes

n8n community node packages for the Romanian invoicing and tax ecosystem: ANAF (company lookup and
RO e-Factura), SmartBill and Oblio.

| Package | Nodes | Credential | Auth |
| --- | --- | --- | --- |
| [`n8n-nodes-anaf-ro`](./packages/n8n-nodes-anaf-ro) | ANAF Company Lookup, ANAF e-Factura | ANAF E-Factura OAuth2 API | Lookup: none. e-Factura: OAuth2 with a qualified certificate |
| [`n8n-nodes-smartbill`](./packages/n8n-nodes-smartbill) | SmartBill | SmartBill API | Email + API token (V1), optional Bearer token (V3) |
| [`n8n-nodes-oblio`](./packages/n8n-nodes-oblio) | Oblio | Oblio API | Email + API secret, exchanged for a Bearer token |

Each package is a separate npm package because n8n's
[verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines)
ask for one third-party service per package. All of them are TypeScript, MIT licensed, have **no runtime
dependencies**, do not read environment variables or the file system, and were scaffolded with n8n's
official `n8n-node` CLI (`npm create @n8n/node`).

These packages are not affiliated with or endorsed by ANAF, SmartBill or Oblio.

## Install

In n8n, open **Settings → Community Nodes → Install** and enter the package name, for example
`n8n-nodes-anaf-ro`. See n8n's
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/). For a manual
self-hosted install:

```bash
npm install n8n-nodes-anaf-ro n8n-nodes-smartbill n8n-nodes-oblio
```

## Operations

| Node | Resource | Operations |
| --- | --- | --- |
| ANAF Company Lookup | – | Look Up Company, Batch Look Up, Get VAT Status, Validate CUI |
| ANAF e-Factura | Invoice | Upload, Get Status, Validate XML, Convert to PDF |
| ANAF e-Factura | Message | Get Many, Download (ZIP) |
| SmartBill | Invoice | Create, Get PDF, Get Payment Status, Cancel, Restore, Delete, Reverse, Send by Email |
| SmartBill | Client | Get, Get Many |
| Oblio | Invoice | Create, Get, Get Many, Cancel, Restore, Delete, Collect Payment, Reverse |
| Oblio | Client | Get Many |

All nodes are marked `usableAsTool` so AI agents can use them.

## Authentication setup

Full instructions are in each package README.

- **ANAF Company Lookup**: none, it is a public service.
- **ANAF e-Factura**: register an OAuth application in the ANAF portal, set its callback URL to n8n's
  OAuth redirect URL, then connect the credential in a browser that holds a qualified digital
  certificate with SPV rights. Choose the Test or Production environment in the credential.
  [Details](./packages/n8n-nodes-anaf-ro/README.md#credentials).
- **SmartBill**: copy the email, API token and company CIF from SmartBill Cloud → Integrari → API. Add
  the V3 Bearer token only if you use the Client operations.
  [Details](./packages/n8n-nodes-smartbill/README.md#credentials).
- **Oblio**: use your Oblio login email and the API secret from Settings → Account Data.
  [Details](./packages/n8n-nodes-oblio/README.md#credentials).

## Error handling, retries and rate limits

- Errors show the upstream service's own message: ANAF's `errorMessage`/`eroare`/`message`, SmartBill's
  `errorText` or `errors[].message`, and Oblio's `statusMessage`. All three services sometimes report
  errors with HTTP 200; the nodes detect these and raise them as errors.
- HTTP 429 is retried with exponential backoff that honours `Retry-After`. The exception is SmartBill
  V1, which blocks the token for 10 minutes, so retrying would only extend the block.
- 5xx and transient network errors are retried for reads. They are **not** retried for requests that
  create documents or submit invoices (ANAF upload, SmartBill writes, Oblio cancel/restore/delete/collect),
  so nothing is filed twice. Oblio Create and Reverse are the exception: they carry an idempotency key.
- Calls within one execution are spaced to each service's documented limits.
- Credentials and tokens are never logged or copied into output items or error messages. See
  [SECURITY.md](./SECURITY.md).

## Limitations

Each package README has a full Limitations section. The main ones:

- **No sandbox for SmartBill or Oblio.** Credential tests and all operations run against real
  accounts. ANAF e-Factura has a test environment; Validate XML and Convert to PDF exist only on
  production (they do not submit invoices).
- **Not tested against live accounts.** Everything was built from the official documentation and
  tested with mocked HTTP only. In particular, the ANAF OAuth flow inside n8n (token refresh with
  `token_content_type=jwt`, empty scope) needs one manual check with a real certificate.
- **No invoice generation.** e-Factura operations take finished UBL/CII XML.
- **Rate limits are per execution.** Several workflows or n8n instances sharing one account or IP can
  still exceed a service's limit together.

## Examples

Sanitized workflow JSONs that you can import into n8n are in each package's `examples/` folder:

- [`n8n-nodes-anaf-ro/examples`](./packages/n8n-nodes-anaf-ro/examples): CUI validation and batch
  lookup; e-Factura validate, upload and status; daily download of received invoices.
- [`n8n-nodes-smartbill/examples`](./packages/n8n-nodes-smartbill/examples): create an invoice, check
  payment, download the PDF.
- [`n8n-nodes-oblio/examples`](./packages/n8n-nodes-oblio/examples): create an invoice, record a
  payment, read it back.

They contain only fictitious CUIs and placeholder credential references (`REPLACE_WITH_YOUR_CREDENTIAL_ID`).

## Development

Each package is self-contained and has its own lockfile:

```bash
cd packages/n8n-nodes-anaf-ro
npm ci
npm run lint       # n8n-node lint: n8n's community node rules
npm run typecheck
npm test           # vitest, mocked HTTP only, no network
npm run build
npm run dev        # local n8n with the package loaded (needs Docker or Podman)
```

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs lint, typecheck, test and build for
every package on each push and pull request.

## Releasing

Packages are published from GitHub Actions with an
[npm provenance statement](https://docs.npmjs.com/generating-provenance-statements), as n8n requires
for verified community nodes. Each package has its own workflow, triggered by a tag named
`<package>@<version>`:

| Package | Workflow | Tag example |
| --- | --- | --- |
| `n8n-nodes-anaf-ro` | [`publish-n8n-nodes-anaf-ro.yml`](./.github/workflows/publish-n8n-nodes-anaf-ro.yml) | `n8n-nodes-anaf-ro@0.1.0` |
| `n8n-nodes-smartbill` | [`publish-n8n-nodes-smartbill.yml`](./.github/workflows/publish-n8n-nodes-smartbill.yml) | `n8n-nodes-smartbill@0.1.0` |
| `n8n-nodes-oblio` | [`publish-n8n-nodes-oblio.yml`](./.github/workflows/publish-n8n-nodes-oblio.yml) | `n8n-nodes-oblio@0.1.0` |

1. **One-time setup per package:**
   - On npmjs.com, add a Trusted Publisher: GitHub Actions, repository
     `nevoya6970/n8n_ANAF_ecosystem_node`, and the workflow file name from the table.
   - The first publish of a new package name needs an `NPM_TOKEN` repository secret, because trusted
     publishing can only be configured once the package exists. Remove the secret afterwards.
2. **Release:**
   - Bump `version` in the package's `package.json` and update its `CHANGELOG.md`.
   - Commit, then push the tag:

   ```bash
   git tag n8n-nodes-anaf-ro@0.1.0
   git push origin main --tags
   ```

   The workflow checks that the tag matches the package version, runs the tests, then runs
   `npm run release`. In CI this is `n8n-node release`: lint, build, and `npm publish` with provenance.
3. **After publishing:**
   - Check the package with `npx @n8n/scan-community-package <package>`.
   - Submit it for verification in the [n8n Creator Portal](https://creators.n8n.io/nodes).

`n8n-node release` run locally (outside CI) uses release-it with un-prefixed tags, which suits
single-package repositories. In this monorepo, use the tag-based flow above.

## License

[MIT](./LICENSE)
