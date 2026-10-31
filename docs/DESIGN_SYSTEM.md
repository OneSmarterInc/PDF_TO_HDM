# Portal design system

Preserve Clarity's teal identity. Primary #087f76, body text #18313c, muted #596f7b, white surfaces with #dce5e5 borders. Use Segoe UI/system sans-serif, 13–16px body/control text and 32px page headings. Spacing uses multiples of 4px; panels have 12px radii. Lucide outline SVG icons provide one consistent icon language, with text labels retained.

Separate routes: /login, /change-password, /portal (existing reader), /documents (owner-only history), /admin, /admin/users, /admin/audit. Administrative links are role-dependent; server authorization remains authoritative. Ordinary users enter the document workflow directly.

Forms have visible labels, native validation plus backend validation, pending/disabled submit states and explicit success/error messages. User and activity dialogs use native dialog focus management and Escape handling. Tables keep headers and horizontal scrolling on mobile. Navigation wraps and can collapse on small screens; active links expose aria-current. Reduced-motion disables animations/transitions. Source comparison, search, dirty-field controls and optional blank statuses remain intact.

Screen checklist: login, password change, upload, confirmation, processing/cancel/replace, results/all pages, each page/raw text, source viewer, exports, document history, admin overview, users/list/create/edit/reset, audit/list/filters/detail; tested at desktop, laptop, tablet and phone widths in phase 5 and full workflows in phase 6.

## Shared action buttons

Primary actions use teal #087f76; secondary actions use a white surface, #cadbd8 border and #315650 text. Standard actions have 10px corners, 46px minimum height, 14px labels and 12px group gaps. Table/field actions use a compact 36px height and 8px corners. Destructive document deletion uses red text and a restrained red hover state. Disabled buttons have a neutral surface and no hover shadow. Keyboard focus remains visible. File selectors, export menus and action links share the system. Tabs, page selection, field comparison and drawer icon controls retain their functional selected states. Groups wrap on small screens; confirmation/processing actions stack.

## Portal confirmations

Use confirmAction from session.js for consequential actions. Portal-owned dialog markup provides a warning title, explicit consequence, Cancel first/default focus, a specific action label, focus wrapping/return, Escape/outside cancellation and reduced-motion support. Used for sign-out, document deletion/closure, stopping/replacing processing, discarding edits, unsaved internal navigation, password reset and account-access changes. Confirmation cancellation performs no mutation. Text uses textContent, never user HTML. Only one confirmation can be active. Native alert/confirm/prompt and beforeunload dialogs are not used. Browsers do not allow a custom website modal to intercept tab closure/reload; unsaved edits are protected during portal navigation, not browser-level closure/refresh/history controls.
