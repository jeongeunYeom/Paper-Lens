# Report fonts

Place a Korean-capable font here to embed it in generated PDF reports.

Recommended file names:

- `NotoSansKR-Regular.otf`
- `NotoSansKR-Regular.ttf`
- `Pretendard-Regular.otf`

The server also tries `REPORT_FONT_PATH`, `@fontsource/noto-sans-kr`, common system Noto/Nanum paths, and finally falls back to PDFKit defaults if no font is available.
