# Project audit — 30 October 2026

## Baseline architecture

Clarity is a loopback-only Node.js HTTP server, plain HTML/CSS/browser JavaScript, and Python OCR subprocesses. No frontend framework or bundler exists. Node dependencies: Tesseract.js 6.0.1. Python: RapidOCR, PDFium, Pillow, NumPy/OpenCV via OCR dependencies. Excel uses a machine-specific Codex artifact runtime. There is no database, authentication, user management, dashboard, migration framework, lint configuration, or deployment pipeline.

Inspected all application modules, public files, test suites, scripts, configuration and documentation. Generated OCR artifacts/models/virtual environments are not application source. No project AGENTS.md was found.

## Existing modules and behavior to preserve

- Upload PDF (30 MB/30 pages), preview and explicit confirmation before processing.
- Serial document queue; concurrent page OCR engines; streamed magnified field verification; progress, cancellation and replacement upload.
- CMS-1500 02/12 and 08/05, UB-04 and remittance extraction; check amounts, service tables, checkbox crosses; unsupported layout warnings.
- Automatic verification, optional blank detection, exact-file saved human reviews.
- All-page and individual-page forms, individual/Edit all controls, dirty-state save/discard, source highlighting and zoom, search and attention filter, raw text.
- Excel, JSON and text export, retaining saved changes and blank values.
- APIs: POST /api/documents; GET/PATCH/DELETE /api/documents/:id; original PDF, page PNG and Excel endpoints.

Jobs live in a Map; files live in a random temporary folder. Two-hour expiry, cancellation and normal shutdown remove files. Reviews/output directories persist separately and must be preserved. No persistent user data needs relational migration. Backups/pre-enterprise.zip preserves original source and saved reviews; existing output files remain untouched.

## Executed baseline

- Existing running website on 127.0.0.1:4317 inspected in Edge via Playwright.
- 38 JavaScript and 9 Python tests passed.
- Browser upload → confirmation → extraction → invalid edit detection → restore → Excel download passed.
- Visited upload, confirmation, processing, all pages, each of four pages, raw text and source preview; no browser JavaScript errors. No document-level overflow at widths 1280, 768, 390.
- npm run build attempted: missing script. This is a pre-existing buildless app, not a failed compilation.
- Dependency audit attempted separately; output recorded in tracker when completed.

## Security and reliability observations

Unauthenticated UUID document APIs are unsuitable for multi-user use: no ownership, role checks, sessions or audit history. Origin check alone is not authentication. No login throttling, CSRF tokens, security policy headers, persistent edits, recovery or safe deployment configuration. Raw job directory is hidden but documents are ephemeral. Excel depends on a user-profile runtime, a portability blocker. Queue is single-process with capacity three; no cross-instance coordination. No durable failure recovery. Logs and private files require restricted access and retention policy.

## UI observations

Existing reader is functional, with teal/neutral styling and responsive source comparison. Preserve field IDs and workflows. Add separate login, password change, administration, users and audit pages with a consistent shared navigation. Avoid forcing ordinary users through an administrative dashboard. Improve notification/loading/accessibility states without replacing extraction logic.

## Implementation approach

Keep Node HTTP, plain JS and Python. Add PostgreSQL with pooled parameterized queries, versioned transactional migrations, separate migration/runtime credentials, and an isolated local cluster. Model admins and ordinary users in one users table with roles; sessions, persistent documents, imported review cache and append-only audit events. Document result JSON retains existing schema. Owner checks protect every document resource. Use Argon2id, opaque server sessions, CSRF protection and mandatory password-change backend gate. Business changes and audit insertion share transactions. Maintain single OCR process initially; document this scale boundary instead of pretending multi-instance support exists.

Security references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [node-postgres](https://node-postgres.com/).


## AWS preparation review — 2026-10-31
Inspected current runtime, authentication/authorization, SQL migration/grants, durable PDF assets, job recovery, Python tools, packaging and shared UI before edits. Baseline 47 JS tests/lint/scoped typecheck/build passed. The architecture is intentionally single-worker with a database advisory lease; preserved this boundary instead of introducing untested horizontal scaling. Existing PostgreSQL assets allow RDS adoption without an S3/schema migration. Deployment gaps addressed: configurable private-interface binding, explicit RDS CA/hostname verification, ALB client IP policy, bounded graceful HTTP/OCR shutdown, model packaging, non-root/read-only Linux image, template and operations documentation. Initial image scan rejected the Debian 12 runtime due to OS/bundled-npm advisories; refreshed image qualification is tracked in AWS_READINESS_REPORT.md.
