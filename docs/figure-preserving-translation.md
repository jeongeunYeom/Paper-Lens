# Figure-preserving translated PDF implementation plan

Paper Lens currently extracts text with `pdf-parse` and renders a new report with `pdfkit`. That path is good for summaries, but it cannot reproduce the original PDF layout because `pdf-parse` does not expose each page's drawing operations, image XObjects, fonts, coordinates, or reading-order structure.

To generate a Korean translation PDF that keeps the original figures in the same position and shape, add a separate **layout-preserving translation pipeline** rather than extending the summary-report renderer.

## Target behavior

- **English paper**: produce a translated PDF that keeps the original page geometry and figure placements, excludes References/Bibliography pages or sections, and also produce a bilingual summary report.
- **Korean paper**: skip full-paper translation and produce only the bilingual summary report.
- **Figures**: preserve original figure bitmaps/vector regions as page background or copied page objects. Translate surrounding text blocks and captions separately.

## Recommended pipeline

1. **Parse page layout instead of plain text only**
   - Use a renderer/layout tool such as `pdfjs-dist`, `PyMuPDF`, or a managed PDF extraction API.
   - Extract per-page dimensions, text spans, bounding boxes, font sizes, and image/vector regions.
   - Keep `pdf-parse` only for the lightweight summary path if desired.

2. **Detect and remove the reference section**
   - Locate headings such as `References`, `Bibliography`, `Works Cited`, or `참고문헌` using text spans and page coordinates.
   - For the page where references start, keep only blocks before the heading.
   - Drop following reference-only pages from the translated PDF.

3. **Preserve figures and original layout**
   - Safest MVP approach: render each original page to a high-resolution image, then cover original text regions with white rectangles and draw translated Korean text into the same bounding boxes.
   - Higher-fidelity approach: copy original PDF page content/images as a background or form XObject, then overlay translated text. This preserves vector figures better than rasterizing whole pages.
   - Do not rely on `pdfkit` alone for this; use `pdf-lib`, `HummusJS` alternatives, or a Python service with `PyMuPDF` if exact page manipulation is required.

4. **Translate by layout block**
   - Group text spans into paragraphs/captions using proximity and font information.
   - Send each block to OpenAI with metadata such as page number, block type, and bounding-box size.
   - Preserve equations, variables, citations, units, table numbers, and figure labels.
   - Reflow Korean text into the original bounding box; if it does not fit, reduce font size down to a configured minimum or allow controlled overflow to the next line/page.

5. **Render translated PDF**
   - Use embedded Korean fonts such as Noto Sans KR or Noto Serif KR.
   - Draw translated text at the original coordinates.
   - Keep images/figures untouched.
   - Add a short disclaimer in metadata or a final page if any block could not fit.

6. **Integrate with current API**
   - Add a new service, for example `server/services/layoutTranslationService.js`.
   - Add a new route such as `POST /api/reports/translated-pdf` or attach `translatedReportId` to the existing `/api/analyze` response.
   - Keep `server/services/pdfReportService.js` focused on summary reports; it currently creates a new report and explicitly does not include the original PDF.

## Why this cannot be done reliably with the current code path

- `server/services/pdfService.js` uses `pdf-parse`, which returns plain text and metadata, not original figure geometry or page drawing instructions.
- `server/services/pdfReportService.js` creates a new report from normalized summary/translation data, so it has no access to original page objects or figure coordinates.
- Exact figure preservation requires page-level PDF rendering/copying, coordinate-aware text extraction, and overlay rendering.

## Suggested implementation phases

### Phase 1: Proof of concept

- Render original pages as backgrounds.
- Detect text blocks and cover/rewrite them in Korean.
- Preserve all figures visually because they remain part of the background.
- Exclude references by dropping pages or masking text after the references heading.

### Phase 2: Better text quality

- Add block fitting, font-size adjustment, and caption/table detection.
- Add a review log for blocks that overflow or could not be translated.

### Phase 3: Production fidelity

- Preserve vector figures without rasterizing full pages.
- Add OCR for scanned PDFs.
- Add job queue/background processing because full-paper translation can take minutes and many OpenAI calls.
