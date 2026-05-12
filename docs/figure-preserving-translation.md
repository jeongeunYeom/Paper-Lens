# Figure-preserving translated PDF pipeline

Paper Lens now includes a first-pass layout-preserving translation pipeline for English papers. It is intentionally separate from the summary-report renderer because the regular `pdf-parse` + `pdfkit` summary path does not expose original page drawing operations, image XObjects, fonts, coordinates, or figure geometry.

## What the first implementation does

- Uses Poppler tools (`pdftoppm` and `pdftotext`) when they are available on the server.
- Renders each original PDF page to a high-resolution PNG background.
- Extracts text word bounding boxes with `pdftotext -bbox-layout`.
- Groups words into lines/blocks, paints white rectangles over detected text blocks, and draws Korean translation text into those same block areas.
- Keeps figures, charts, and visual layout visible because they remain part of the page background.
- Detects `References`, `Bibliography`, `Works Cited`, or `참고문헌`; pages after the reference heading are dropped, and text below the reference heading on the same page is masked.

## Runtime requirements

Install Poppler on the deployment image:

```bash
# Debian/Ubuntu
apt-get update && apt-get install -y poppler-utils
```

Required commands:

- `pdftoppm` for page rasterization
- `pdftotext` for coordinate-aware text extraction

If either command is missing, Paper Lens still returns the normal bilingual summary/translation report, but the `layoutTranslation` response has `status: "unavailable"` and the UI shows why the figure-preserving PDF could not be generated.

## API flow

1. `/api/analyze` extracts text, summarizes, translates English papers, then tries to create the layout-preserving PDF while the uploaded source PDF still exists.
2. If generation succeeds, the response includes:

   ```json
   {
     "layoutTranslation": {
       "status": "ready",
       "downloadPath": "/api/reports/<reportId>.layout-translated.pdf"
     }
   }
   ```

3. The client displays a `Figure 보존 번역 PDF` download button.
4. The binary PDF is held in memory for 30 minutes, matching the existing report cache behavior.

## Current limitations

- This MVP preserves figures by using the original page as a raster background. It is visually close to the source, but not a fully editable/vector-preserving PDF.
- Text block detection quality depends on the PDF's internal text layer. Complex multi-column layouts, tables, equations, or overlapping annotations may require manual tuning.
- Korean text can be longer than the original English block. The renderer reduces font size and clips overflow when needed.
- Scanned PDFs still need OCR before this pipeline can identify text boxes.
- Full-paper translation can take longer and use more OpenAI tokens than summary-only analysis. Each translation chunk is retried, and if a chunk still fails the app returns a partial translation rather than failing the whole analysis request.

## Future improvements

- Preserve vector figures without rasterizing full pages by copying original PDF page objects/form XObjects.
- Translate per detected paragraph/caption instead of flowing a global translation paragraph list into detected blocks.
- Add OCR for scanned PDFs.
- Move long layout-preserving translation work to a background job queue.
