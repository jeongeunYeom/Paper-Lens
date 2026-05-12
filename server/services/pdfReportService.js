import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { normalizeSummary, splitIntoParagraphs, toBulletItems } from './summaryFormatService.js';

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceDir, '../..');
const EMPTY_MESSAGE = '해당 내용을 명확히 찾지 못했습니다.';
const FONT_CANDIDATES = [
  process.env.REPORT_FONT_PATH,
  path.join(repoRoot, 'fonts/NotoSansKR-Regular.otf'),
  path.join(repoRoot, 'fonts/NotoSansKR-Regular.ttf'),
  path.join(repoRoot, 'fonts/Pretendard-Regular.otf'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-400-normal.woff'),
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
].filter(Boolean);

// 화면에 표시된 요약 결과만 PDF 보고서로 생성합니다. 원문 PDF는 포함하지 않습니다.
export function createSummaryReportPdf(analysis) {
  validateReportAnalysis(analysis);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 44, size: 'A4', bufferPages: true, info: { Title: 'Paper Lens 논문 분석 보고서' } });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 1500) {
        return reject(new Error('요약 보고서 PDF 생성에 실패했습니다. 생성된 파일이 비정상적으로 작습니다.'));
      }
      console.log(`Generated summary PDF: ${buffer.length} bytes, sections=7, reportId=${analysis.reportId || 'unknown'}`);
      return resolve(buffer);
    });
    doc.on('error', reject);

    registerFont(doc);
    renderReport(doc, analysis);
    addPageNumbers(doc);
    doc.end();
  });
}

function validateReportAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    throw new Error('요약 보고서 PDF를 생성할 분석 데이터가 없습니다. 다시 분석해 주세요.');
  }
  if (!analysis.summary || typeof analysis.summary !== 'object') {
    throw new Error('요약 보고서 PDF를 생성할 summary 데이터가 없습니다. 다시 분석해 주세요.');
  }
  const summary = normalizeSummary(analysis.summary);
  const requiredValues = [summary.title, summary.background, summary.purpose, summary.method, summary.oneParagraphSummary];
  if (requiredValues.every((value) => !value || value === EMPTY_MESSAGE)) {
    throw new Error('요약 보고서 PDF에 포함할 핵심 내용이 없습니다. 다시 분석해 주세요.' );
  }
}

function renderReport(doc, analysis) {
  const summary = normalizeSummary(analysis.summary);

  doc.fillColor('#0f172a').fontSize(24).text('Paper Lens 논문 분석 보고서', { align: 'center' });
  doc.moveDown(0.3);
  doc.fillColor('#64748b').fontSize(10).text('PDF 원문이 아닌 분석 요약 보고서입니다.', { align: 'center' });
  doc.moveDown(1.1);

  renderInfoCard(doc, summary);
  renderSection(doc, '1. 연구 배경', summary.background);
  renderSection(doc, '2. 연구 목적', summary.purpose);
  renderSection(doc, '3. 연구 방법', summary.method);
  renderSection(doc, '4. 주요 결과', summary.results, { bullets: true });
  renderSection(doc, '5. 한계점', summary.limitations);
  renderSection(doc, '6. 핵심 키워드', summary.keywords, { bullets: true });
  renderSection(doc, '7. 한 문단 요약', summary.oneParagraphSummary);
}

function renderInfoCard(doc, summary) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelX = x + 18;
  const valueX = x + 112;
  const labelWidth = 76;
  const valueWidth = width - 134;
  const rows = [
    ['논문 제목', summary.title],
    ['저자', summary.authors.join(', ')],
    ['출판연도', summary.year],
    ['핵심 키워드', summary.keywords.join(', ')]
  ].map(([label, value]) => {
    const text = value || EMPTY_MESSAGE;
    doc.fontSize(9);
    const labelHeight = doc.heightOfString(label, { width: labelWidth });
    doc.fontSize(10);
    const valueHeight = doc.heightOfString(text, { width: valueWidth, lineGap: 2 });
    return { label, text, height: Math.max(18, labelHeight, valueHeight) + 8 };
  });
  const height = 50 + rows.reduce((total, row) => total + row.height, 0);

  ensureSpace(doc, height + 18);
  const startY = doc.y;
  doc.roundedRect(x, startY, width, height, 14).fill('#f8fafc').stroke('#dbe4f0');
  doc.fillColor('#1e3a8a').fontSize(13).text('논문 기본 정보', x + 18, startY + 14);

  let y = startY + 40;
  rows.forEach(({ label, text, height: rowHeight }) => {
    doc.fillColor('#64748b').fontSize(9).text(label, labelX, y, { width: labelWidth });
    doc.fillColor('#111827').fontSize(10).text(text, valueX, y, { width: valueWidth, lineGap: 2 });
    y += rowHeight;
  });
  doc.y = startY + height + 18;
}

function renderSection(doc, title, content, { bullets = false } = {}) {
  const items = bullets ? toBulletItems(content, { maxItems: 6, maxLength: 180 }) : splitIntoParagraphs(content || EMPTY_MESSAGE, { sentencesPerParagraph: 2, maxParagraphs: 4 });
  const estimatedHeight = 44 + items.length * 34;
  ensureSpace(doc, estimatedHeight);

  doc.moveDown(0.3);
  doc.fillColor('#12357c').fontSize(14).text(title, { continued: false });
  doc.moveDown(0.35);

  if (bullets) {
    const bulletItems = items.length ? items : [EMPTY_MESSAGE];
    bulletItems.forEach((item) => renderBullet(doc, item));
  } else {
    items.forEach((paragraph) => {
      doc.fillColor('#1f2937').fontSize(10.5).text(paragraph, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        lineGap: 5,
        paragraphGap: 7
      });
      doc.moveDown(0.25);
    });
  }
  doc.moveDown(0.55);
}

function renderBullet(doc, text) {
  const x = doc.page.margins.left;
  const y = doc.y + 4;
  doc.circle(x + 4, y + 3, 2.2).fill('#2563eb');
  doc.fillColor('#1f2937').fontSize(10.5).text(text, x + 16, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 16,
    lineGap: 4
  });
  doc.moveDown(0.35);
}

function ensureSpace(doc, neededHeight) {
  if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom - 28) {
    doc.addPage();
  }
}

function registerFont(doc) {
  for (const fontPath of FONT_CANDIDATES) {
    if (!fs.existsSync(fontPath)) continue;
    try {
      doc.font(fontPath);
      console.log(`Using PDF report font: ${fontPath}`);
      return;
    } catch (error) {
      console.warn(`Skipping unsupported PDF font ${fontPath}: ${error.message}`);
    }
  }
  console.warn('No Korean report font found. Falling back to PDFKit default font. Add fonts/NotoSansKR-Regular.otf for best Korean output.');
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.fontSize(8.5).fillColor('#94a3b8').text(`Page ${i + 1} / ${range.count}`, 44, doc.page.height - 32, { align: 'center' });
  }
}
