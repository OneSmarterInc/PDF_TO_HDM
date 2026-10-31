# Production security remediation — 2026-10-31

This report addresses the container and JavaScript dependency blockers recorded in AWS_READINESS_REPORT.md. Final qualification results and the image identity are recorded in `verification/security-remediation.json`. AWS account-specific staging remains a separate deployment gate.

The final unsuppressed scan returned **0 critical, 0 high, 0 medium, 0 low and 0 unknown** findings across 71 OS, 135 Node and 15 Python package records. npm audit returned zero vulnerabilities; pip-audit returned no advisories for the 15 pinned Python dependencies. The earlier Debian candidate had 55 high/critical OS findings and the earlier npm tree had 7 moderate findings.

Final validation passed: 53 JavaScript tests, 9 Python tests, database/authentication/user/audit integration, 11 admin browser suites, 11 reader browser suites, lint, scoped typecheck, production build and CloudFormation lint. The final Linux image passed all 302 OCR fixture assertions, five actual Excel exports, saved-edit roundtrip, TLS enforcement, read-only/non-root execution, first-login enforcement, graceful interruption/recovery, session persistence and logout. No regression was found in these executed checks. AWS staging has not been run.

## Changes and compatibility

- Replaced the Debian runtime with a digest-pinned Wolfi glibc runtime, using its signed maintained packages. Retained Node 24, Python 3.12, every pinned OCR library and the existing English model. No database schemas, extraction rules, authentication policies or portal workflows changed.
- Removed install-only Python packaging tools after dependency installation and `pip check`. An intermediate scan identified an old setuptools version in the pip package's embedded inventory; the final image removes the unnecessary package rather than suppressing its finding or deleting its inventory selectively.
- Kept ExcelJS 4.4 and upgraded its archive/unzip dependency chain. The lockfile pins compatible Archiver 7.0.1, Unzipper 0.12.3, Glob 14.0.3 and Minimatch 11.0.2. Real workbook roundtrips and archive inclusion/exclusion tests cover this change. An incompatible intermediate Glob combination failed its regression test and was replaced, not waived.
- Added a repeatable image scan with a pinned Trivy scanner, read-only image archive and dedicated vulnerability database cache. It has no Docker-socket mount, no ignored advisories and no `ignore-unfixed` option. The policy rejects missing OS inventories and malformed results and fails on any high/critical finding; every severity is retained in the report.
- Extended isolated Linux qualification to run all five synthetic PDFs and their real Excel exports. Temporary credentials and test containers remain isolated from the live portal and are cleaned up afterwards.

## Reproduce release gates

Run `npm ci`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm audit`. Run Python unit tests in the pinned Python environment. With Docker available:

```powershell
docker build --platform linux/amd64 -t pdf-extractor-hdm:release .
node scripts/scan-image.mjs pdf-extractor-hdm:release
$env:TEST_IMAGE='pdf-extractor-hdm:release'
$env:TEST_FULL_OCR='1'
node scripts/test-container.cjs
```

The container test uses disposable PostgreSQL with certificate verification and localhost port 4320. It verifies migrations, hostname rejection, non-root/read-only operation, first-login enforcement, OCR, persisted field edits, real Excel output, graceful shutdown, restart recovery and logout. Full OCR mode also checks digital, scanned, skewed and blank inputs. Scan output is under `output/image-security-*.json`; container results are in `output/container-qualification.json` and `output/linux-synthetic-validation/report.json`. These local artifacts are excluded from Git and release images.

The retained OCR fixture assertions normalize spacing and punctuation when comparing recognition against source inputs; they do not establish character-perfect OCR for arbitrary PDFs. The new Excel assertion checks the exact extracted patient value, without normalization. Its initial comparison against source spacing failed on an existing OCR spacing difference even though Excel preserved the extracted value correctly; the test was corrected to separate recognition accuracy from export fidelity. Existing source-input checks remain unchanged.

Rebuilds can resolve newer signed OS packages and a refreshed vulnerability database can discover new advisories. Run these gates for every image and deploy the tested ECR digest, not an untested mutable tag. Zero reported vulnerabilities is a point-in-time scan result, not a security guarantee.

## Operational requirements retained

The AWS team must verify private networking, HTTPS/domain configuration, Secrets Manager access, RDS TLS, migrations, backup restoration, alarms and representative load in its own staging account. Keep exactly one application worker per database and account for deployment downtime. The existing six-character password minimum is retained as explicitly requested; configure long random temporary/admin secrets and obtain policy-owner acceptance before wider access. Review retention for sensitive uploaded documents. No AWS deployment, penetration test or compliance certification is claimed.
