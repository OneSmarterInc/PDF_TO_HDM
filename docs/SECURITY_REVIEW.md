# Security review and verification

## Controls implemented

Opaque 256-bit random session tokens, hashed in PostgreSQL; Argon2id passwords (64 MiB, three iterations, one lane); secure production cookies; strict same-origin and per-session CSRF verification; eight-hour absolute and 30-minute idle sessions. Password changes/reset revoke old sessions. Inactive accounts cannot authenticate or continue using an old session. Mandatory password changes are enforced before every protected document/admin API, not just by a redirect.

Admin/user roles are checked server-side. Document results, original PDFs, rendered images, edits, deletion, exports and lists are owner-scoped, including for administrators. User edits cannot demote/deactivate their own administrator account or remove the last active administrator. Database parameters protect user-controlled queries. Administrative pagination is bounded. Document edits use version checks to reject conflicting saves.

Login throttles are stored in PostgreSQL: ten account attempts and 100 direct/trusted-proxy-IP attempts per 15 minutes. Password-change attempts are similarly limited. Concurrent password work is bounded to four operations. Input sizes, PDF size/page count, concurrent receiving and queued-job counts are capped. HTTP header/request timeouts are configured. Uploaded documents are rendered by subprocesses; embedded instructions are treated as data, not commands.

The database runtime role cannot change schema or modify/delete audit history. Business changes and events share transactions. Audit metadata uses an allowlist and excludes credential material and extracted patient values. History filters/details are admin-only. A PostgreSQL trigger additionally rejects audit mutation. Superuser/operator access is outside the application security boundary and needs operational oversight.

Response headers include CSP, no-sniff, same-origin framing, no-referrer, permissions restrictions and production HSTS. Dynamic values use textContent rather than HTML injection. Workbook strings remain literal text, not executable formulas. Protected HTML/data responses are no-store, and restored browser pages recheck the session. Runtime credentials are separate from migration secrets; QA runs against a separate database and configuration.

## Executed checks

- Valid/invalid admin and user login; hashing; mandatory reset and direct API bypass attempts; session rotation, logout, expiry and deactivation.
- Cross-user attempts against result, original PDF, PNG, edit, delete and Excel endpoints; admin API denial; owner-scoped lists and stale edit rejection.
- Missing/wrong/cross-origin CSRF; SQL-like username and search input; stored hostile HTML rendered as literal account text without execution.
- Persistent login rate-limit threshold; blocked public paths for .env, credentials and schema; CSP/cache headers; read-only audit API and restricted database privileges.
- Transaction rollback, foreign keys, asset cascade, safe database errors, audit rollback consistency and credential exclusion.
- Workbook roundtrip checks for formula-like strings, leading-zero identifiers, numbers, blanks and checkbox state.
- npm audit: zero known vulnerabilities after a scoped ExcelJS uuid override to 11.1.1 (its used v4 API remains compatible). Some transitive packages emit deprecation notices; these are recorded, not presented as vulnerabilities resolved by a blanket force upgrade.
- pip-audit: all 15 exact installed runtime packages audited, zero known vulnerabilities. Output is in output/python-audit.json; npm output in output/npm-audit.json. Audit results are time-bound, not future guarantees.

## Limits and operational requirements

This is an application review with automated local tests, not an independent penetration test or certification. External HTTPS, database network rules/TLS, encrypted storage/backups, service account permissions, secret rotation and production load behavior require deployment validation. Native PDF/OCR parser vulnerabilities may not all be covered by package advisories; keep the runtime patched. Temporary files from interrupted runs are isolated and cleaned when the server next runs; configure service supervision and process-tree shutdown for forced OS termination. No claim of secure physical erasure of database pages/backups is made.

The portal deliberately uses one leased OCR worker process per database. Higher document throughput requires a separately designed worker fleet and load tests; a larger queue alone is not horizontal scaling. The shared temporary password mechanism is implemented as requested, but distribution must follow an approved secure process and each user must immediately replace it.
