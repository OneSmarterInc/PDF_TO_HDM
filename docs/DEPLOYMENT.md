For the AWS container deployment, use [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md).

# Setup and deployment

## Runtime and local access

Node.js 24+, Python 3.12, PostgreSQL 18 (or a compatible maintained PostgreSQL service), approximately 4 GB available RAM for one OCR worker, and protected disk space for temporary rendering and PostgreSQL assets. Windows is tested; see AWS_READINESS_REPORT.md for the Linux container qualification results. The existing app remains plain Node HTTP and browser JavaScript.

1. Run `npm ci` in the project directory.
2. Create `.venv` with Python 3.12; install `requirements.lock.txt`. Set `PYTHON_PATH` if the interpreter is elsewhere. The installed RapidOCR package includes its local models; `models/eng.traineddata` is packaged for Tesseract.
3. Create a dedicated PostgreSQL database and the `clarity_owner` migration and `clarity_app` runtime roles. For this Windows machine, the isolated cluster already exists at `.local-postgres`, port 55432. Do not rerun setup against existing data.
4. Configure runtime `.env` from `.env.example`. Keep the migration URL in a separate ignored `.env.migration` or deployment secret; the web service needs only DATABASE_URL. Use independently generated runtime and owner credentials.
5. Run `npm run db:migrate` with migration credentials. Migrations are transactional and checksum checked. Exact-file local reviews are imported only by the migration command.
6. Initialize the first administrator using `BOOTSTRAP_USERNAME` and `BOOTSTRAP_PASSWORD` from a secure operator environment, then `npm run admin:init`. The command refuses to replace an existing admin. Remove the bootstrap password from runtime configuration after initialization. First login must change it.
7. Configure TEMPORARY_PASSWORD as a server secret. It is hashed separately for every account and never sent in creation/reset responses. Share it and usernames through your organization's approved secure process. Account creation/reset fails clearly if this secret is absent.
8. Run `npm start` and open the configured APP_ORIGIN. On this machine `start.cmd` starts the existing isolated database if necessary, then the portal at http://127.0.0.1:4317. Initial credentials are in the protected local `.local-credentials.txt`; never commit or publish it.

## Production package

Run `npm run lint`, `npm run typecheck`, `npm test`, the Python suite, infrastructure suites, then `npm run build`. The build copies an explicit application allowlist into `dist` and generates a SHA-256 manifest. Credentials, database files, uploaded data, review cache, QA fixtures and symlinked dependencies are excluded. Install `npm ci --omit=dev` in the release directory; create its Python environment and install requirements.lock.txt. Run migrations and bootstrap separately using operator credentials. Run `node server.mjs` under your service manager with a dedicated OS account and automatic restart.

Excel generation uses project-installed ExcelJS and the same existing worksheet data. The old optional developer raster-preview command is retained in `excel/build-artifact.mjs`; it is not needed by the production server and requires the original optional artifact runtime if explicitly invoked.

## Required deployment configuration

- Set NODE_ENV=production and APP_ORIGIN to the exact public `https://` origin, without a trailing path. Startup rejects an HTTP production origin. Cookies use Secure, HttpOnly, SameSite=Strict and a __Host- prefix. Sessions expire after eight hours or 30 minutes idle.
- Terminate TLS at a maintained reverse proxy; the application binds to loopback by default; HOST=0.0.0.0 is used in the private container. Forward only through the trusted proxy and restrict host access. Example Nginx location: `proxy_pass http://127.0.0.1:4317; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; client_max_body_size 30m; proxy_read_timeout 130s;`. Set TRUST_PROXY=loopback only when the loopback proxy overwrites X-Forwarded-For with a single verified client IP. Otherwise leave it unset; forwarded client input is ignored.
- Require verified database TLS for remote PostgreSQL connections. Do not disable certificate validation. Keep database ports private, use encrypted volumes/backups and restrict runtime filesystem access. Runtime credentials have no schema-changing privileges or audit update/delete privileges.
- DOCUMENT_RETENTION_HOURS defaults to 2, preserving the previous lifetime; select an approved policy before production. Expiry removes document records/assets; account and audit history remain. Backups have an independent retention policy. PostgreSQL deletion is not a claim of forensic secure erasure.
- MAX_QUEUED_DOCUMENTS defaults to 3, bounded 1–100. Only one OCR document runs at a time to bound model memory. Up to three uploads may be received concurrently. A database advisory lease prevents two OCR servers sharing a database. Durable queued work resumes on restart. This release is a single-node portal, not a horizontally scaled worker cluster; load-test your expected workload before enlarging the queue or deploying widely.
- Configure service monitoring, `/healthz`, database backups, restore rehearsals, disk-space alerts and dependency patching. Keep logs and private credentials restricted. Audit history has no normal mutation endpoint; superusers still require operational controls and external archival for stronger tamper resistance.

## Verification commands

`npm test` runs only self-contained unit/workbook tests. `npm run typecheck` checks the new database/security/admin/audit/document-store modules with TypeScript's JavaScript checker; legacy/browser code is linted and tested rather than advertised as fully typed.

Infrastructure/browser scripts use a separate `.env.qa`, port 4318 and their own real PostgreSQL test database. Never point QA scripts at the live database. Prepare an empty QA database with the same migrations, then run scripts/test-auth.mjs, test-users.mjs, test-audit.mjs, test-document-store.mjs, test-reader-browser.cjs, test-isolation.mjs, test-ui.cjs, test-security.mjs, test-xss.cjs and test-cancel-browser.cjs in order. Playwright is a development dependency; tests currently launch installed Edge. `scripts/validate-synthetic.mjs` requires TEST_URL and TEST_AUTH_FILE for authenticated regression. Tests create real isolated QA accounts and records; they are not production mock data.

## Rollback and recovery

Back up the database before a deployment. Keep the prior release and matching configuration. Apply additive migrations; do not edit historical migrations or blindly roll schema backward. Restore into a new database and verify counts/assets before switching the connection. See DATABASE_DESIGN.md. No existing databases are deleted by setup, migrations or restore testing. Old local anonymous sessions cannot be assigned safely to arbitrary new accounts; source review files and original exported artifacts remain preserved.

## Honest release boundary

Local QA is not an external penetration test, compliance certification, public TLS deployment or large-concurrency benchmark. No cloud host, domain or production credentials were supplied, so no external deployment is claimed. Configure and validate those deployment controls before exposing real documents to an organization. OCR accuracy remains limited to supported layouts and evidence; passing automatic checks is not a guarantee or a coverage/payment decision.

## Password policy update (2026-10-31)

At the user's request, passwords now accept 6–128 characters, while rejecting common/predictable values and username-derived passwords. This applies to user changes, bootstrap validation and configured temporary-password validation. Local future account creation and administrator reset now use a randomly generated six-character configured temporary password, recorded only in the protected local credentials file. Existing account password hashes were not changed, including the initial administrator. First-login/reset password changes, Argon2id and session controls remain enforced. Login and current/new/confirmation fields have independent accessible show/hide eye controls; values are masked again on form submission.
