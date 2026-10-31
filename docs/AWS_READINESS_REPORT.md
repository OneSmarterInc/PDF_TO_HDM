# Initial AWS readiness and portal rename — 2026-10-31

> Historical assessment of the earlier Debian candidate. For the subsequent security remediation and current release evidence, see [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md). Findings and counts below describe the earlier image, not later qualified builds.

## Scope and current release status

Portal branding is **PDF Extractor HDM**. Existing database names, usernames, session-cookie names, document IDs, extraction behavior and saved data remain compatible. No live database migration, account reset, document removal or AWS resource creation was performed.

This is an AWS deployment candidate, not an assertion that an AWS environment has been deployed or certified. Account-specific HTTPS, DNS, IAM, RDS, networking, alert delivery, backup policy and realistic load acceptance remain go-live gates. See AWS_DEPLOYMENT.md. The refreshed Debian 13 candidate passed full Linux qualification, but its OS security gate is BLOCKED. Do not treat this candidate as approved for public production.

## Discovery and implementation

The existing system is a plain Node.js HTTP application with browser JavaScript/CSS, Python 3.12 PDF/OCR, PostgreSQL persistence and ExcelJS exports. It already has Argon2id authentication, role/ownership checks, forced first-login change, durable jobs, audit transactions and a single-process OCR lease. Inspection confirmed that uploaded originals, page images and results are stored in PostgreSQL; local OCR files are transient. No storage redesign or schema migration was justified.

Changes:

- Renamed all page titles, visible headers/footer, home accessibility label, favicon and local launch/health branding checks. Checked the full name at 320px as well as larger viewports.
- Added validated HOST/PORT/APP_ORIGIN configuration, configurable scratch directory and database pool size. Local binding remains loopback; the container binds to its private interface.
- Added explicit RDS CA/hostname verification and refusal of conflicting URL SSL options or unverified remote production DB connections. Invalid configuration errors do not echo connection URLs.
- Added opt-in ALB append-mode client IP handling, with task security-group restriction in the infrastructure template; spoofed first XFF entries are ignored. Existing loopback-proxy behavior remains compatible.
- Made shutdown reject new work, stop cleanup, abort/checkpoint OCR and drain HTTP requests before releasing the database lease; 90-second application deadline fits the ECS 120-second stop timeout.
- Packaged OCR models for local read-only use, removed misleading first-use model-download messaging, and restricted processing/export error logs to IDs and error codes instead of arbitrary exception text.
- Added a non-root Linux container, narrow Docker build-context allowlist, read-only application filesystem, writable temporary volumes and a readiness check. No secrets, local databases, uploaded PDFs or QA results are copied into the image.
- Added a CloudFormation template for private single-task Fargate, HTTPS ALB, narrow ingress, scoped secret read permission, retained logs and an unhealthy-target alarm. Default desired count is zero until database preparation completes.
- Added deployment, TLS/proxy and archive-compatibility regression tests plus repeatable isolated Linux/TLS/container qualification.
- Applied minimatch 11.0.1 only to compatible readdir-glob and ESLint dependency consumers. A blanket override broke legacy glob internals; the new regression caught this, the unsafe override was removed, and the passing compatible configuration retained. No test was removed or weakened to conceal that failure.

## Actual validation results

| Category | Result | Evidence |
|---|---|---|
| Baseline | PASS | 47 JS tests, lint, scoped typecheck, build before implementation |
| Current unit/workbook/config | PASS | 51 JS tests, including archive compatibility, TLS policy, proxy spoofing, extraction, checkbox and Excel tests |
| Python | PASS | 9 tests; pinned runtime dependencies install with pip check |
| Database | PASS | Real QA PostgreSQL CRUD/rollback, constraints, runtime permissions and safe errors |
| Authentication | PASS | 23 assertions; valid/invalid login, expiry, rotation, logout, CSRF, forced change, deactivation |
| User management | PASS | 28 API assertions plus real browser creation/edit/reset/deactivation; admin/client six-character flows and 54 password-eye checks |
| Audit | PASS | Actors, timestamps, filtering, pagination, atomic rollback, credential exclusion, read-only grants |
| PDF workflows | PASS | Admin and client confirmation gate, extraction, source comparison, individual/Edit all, save/discard, three downloads and reload |
| Individual edits / Excel | PASS | Only 3 intended values changed across 209 fields; literal IDs, amounts, cleared fields and checkboxes preserved in actual downloaded Excel |
| OCR fixtures | PASS | 302 assertions across 5 PDFs: digital A/B, scanned, skewed and blank; no source-review cache used for synthetic inputs |
| UI / branding | PASS | 32 route/viewport checks, Activity at 4 widths, 21 branding checks including 320px; no page errors or overflow |
| Dialogs / cancellation | PASS | Portal-owned dialogs, no native dialogs, navigation guarding, cancellation/replacement, menu dismissal and retry behavior |
| Date formatting | PASS | MM-DD-YYYY across portal in en-GB browser; strict filter validation and unchanged source values |
| Security / isolation | PASS | SQL injection probes, stored XSS, missing/wrong/cross-origin CSRF, persistent throttling, secret paths, cross-user document denial, stale-edit rejection |
| Recovery / backup | PASS | Interrupted OCR resumes with same ID; originals byte-identical; edits/session/export audit retained; QA snapshot restored to separate DB with matching rows and asset byte totals |
| Local performance | PASS (limited sample) | 20 requests per endpoint: p95 auth 9ms, users 6ms, audit 10ms; Excel 1386ms. Not an AWS concurrency benchmark |
| Linux container | PASS on refreshed Debian 13 candidate | Verified DB TLS, wrong-host rejection, migrations, non-root/read-only filesystem, forced change, Linux OCR, actual Excel, SIGTERM/restart recovery, logout |
| Infrastructure | PASS locally | cfn-lint accepted deploy/aws-cloudformation.json; no actual AWS stack deployment |
| Python dependency audit | PASS | 15 pinned packages, no known advisories returned by pip-audit |
| JavaScript dependency audit | KNOWN MODERATE FINDINGS | Final npm audit: 7 moderate transitive legacy archive/glob findings, 0 high/critical; see residual risks |
| Container OS/packages | BLOCKED | Initial image: 89 OS + 6 bundled-npm high/critical findings. Refreshed Debian 13 image: 55 OS findings (54 high, 1 critical) across 17 advisories; 0 Node and 0 Python high/critical findings. Stable distro packages have no fixed versions listed. No findings suppressed |
| Lint / scoped typecheck / build | PASS | ESLint, existing TypeScript checked-JS scope and release allowlist build; legacy/browser code is not claimed fully typed |
| Actual AWS staging | NOT RUN | No account/network/domain/RDS/secret configuration supplied or deployed |

Machine-readable evidence is under output/: aws-portal-regression.json, aws-reader-regression.json, container-qualification.json, synthetic-validation/report.json, performance.json, backup-restore.json, npm-dependency-audit.json and python-dependency-audit.json. These local QA artifacts are excluded from release images.

## Residual risks and deployment gates

**Container release blocker:** tested/scanned image `sha256:8ea22b48361ca3f96341c28140e2611bdca87ee26e67d4bd56ff02d8f5af9c80` still has OS findings after changing from Debian 12 to Debian 13 and applying all available package upgrades. The critical finding is libxml2 CVE-2026-6653; remaining high findings include util-linux, ncurses, libxml2, X11 and other base packages. Findings are package/advisory pairs, not 55 confirmed remotely exploitable portal defects. Debian classifies some differently (for example, libxml2 CVE-2026-6653 as no-DSA/minor), but that does not justify silently overriding the scanner. See [Debian libxml2 status](https://security-tracker.debian.org/tracker/CVE-2026-6653) and [util-linux status](https://security-tracker.debian.org/tracker/source-package/util-linux). Non-root/read-only/capability restrictions mitigate some local attack paths but are not replacements for remediation.

Safest next step: qualify a vendor-maintained patched/hardened Python/Node-compatible runtime, or rebuild when the stable distribution publishes fixes; rerun the image scan and full Linux OCR/Excel/recovery suite. Formal security-owner applicability review may document individual exceptions, but no such approval is assumed here. Do not use unstable distribution packages or substitute OCR models merely to obtain a clean scan. An actual AWS staging run remains independently required.

The Docker-socket scan was rejected by automatic approval review because it would grant broad host-daemon access. The successful scan used a read-only image archive and dedicated scanner cache; no socket, credentials or project data were mounted. Docker Scout itself required a login, so Trivy was used instead.


1. Seven moderate npm findings are inherited through legacy ExcelJS/archive/glob. The portal does not accept user-supplied glob patterns; Excel uses generated worksheet/archive paths. A forced matcher major-version override demonstrably broke the legacy glob dependency. Keep the compatible versions, track the upstream fix, and have the deployment owner review this dependency exception. Advisory: https://github.com/advisories/GHSA-g3hv-75wg-m249.
2. The user-requested six-character password minimum and shared configurable temporary password remain intact. Operators can configure a much longer temporary secret; stronger per-user credentials/password policy should be agreed before wider deployment. First-login enforcement, hashing, throttling and revocation remain tested.
3. Single-worker design means maintenance downtime and bounded OCR throughput. Do not scale replicas beyond one. Load-test representative workloads before increasing queue sizes.
4. The runtime uses PostgreSQL binary assets. Approve retention and RDS capacity/backups; local deletion is not a forensic-erasure guarantee and backups have separate retention.
5. No external penetration test, AWS go-live acceptance or privacy/compliance certification is claimed. Synthetic-fixture success is not a guarantee of perfect extraction on every possible PDF.

## Files

New: deployment-config.mjs, Dockerfile, .dockerignore, deploy/aws-cloudformation.json, docs/AWS_DEPLOYMENT.md, docs/AWS_READINESS_REPORT.md, test/deployment-config.test.mjs, test/archive-compatibility.test.mjs, scripts/test-container.cjs, scripts/test-branding.cjs.

Modified: server.mjs, security.mjs, db/index.mjs, public/index.html, public/admin.html, public/documents.html, public/login.html, public/password.html, public/favicon.svg, public/portal.css, package.json, package-lock.json, .env.example, scripts/start-local.ps1, scripts/demo-check.mjs, README.md, docs/DEPLOYMENT.md, docs/IMPLEMENTATION_TRACKER.md and docs/PROJECT_AUDIT.md. No application functionality or database tables removed.
