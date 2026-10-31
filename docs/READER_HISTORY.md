# Historical reader notes (pre-enterprise upgrade)

These notes describe earlier versions. For current authentication, persistence and deployment behavior see README.md and DEPLOYMENT.md.

# Clarity PDF Reader

A local website for uploading PDFs and reading their contents in organized, page-linked sections. Scanned pages use local RapidOCR and Tesseract; PDF rendering uses pypdfium2. No API key is required. No uploaded document is sent to an AI service.

## Run

Double-click `start.cmd`, then visit http://127.0.0.1:4317. Keep the terminal running while using the website. Alternatively run `npm start` in this directory.

Requirements: Node.js 20+ and the local Python environment described below. On another computer install requirements.txt and run npm install. Set `PYTHON_PATH` if your Python executable is elsewhere. Set `PORT` to change the port.

The first OCR run downloads the English model; later runs use the local `models` cache. Model loading is the only external request needed at runtime.

## Features and limits

- Results open in an All pages overview with compact field tables, page/field/service/review counts, document-wide search and a Needs review filter. Page views retain source highlighting and correction controls. Excel is the primary export; text, JSON and raw details are under More exports.
- During processing, Cancel processing stops active OCR or removes the queued job. Use another PDF cancels the current job and uploads the replacement. Cancellation aborts Python subprocesses and terminates an active Tesseract worker; the queue can continue with a new worker. Elapsed time and a slow-step notice remain visible; Retry status recovers from a failed progress request.
- PDF upload or drag and drop, 30 MB / 30 pages maximum.
- Export Excel downloads a real `.xlsx` workbook with a readable field sheet for each page, separate service tables and checkbox options. Unresolved fields are marked Needs review. Raw details and page text are opt-in. Each data row retains its source page. The export uses the bundled Codex spreadsheet runtime on this computer (linked under `excel/node_modules`).
- CMS column labels follow the form items. Version 08/05 box 30 is Balance Due; version 02/12 box 30 remains reserved. The supplied 2014 manual is a reference for the older layout, not a source of patient values. Separate service columns support aligned 02/12 and 08/05 layouts; unsupported layouts remain available in the optional page text and original PDF.
- Only clearly parsed amounts become numeric currency cells. Ambiguous OCR stays in Field review instead of becoming an invented amount. Identifiers remain text. Corrections are included in Excel, with original readings retained.
- Full-page OCR, page navigation, English text search, text and JSON export.
- Standard professional and hospital claim forms receive layout-based sections; other documents receive general sections. The full extraction and original are always accessible.
- Low-confidence OCR words can be located in the original image. Confidence is an OCR heuristic, not a guarantee of correctness.
- Extracted fields show their reading status. Review/edit a field while looking at its source, then save the reviewed value. Exports include reviewed values and JSON retains the original OCR value. Corrections remain available until the temporary document expires.
- Blank checkboxes, faint marks, handwriting, complex tables and misaligned scans may require manual review. The app does not interpret medical codes, decide coverage, calculate balances or reconcile distinct claims automatically.
- OCR text preserves the observed content; embedded digital text is also included in the JSON export when available.
- Files are held in a randomly named temporary directory, removed after two hours or by New document, and removed on a normal server shutdown. Forced termination may leave temporary files in the system temp directory.
- Binds only to 127.0.0.1. This is a local application, not an authenticated multi-user production service.

## Verify

Run `npm test`. Use a PDF with real scan content to verify OCR after model setup. Sample patient data is not bundled in the website or source.

## Extraction accuracy

Independent page OCR engines now run concurrently. Magnified crops are streamed to the second engine as the first finishes each field, preserving their original order. The same resolutions, OCR models, field checks, confidence rules and checkbox analysis are retained; no verification is skipped for speed. Job JSON includes stage timings, and the processing view shows verified field counts. Cancellation aborts both concurrent stages and prevents cancelled crops from reaching a replacement job.

The reader now combines local neural OCR (RapidOCR) with Tesseract, checks detected field positions against CMS-1500 headings, and re-renders every detected field at up to 576 DPI (8x PDF scale). Each close-up is read both with and without table-line cleanup, then checked by the second OCR engine. Magnification cannot restore detail absent from a scan; independent agreement is required before resolving disputed readings. Names, identifiers, dates, procedure codes, diagnosis codes, currency and NPI checksums have field-specific validation. Conflicting values remain blank in the main results and are available under Needs review. The original page is never modified.

The default view contains entered claim data and service tables. Boilerplate, stamps and empty/reserved boxes are excluded. Side-margin labels are excluded from positioned OCR text and structured fields. The original PDF remains untouched. Excel defaults to plain Calibri cells, bold headers on row 1, frozen headers, and useful columns only. Page fields and service tables remain separate to avoid false matches. Unresolved fields are marked Needs review; full OCR audit details are optional.

The separate local Python environment is required for the neural OCR engine. To recreate it, use Python 3.12: `python -m venv .venv`, then `.venv\Scripts\python.exe -m pip install -r requirements.txt`. Models are bundled in the installed OCR package and run locally. Both models can still make mistakes, and unsupported form layouts are explicitly withheld rather than read using guessed coordinates. Automatic structured professional-claim extraction supports aligned 02/12 forms and a separate mapping for the supplied 08/05 layout. The older layout uses numbered ICD-9 diagnoses and Balance due. Mild scan skew is corrected before OCR and the same rotation is applied to magnified crops. Blank forms are not treated as populated claims.

Implementation reference: [RapidOCR](https://github.com/RapidAI/RapidOCR).



Expanded extraction includes separate check/EFT and provider payment amounts, payment identifiers, remittance service details, signed adjustment amounts and printed explanations. Hospital service tables include descriptions, revenue codes, procedures, modifiers, service dates, units, charges and non-covered charges. Additional hospital admission, payer and provider fields appear in both the website and plain Excel tables. Unreadable fields remain available for review; no check number is invented when the notice leaves it blank.


## Source review and checkboxes

The CMS-1500 checkbox reader locates square borders and measures the inner mark. Crossed boxes are selected. Blank boxes are unselected; a missing border or ambiguous mark requires review. An unselected Yes box is not interpreted as a selected No box. All seven insurance-type boxes in the supplied sample are blank; the printed PICA XXX marks are excluded.

The supplied sample has a separate visual source audit in output/example-claims-reviewed.json and a readable workbook in output/example-claims-reviewed.xlsx. The audit covers 209 structured fields, all 29 checkbox states, and the payment explanations. It corrects the hospital box 70 label to Patient reason for visit diagnosis.

Reviewed results are saved locally under reviews/ and are reused only when the uploaded PDF has the exact same SHA-256 hash and matching page dimensions. The website labels this as a saved review. Other PDFs continue through OCR and can require review. These private review/output files are excluded from Git and persist until deleted; ordinary upload files still expire from temporary storage.

Default Excel exports contain a narrow Section / Field / Value / Status sheet for each PDF page, separate professional and hospital service tables, and a checkbox option table. Selecting raw details retains the diagnostic export.

Verification: npm test, plus .venv/Scripts/python.exe -m unittest discover -s test -p "test_*.py".

## Synthetic PDF regression suite

The supplied blank 08/05 sample is used in five local test files under test/fixtures: two filled PDFs with different synthetic patients and selections, a 144 DPI image-only scan, a scan tilted by 0.8 degrees, and a blank control. They contain no real patient data. The fixture inputs are in expected.json; extraction never imports those expectations or uses saved reviews for them.

With the website running, run `node scripts/validate-synthetic.mjs`. Each filled case checks 32 entered fields (including two service rows), 11 checkbox summaries and all 29 individual checkbox states. Unexpected populated fields also fail. The blank control must not publish patient or financial values. Results, mismatches and a sample Excel export are written under output/synthetic-validation. Individual cases can be rerun by passing their filename stems.

The suite validates these entries and scan conditions on this form layout, not every possible PDF. Other layouts, handwriting, damaged scans and additional untested fields still need source review. A successful test does not turn an OCR confidence score into a guarantee.



## Automatic verification

After extraction, the portal checks OCR corroboration, supported layouts, key-field presence, strict formats/checksums, checkbox consistency and service-charge totals. It shows Checks passed or Needs attention and links each issue to its page/field. The attention filter uses these checks. Existing close-up retries remain enabled; their independent agreement is retained for verification. No new model or external service is used.

Verification reruns after each saved edit. Saving is not source verification: corrections differing from the original reading remain flagged because automatic format/arithmetic checks cannot establish their source accuracy. The exact-file source audit remains trusted for the supplied reviewed PDF. Standard Excel exports include verification results and field attention statuses. Export remains available for flagged documents so users can work with exceptions; no claim of guaranteed accuracy or insurance eligibility is made.

Validated with 35 unit tests, a fresh synthetic OCR run (72 expected data/checkbox checks passed), and browser tests covering extraction status, an incorrect edited total, exception filtering, correction, and the exported Verification sheet. The synthetic run automatically passed 38 of 45 detected fields and flagged seven unresolved/evidence-limited fields, including empty cells that OCR could not distinguish confidently. Thresholds are deliberately conservative and have not been calibrated on a large production dataset.

## Reducing false verification flags

The seven flagged fields in synthetic legacy-A were visually checked against the PDF: DOB 02/29/1988, total 200.75, balance 150.75, first service charge 125.50, units 1, and empty optional diagnoses 3 and 4. No test values are used by extraction.

Changes retain page-level neural evidence, tighten the legacy DOB crop, remove thin monetary-cell separators, and retry low-confidence numeric crops in another segmentation mode and at a smaller scale. Numeric corroboration can use a page reading >=98, a matching magnified neural reading >=90, and a matching independent reading >=75 only when the value validates and no competing valid secondary reading exists. Free-text fields do not use this exception. Normal high-confidence independent agreement remains the default.

Optional ICD-9 cells 2–4 can be recognized as blank only when image evidence shows no text-sized foreground, OCR produces no valid diagnosis, and there is no meaningful close-up reading. Faint text remains evidence of content. Pale broad backgrounds and solid triangular watermark remnants are separated from text by geometry. Optional blanks remain empty in Excel instead of becoming Needs review. These checks reduce sample false positives; they do not establish universal accuracy.

Final false-flag regression (2026-10-30): legacy-A now passes 45/45 automatic field checks with zero issues and 72/72 expected value/checkbox assertions. Five-fixture extraction regression passes 302/302 assertions; 38 JavaScript and 9 Python tests pass. Browser tests verify incorrect edits still flag, restoring the source value clears them, and the downloaded workbook retains optional blank cells and the verification result. Detailed audit: output/synthetic-validation/false-flags-review.txt. Existing jobs need fresh extraction to apply new image-reading rules.
