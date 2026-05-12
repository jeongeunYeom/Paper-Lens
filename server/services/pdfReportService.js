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
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-400-normal.woff2'),
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
].filter(Boolean);

// 화면에 표시된 요약 결과만 PDF 보고서로 생성합니다. 원문 PDF는 포함하지 않습니다.
export function createSummaryReportPdf(analysis) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 44, size: 'A4', bufferPages: true, info: { Title: 'Paper Lens 논문 분석 보고서' } });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    registerFont(doc);
    renderReport(doc, analysis);
    addPageNumbers(doc);
    doc.end();
  });
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
  renderSection(doc, '6. 한 문단 요약', summary.oneParagraphSummary);
  renderRecommendations(doc, analysis.recommendations || []);
}

function renderInfoCard(doc, summary) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startY = doc.y;
  const rows = [
    ['논문 제목', summary.title],
    ['저자', summary.authors.join(', ')],
    ['출판연도', summary.year],
    ['핵심 키워드', summary.keywords.join(', ')]
  ];
  const height = 112;

  ensureSpace(doc, height + 18);
  doc.roundedRect(x, startY, width, height, 14).fill('#f8fafc').stroke('#dbe4f0');
  doc.fillColor('#1e3a8a').fontSize(13).text('논문 기본 정보', x + 18, startY + 14);

  let y = startY + 36;
  rows.forEach(([label, value]) => {
    doc.fillColor('#64748b').fontSize(9).text(label, x + 18, y, { width: 70 });
    doc.fillColor('#111827').fontSize(10).text(value || EMPTY_MESSAGE, x + 92, y, { width: width - 112, lineGap: 2 });
    y += 18;
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

function renderRecommendations(doc, recommendations = []) {
  renderSectionTitle(doc, '7. 유사 논문 추천');
  if (!recommendations.length) {
    doc.fillColor('#64748b').fontSize(10.5).text('추천 논문을 찾지 못했습니다.', { lineGap: 5 });
    return;
  }

  recommendations.forEach((paper, index) => {
    ensureSpace(doc, 90);
    const authors = paper.authors?.length ? paper.authors.join(', ') : '저자 정보 없음';
    const link = paper.doi ? `DOI: ${paper.doi}` : `링크: ${paper.link || '정보 없음'}`;
    doc.fillColor('#0f172a').fontSize(11.5).text(`${index + 1}. ${paper.title || '제목 없음'}`, { lineGap: 3 });
    doc.fillColor('#475569').fontSize(9.5).text(`저자: ${authors}`);
    doc.text(`연도: ${paper.year || '연도 정보 없음'} · ${link}`);
    doc.fillColor('#1f2937').fontSize(10).text(`추천 이유: ${paper.reason || '검색 결과 기반 추천입니다.'}`, { lineGap: 4 });
    doc.moveDown(0.7);
  });
}

function renderSectionTitle(doc, title) {
  ensureSpace(doc, 64);
  doc.moveDown(0.3);
  doc.fillColor('#12357c').fontSize(14).text(title);
  doc.moveDown(0.45);
}

function ensureSpace(doc, neededHeight) {
  if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom - 28) {
    doc.addPage();
  }
}

function registerFont(doc) {
  const fontPath = FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (fontPath) {
    doc.font(fontPath);
    return;
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
