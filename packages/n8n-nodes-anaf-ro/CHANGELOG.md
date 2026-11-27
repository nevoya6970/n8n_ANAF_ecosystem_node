# Changelog

All notable changes to `n8n-nodes-anaf-ro` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - not yet published

### Added

- ANAF Company Lookup node: Look Up Company, Batch Look Up, Get VAT Status and Validate CUI,
  using ANAF's public VAT web service v9, with chunking to 100 CUIs per request and 1 request per second.
- CUI check digit validator helper.
- ANAF e-Factura node: Upload, Get Status, Validate XML and Convert to PDF for invoices; Get Many and
  Download for messages. Test and production environments.
- ANAF e-Factura OAuth2 API credential preconfigured for logincert.anaf.ro.
