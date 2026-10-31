# Enterprise portal implementation report

Delivery date: 2026-10-30. The upgraded portal is running locally at http://127.0.0.1:4317. All implementation phases and applicable local acceptance checks are complete. Public deployment remains an operator task; this report does not claim external TLS deployment, compliance certification or universal OCR accuracy.

## Architecture before and after

Before: plain Node HTTP server, browser JavaScript/CSS, Python OCR and local files/in-memory jobs. No database, login, authorization, administrative account management or central audit history. The baseline passed 38 JavaScript and nine Python tests; no production build command existed. Source and saved reviews were backed up before changes in backups/pre-enterprise.zip.

After: the same Node/browser/Python architecture, with PostgreSQL persistence, pooled parameterized queries, server-side sessions and authorization, transactional audit events, account administration and separate routes. The original reader remains the normal user workspace. No frontend framework rewrite was introduced. The production Excel path now uses project-installed ExcelJS because the previous artifact runtime depended on a machine-specific installation. The previous optional preview implementation remains available in excel/build-artifact.mjs.

The reader retains upload confirmation, magnified OCR, CMS-1500 variants, UB-04/remittance extraction, crossed-checkbox interpretation, automatic verification, page tables, source highlighting/zoom, editable fields/Edit all, save/discard, plain readable Excel, JSON/text exports, cancellation and replacement upload. Exact-source reviewed results remain restricted to the matching file hash. Enterprise work does not claim improved recognition for every possible PDF.

## PostgreSQL, preservation and recovery

The local PostgreSQL 18 cluster listens on port 55432. The live database is clarity_portal_live with restricted runtime role clarity_live_app. QA uses clarity_portal and clarity_app; restore testing used a new clarity_restore_42b170f8 database. These databases were not substituted for or deleted over existing production data.

Tables cover roles, users, sessions, login limits, documents, document assets, saved reviews, audit events and migration bookkeeping. Keys, foreign keys, uniqueness, timestamps and ownership/search indexes enforce relationships. Original PDFs and page images are persisted alongside structured results. Updates use optimistic versions to reject stale edits. The runtime role cannot migrate schemas or alter audit history.

Migrations use a separate owner credential, transaction and migration checksum. One existing exact-file saved review was imported; its source file and existing exports were retained. Clean live initialization contains the initial administrator and imported review, without QA accounts or documents. Account/session/document operations and relevant audit events share transactions.

Backup and restore passed into a separate database: the snapshot contained 13 users, three sessions, 11 documents, 37 assets, 141 audit events and one saved review. All counts and 29,925,075 asset bytes matched after restore. These are snapshot counts, not current live counts. See output/backup-restore.json and docs/DATABASE_DESIGN.md. A forced worker termination/restart test also recovered the queued document correctly.

## Authentication and authorization

Admin and user accounts authenticate through the same professional login screen. Argon2id uses 64 MiB memory, three iterations and one lane. Password policy, bounded hashing concurrency, login throttling, inactive-account denial and session revocation protect authentication. Sessions use random tokens stored only as hashes; expiration is eight hours absolute and 30 minutes idle. Account state and role are checked by the backend, not only navigation.

Production cookies use __Host-, Secure, HttpOnly and SameSite=Strict. Mutations require matching origin and CSRF tokens. Production requires an HTTPS APP_ORIGIN. Local development uses loopback HTTP. Protected document APIs and PDF/image/Excel assets enforce ownership; ordinary users cannot access administrative users or audit routes. Logout, reset, deactivation and relevant role changes revoke access.

## Administration and first login

The admin dashboard shows actual database totals and recent activity. Account management supports creation, duplicate prevention, searching, active/role filtering, pagination, details, editing, activation/deactivation, role changes and password reset. Self-lockout and removal of the last active administrator are prevented.

TEMPORARY_PASSWORD is a server secret, never hardcoded in the browser, returned by account APIs or logged. Each account receives its own salted password hash. An administrator distributes credentials through the organization's approved secure process; no email or insecure distribution workflow was added.

On first login or administrative password reset, the backend permits only the explicitly allowed authentication/password endpoints until the current temporary password and a valid new password are supplied. Direct navigation and direct document API attempts are blocked. Successful replacement clears the flag and revokes previous sessions. The initial portal_admin account also requires this change. Its unchanged initial credential is in the restricted .local-credentials.txt file; it is deliberately absent from this report and the build.

## Audit history

Login success/failure, logout, user creation/update/deactivation, role change, password change/reset and document processing/edit/export/delete events are recorded with actor identity/role, action, module, affected identifier, timestamp and allowlisted metadata. Passwords, hashes, tokens, session secrets and extracted document values are excluded from metadata. Admin-only history supports text/user/action/module/date filters, pagination and details with readable timestamps.

Database grants and triggers prohibit normal audit update/delete/truncate operations. There is no mutation API for audit history. Database superusers still require operational oversight; this is not cryptographic or external archive-based tamper proofing.

## UI and interaction quality

Separate login, password-change, reader, document history, admin overview, users and audit routes share typography, spacing, buttons, messages and Lucide icons. Responsive navigation includes active states and a mobile menu. Forms provide validation, loading/disabled states and clear feedback; dialogs support keyboard dismissal. Reduced-motion preferences are respected. Reader comparison and editing remain intact, and exports are blocked while unsaved edits remain.

Thirty-two route/viewport combinations were checked at 1440, 1280, 768 and 390 pixels. Screenshots were inspected, including the original PDF confirmation viewer after loading. Navigation, dialogs, scrolling, forms and tables passed without document overflow or browser errors.

## Actual verification results

| Test category | Status | Execution details |
|---|---|---|
| Baseline | PASS / limitation recorded | 38 JS and nine Python tests; existing reader browser flow. Production build script absent before implementation. |
| Unit/regression | PASS | Final 44 JavaScript tests and nine Python tests. Five authenticated PDF fixtures passed all 302 expected field/checkbox assertions in the final rerun. |
| Database | PASS | Live PostgreSQL migrations, CRUD, constraints, foreign keys, cascades, rollback, grants, safe errors, review import, backup/restore and restart persistence. |
| Authentication | PASS | 23 API assertions: valid/invalid admin/user, Argon2 parameters, forced password change, CSRF, expiry, logout, revocation, inactive login and roles. |
| User management | PASS | 28 API/database assertions plus browser creation, search/edit/deactivation and complete temporary-to-new-password lifecycle. |
| Audit logging | PASS | Actors, timestamps, filters, pagination, details, transactional rollback, sensitive-value exclusion and immutable grants. |
| API | PASS | Ownership and asset restrictions, role restrictions, optimistic edit conflicts, unauthenticated denial and server restart recovery. |
| Frontend | PASS | 32 route/viewport combinations; mobile menu, dialogs, reduced motion, upload confirmation and reader editing. No console errors in final UI suite. |
| Security | PASS within local scope | SQL injection inputs, stored XSS rendering, CSRF/origin rejection, secret-path denial, brute-force throttle, audit immutability and broken-access-control checks. npm audit: zero vulnerabilities; pip-audit: 15 exact runtime packages, zero known vulnerabilities. |
| End-to-end | PASS | Admin and first-login workflows; PDF confirmation/process/source comparison/edit/save/export; cancellation and replacement; restart/session/edit/asset persistence. Actual Excel cells checked for name, leading-zero identifier, numeric amount, intentional blank and selected checkbox. |
| Performance | MEASURED | 20 requests each: API medians 6–7 ms, p95 8–11 ms; four-page Excel 1,260 ms / 20,251 bytes. PostgreSQL owner index used. Measurements are local, not a concurrency SLA. |
| Lint/type checks | PASS / scoped | ESLint clean. TypeScript JavaScript checks cover five new backend modules; legacy/browser code is behavior-tested and linted, not fully strictly typed. |
| Production build | PASS | Allowlisted syntax-checked package, SHA-256 manifest; npm ci --omit=dev succeeds with zero audit vulnerabilities. Production-only package smoke verifies HSTS, secure cookie, four-page processing, saved edit/Excel roundtrip and logout revocation. |
| Live startup | PASS | Main port 4317 health, protected route redirect, unauthenticated API denial, initial admin login, mandatory password gate and logout. Initial password preserved for the user. |

Evidence includes output/npm-audit.json, python-audit.json, performance.json, backup-restore.json and release-smoke.json; browser artifacts are under tmp/validation. Tests use real isolated PostgreSQL records. Synthetic PDFs are QA fixtures, not replacement application data. The production smoke used a local reverse-proxy configuration simulation, not a public HTTPS endpoint.

## Defects addressed and retested

- Persisted completion now precedes exposing a completed result; edits are cloned and version checked to avoid corrupting live state on a failed transaction.
- All document and derived-asset endpoints enforce authenticated ownership. Administrative and forced-password restrictions are backend controls.
- Durable jobs recover after process termination. Per-server temporary directories avoid stale worker interference; queue/memory limits bound OCR work.
- Portable Excel preserves simple columns, text identifiers, numeric amounts, blank edits and checkbox values. A scoped compatible uuid override removes the reported transitive advisory.
- Build traversal excludes node_modules junctions and private data. Missing favicon noise was fixed and browser checks rerun.
- Test discovery was restricted to unit files rather than accidentally launching infrastructure suites. Argon2 parameter checking was made order-independent while still asserting exact values. QA identity was stabilized so persisted document fixtures keep their owner. A restart readiness race was fixed. These failures were investigated and rerun; no assertions were suppressed.
- Windows credential ACL application initially used an unprefixed SID; the corrected numeric SID form succeeded for all three environment files, local credentials and the verified backup.

## Performance and operational limits

PostgreSQL pooling, bounded pagination, indexed ownership queries and sequential asset persistence avoid unnecessary connection and memory pressure. A database advisory lease allows one OCR worker for a database. Queued work is durable; default queue capacity is three. This remains a single-node portal, not a horizontally distributed processing cluster. Final synthetic timings were approximately 50–83 seconds per document on this machine; accuracy checks remained intact.

Default document retention remains two hours, with persistent state surviving restarts during that period. Audit/account history and backup retention are separate. Operators must choose appropriate retention, encrypted storage, service monitoring, backup scheduling and dependency maintenance. Public TLS/domain configuration and a dedicated service manager are documented but not externally deployed. Windows was tested; another OS needs validation. Deprecated ExcelJS transitive packages remain despite no known audit advisories. Optional legacy developer previews need their original artifact runtime. MFA and self-service password recovery were not introduced; administrator reset is supported. No independent penetration test or compliance certification is claimed.

## Setup and deployment

For this machine, use start.cmd when the portal is stopped, then open http://127.0.0.1:4317. Sign in as portal_admin with the protected local initial credential and choose a new password. The application already runs against its clean live PostgreSQL database. Never run QA suites against this database; .env.qa and port 4318 are separate.

For another installation: install Node 24+, Python 3.12 and PostgreSQL; run npm ci and install requirements.lock.txt into a Python environment. Configure .env from .env.example and separate owner credentials from .env.migration.example. Run npm run db:migrate, then npm run admin:init with secure bootstrap environment values; remove bootstrap credentials afterward. Configure TEMPORARY_PASSWORD securely.

Before production exposure, run the documented suites and npm run build, install production dependencies in dist, provision Python and the database, configure HTTPS origin/reverse proxy and secure cookies, then run under a dedicated service account. Rehearse restore into a new database before switching connections. Detailed commands and controls are in DEPLOYMENT.md and DATABASE_DESIGN.md; the phase record is IMPLEMENTATION_TRACKER.md.

## File changes

The accompanying FILE_CHANGE_INVENTORY.md compares tracked application-source candidates against the pre-enterprise ZIP. It lists created and modified files, and any missing baseline paths. Generated outputs, dependency trees, secrets, database storage and private uploads are excluded. No existing application feature or source file was intentionally removed; the optional Excel preview implementation was retained under its explicit filename.
