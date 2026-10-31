# Client demo guide — 1 November 2026

## Before the meeting

1. Open `D:\claims-pdf-reader\start.cmd`. If the portal already runs, the launcher reports that instead of starting a conflicting second server.
2. In the project directory run `npm run demo:check`. This checks the running app/database, login page, essential icons/modules, protected routes and sample files without changing accounts or documents.
3. Open http://127.0.0.1:4317 in your usual browser and sign in with your current administrator password. The initial password listed in the local credential file is not a replacement for a password you have already changed.
4. The current configured temporary password for new/reset accounts is in the protected `.local-credentials.txt`. Read it privately before screen sharing. Do not display the file in the demo.
5. Keep the machine awake, connected to power, and leave its portal/database processes running. The local portal is not a publicly hosted URL.

## Suggested walkthrough

- Show the admin Overview, Users and Activity pages through the left overlay navigation.
- Create a new client account with a unique username. It receives the configured six-character temporary password.
- Open a separate browser profile or private window for the client. Log in with those temporary credentials and complete the required password change. Eye controls independently show/hide each field.
- Upload `demo-samples/Completed claim.pdf`. It contains synthetic demonstration data. Show the PDF confirmation screen, then confirm processing.
- Let processing complete; the detailed OCR checks can take around one to two minutes depending on machine load. Show progress rather than promising an instant result. Use this time to explain that processing is local and source evidence remains available.
- Compare the original alongside the form, navigate pages, search, and click a right-hand pencil. Edit one value, finish with the checkmark, then Save changes.
- Download Excel and show the edited value. Optionally demonstrate More exports, Text/JSON, and outside-click dismissal.
- Show My documents and, back in the admin window, the activity history. Sign out through the portal confirmation.

## Additional sample files

`Completed claim.pdf` passed all 45 automatic field checks in this rehearsal. `Scanned claim.pdf` demonstrates image-based extraction and may flag uncertain evidence for review; use it to demonstrate comparison rather than promise a flag-free result. `Blank claim.pdf` demonstrates handling of an empty form. All files in demo-samples are copies of verified synthetic fixtures, not real client records and not preloaded application results. The reader processes uploads normally. The exact-source saved review used for the original supplied example is a separate feature and is visibly identified as such.

## Recovery and boundaries

- If processing is slow, wait for progress or use Cancel processing / Use another PDF. Cancellation requires confirmation.
- If an export fails, the portal shows an error and permits retry. Unsaved edits must be saved or discarded before exporting.
- Account forms warn before discarding unsaved edits. Refresh/closing the browser cannot show a custom portal-owned warning; save first.
- Documents expire after the configured retention period (currently two hours). Upload a fresh demo document near the meeting; do not rely on the previous day's history being retained.
- Do not present automatic checks as a guarantee for every PDF. If a field is flagged, demonstrate source comparison and correction. This is a locally tested application, not an external security/compliance certification.
- No existing live password was reset and no demo/test users were inserted into the live database during this readiness review. All destructive and fault-injection checks ran against the separate QA environment.
