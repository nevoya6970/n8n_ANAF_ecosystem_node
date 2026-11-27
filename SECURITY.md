# Security Policy

## Supported versions

Only the latest published version of each package in this repository receives security fixes:

| Package | Supported |
| --- | --- |
| `n8n-nodes-anaf-ro` | latest |
| `n8n-nodes-smartbill` | latest |
| `n8n-nodes-oblio` | latest |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through GitHub:
[Security → Report a vulnerability](https://github.com/nevoya6970/n8n_ANAF_ecosystem_node/security/advisories/new).

Include the affected package and version, a description of the issue, and steps to reproduce.
Do not include real credentials, OAuth tokens, CUIs of real companies or real invoices in the report;
use fictitious data.

You can expect an acknowledgement within 7 days. Fixes are released as a patch version of the
affected package and noted in its `CHANGELOG.md`.

## How these packages handle secrets

- Credentials are stored by n8n in its encrypted credential store. The nodes read them only through
  n8n's credential helpers and never write them to logs, output items or error messages.
- Error messages contain the upstream service's error text and HTTP status only, never request
  headers, tokens or credential values.
- The packages have no runtime dependencies, do not read environment variables and do not access
  the file system.
- The test suites use mocked HTTP only. No real credentials, tokens or invoices are stored in this
  repository. If you find one, report it as described above.
