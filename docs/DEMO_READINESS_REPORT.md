# Demo readiness review — 31 October 2026

The implemented admin and client journeys passed the checks below. The live portal is running at http://127.0.0.1:4317 and its read-only preflight passed. No unresolved failures remain in the executed tests. This is evidence for the rehearsed local demo, not a guarantee for every document, browser or deployment environment.

## Issues fixed

1. Repeated startup could attempt a second server and fail with a port conflict. The launcher now recognizes a healthy existing Clarity instance and exits successfully, with a clear message for an occupied/unhealthy port. Repeated startup was tested against the live instance.
2. Closing or pressing Escape in a changed account form silently lost edits. The portal now asks before discarding them. Close and repeat submission are blocked while an account operation is pending. Failed submissions keep the form and restore controls.
3. Text/JSON exports had no request-in-progress guard, and export completion could re-enable controls despite unsaved edits. All export types now share a busy state. Text/JSON capture the document and raw-text setting at selection, preventing a slow request from exporting later unsaved values or another document. Export failures restore the correct state and allow retry; document removal waits until download preparation finishes.

Fault-injection browser tests exercised slow account/export requests, duplicate clicks, changed data during an export, deliberate server-error responses, cancellation and successful retries. These tests used only the isolated QA server/database.

## Actual results

| Area | Result |
|---|---|
| Unit tests | 44 JavaScript and nine Python passed |
| Extraction campaign | All five synthetic PDFs passed, 302/302 expected field/checkbox checks |
| Extraction timings | Completed digital A: 79s; digital B: 79s; scan: 77s; skew: 107s; blank: 77s, including local scheduling/load |
| Admin/client accounts | UI creation, six-character temporary login, mandatory password change, new-password login, old-password rejection and permissions passed for both roles |
| Password controls | 54 show/hide checks across desktop and 390/320px mobile passed |
| Database/auth/user/audit APIs | CRUD/transactions/constraints/grants; 23 auth assertions; 28 user assertions; audit filters, actors and immutability passed |
| Reader workflows | Both roles passed upload confirmation, four-page processing, source selection, individual pencil editing, Edit all, save/discard, three exports and reload persistence |
| Actual Excel | Both admin/client downloaded workbooks retained edited name, leading-zero identifier, numeric amount and blank address |
| Text/JSON | Eight downloads across desktop/mobile/raw on/off matched saved fields; dropdown close behavior passed |
| Reader controls | All four pages, raw-text tabs, search, attention filter, source open/close/page/zoom, all-pages and icon placement passed |
| UI/navigation | 32 route/viewport combinations; six destinations on desktop/mobile; role-specific drawer, keyboard, reduced motion and no layout shift passed |
| Dialogs | Sign-out, unsaved navigation/discard, account changes, password reset, document deletion/closure, Escape/Cancel/acceptance passed without native browser dialogs |
| Processing | Active OCR cancellation, replacement confirmation and replacement completion passed |
| Security regression | Cross-user access denied; role restrictions, stale edits, SQL injection, CSRF, throttling, protected paths, audit grants and stored-XSS checks passed |
| Restart | QA server restart preserved session, saved fields/checkbox, original PDF bytes and all three export audit events |
| Tooling | ESLint, existing scoped TypeScript checks and production build passed |
| Live checks | Database/app health, login/assets, protected routes, sample files and presence of an active administrator passed; no live credentials were reset |

The completed synthetic claim also passed all 45 automatic field checks. Other scanned examples can correctly trigger review flags even when expected extracted values pass regression assertions: automatic verification requires evidence corroboration, not just a plausible value. No flags were hidden to improve the demonstration.

## Deliverables and evidence

- docs/DEMO_GUIDE.md: walkthrough and preparation for 1 November.
- demo-samples/: completed, scanned and blank synthetic claim PDFs, copied from verified fixtures.
- npm run demo:check: repeatable read-only preflight.
- scripts/test-demo-resilience.cjs: fault-injection regression for the fixes.
- output/synthetic-validation/report.json: all five extraction results.
- output/password-flow-qa.json: real-account lifecycle and eye checks.
- tmp/validation/: browser screenshots and actual exported files.
- dist/: rebuilt application package with the updated documentation.

Source changes are limited to reader export-state handling, account-form dismissal/submission handling, local startup, preflight/test support and documentation. OCR algorithms and database schema were not changed. QA data and fault-injection requests remain separate from live data.

## Before presenting

Run start.cmd and npm run demo:check. Confirm your current admin password privately; the preflight deliberately does not try credentials. Have the configured temporary password ready privately for the newly created demo client. Use a separate/private browser window for the client login. Upload a fresh PDF near the meeting because document retention remains two hours. Start with Completed claim.pdf, allow time for OCR, and save before exporting or refreshing. Keep the machine awake and on power.

The portal remains local, with no public hosting or external security/compliance certification claimed. Browser close/reload cannot show a custom portal confirmation. Longer-term load testing and unsupported PDF layouts remain outside this demo rehearsal.

## Additional full recheck

A further fresh run reproduced a missing Retry action on a failed document-list load. This was fixed, along with stale errors after successful reloads and page correction when deletion/deactivation removes the last item from a page. Dedicated real-database pagination and fault-injection tests passed after the fixes. All five extraction fixtures again passed 302/302 checks, and the full admin/client, mobile, password, export, security, confirmation, cancellation and restart checks passed. See output/full-portal-recheck.json and IMPLEMENTATION_TRACKER.md. No live data was changed by the tests.
