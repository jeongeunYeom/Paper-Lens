import fs from 'node:fs';
import PDFDocument from 'pdfkit';

const DEFAULT_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

// 화면에 표시된 요약 결과만 PDF 보고서로 생성합니다. 원문 PDF는 포함하지 않습니다.
export function createSummaryReportPdf(analysis) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    registerFont(doc);

    doc.fontSize(22).text('Paper Lens 요약 보고서', { align: 'center' });
    doc.moveDown(1.2);

    const summary = analysis.summary;
    section(doc, '논문 기본 정보', [
      `제목: ${summary.title || '확인할 수 없음'}`,
      `저자: ${(summary.authors || []).join(', ') || '확인할 수 없음'}`,
      `출판연도: ${summary.publicationYear || '확인할 수 없음'}`
    ]);
    section(doc, '연구 배경', summary.background);
    section(doc, '연구 목적', summary.purpose);
    section(doc, '연구 방법', summary.methods);
    section(doc, '주요 결과', summary.keyFindings);
    section(doc, '한계점', summary.limitations);
    section(doc, '핵심 키워드', (summary.keywords || []).join(', '));
    section(doc, '한 문단 요약', summary.oneParagraphSummary);
    section(doc, '유사 논문 추천', formatRecommendations(analysis.recommendations));

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fontSize(9).fillColor('#666').text(`Page ${i + 1} / ${range.count}`, 48, doc.page.height - 40, { align: 'center' });
      doc.fillColor('#111');
    }

    doc.end();
  });
}

function registerFont(doc) {
  const fontPath = process.env.REPORT_FONT_PATH || DEFAULT_FONT;
  if (fontPath && fs.existsSync(fontPath)) {
    doc.font(fontPath);
  }
}

function section(doc, title, content) {
  doc.moveDown(0.8);
  doc.fontSize(15).fillColor('#1f3a8a').text(`[${title}]`);
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#111');
  const lines = Array.isArray(content) ? content : [content || '확인할 수 없음'];
  lines.forEach((line) => doc.text(String(line), { lineGap: 4 }));
}

function formatRecommendations(recommendations = []) {
  if (!recommendations.length) return '추천 논문을 찾지 못했습니다.';
  return recommendations.map((paper, index) => {
    const authors = paper.authors?.length ? paper.authors.join(', ') : '저자 정보 없음';
    const link = paper.doi ? `DOI: ${paper.doi}` : `링크: ${paper.link || '정보 없음'}`;
    return `${index + 1}. ${paper.title}\n   저자: ${authors}\n   연도: ${paper.year}\n   ${link}\n   추천 이유: ${paper.reason}`;
  });
}
