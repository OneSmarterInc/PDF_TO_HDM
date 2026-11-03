# Local application verification — 3 November 2026

Scope: the React/Django portal and private Node OCR/export worker running locally. Mutating tests used the separate QA database on port 4318 and synthetic PDFs. Live port 4317 received read-only health/asset/access checks and an idle restart to load the tested UI fix. Live accounts and document contents were not changed.

## Checks completed

| Area | Evidence |
| --- | --- |
| Authentication and accounts | Existing password hashes, login/logout, password-change gate, reset, session revocation, role enforcement, account creation/edit/deactivation, filtering and pagination passed. |
| Security | CSRF/origin rejection, unauthenticated routes, secret-path protection, throttling, literal rendering of stored XSS input, document ownership and private-worker access rejection passed. |
| Database and audit | Transaction rollback, foreign keys, asset cascades, append-only audit permissions, audit filtering and immutable history passed. |
| Reader workflow | Confirmation before upload, OCR progress, source highlighting, pencil/Edit all, saving/discarding, blank/identifier/checkbox edits, re-verification, reload persistence and search passed. |
| Multiple pages | Two different synthetic claim pages were read; page/raw-text/source navigation, cross-page search, second-page corrections without changing page one, and both Excel worksheets passed. |
| Exports | Excel, JSON and text; raw on/off; saved values; leading zeros; intentional blanks; eight desktop/mobile text/JSON downloads; duplicate prevention; snapshot stability during editing; Excel failure/retry passed. |
| Failure recovery | Failed admin/audit/document list requests, retry controls, pending account submission guards, dirty-dialog cancellation, and page fallback after deleting/deactivating the last item on a page passed. |
| Cancellation and restart | Running OCR cancellation, replacement-upload confirmation and completion, and forced process-tree restart passed. Recovery resumed the same document ID and original PDF, with the blank control remaining blank. |
| Upload boundaries | Empty/non-PDF and >30 MB rejection; encrypted, corrupt, zero-page and 31-page PDF error states; blocked exports of failed jobs; deletion; queue capacity of three and rejection of a fourth passed. |
| UI and accessibility | Admin/member navigation, keyboard focus trapping/return, Escape and outside click, custom confirmations, password visibility/remasking, date formatting, 32 route/viewport combinations, and 320px branding checks passed without overflow or browser errors. |
| Automated checks | 53 JavaScript tests, 8 Django tests, 9 Python tests, lint, existing type checks and Django system checks passed. |
| Live preflight | Django/database health, login HTML, the actual compiled React bundle, styles/icons, and protected-route behavior passed on port 4317. |

## Repair made during this run

A successful retry of the user list previously left its old error message visible. The React user list now clears a stale error after a successful response while retaining normal success notices. The existing failure/retry regression test passes after this fix.

The demo preflight was also updated to check the compiled React entry point instead of retired vanilla-JavaScript assets. Reader control tests now derive page count from the selected synthetic document rather than assuming a private four-page sample.

## Reproducible evidence

`scripts/verify-portal.cjs` runs the account, reader and recovery groups and records individual logs/results in the ignored `output/full-verification` directory. `test-upload-edges.mjs`, `test-multi-page.cjs`, and `test-react-migration.cjs` cover the additional document cases. `create-edge-fixtures.py` uses the isolated QA Python environment to generate synthetic failure inputs.

Final recorded group results: 12/12 account suites, 8/8 reader suites, and 2/2 cancellation/recovery suites passed. No test failures remain in these groups.

The earlier three-fixture migration comparison remains valid: complete extracted pages, verification results except timestamps, and Excel contents/formats matched the original application exactly. This run changed UI error handling, not OCR models or extraction rules.

These results cover the local build and tested layouts. Linux Docker image qualification, a fresh container security scan, AWS staging, external penetration testing, and an accuracy guarantee for arbitrary PDFs are outside this run.
