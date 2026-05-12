import fs from 'node:fs/promises';
import pdf from 'pdf-parse/lib/pdf-parse.js';

const MIN_EXTRACTED_TEXT_LENGTH = 300;

// 업로드된 PDF에서 분석 가능한 텍스트를 추출합니다. OCR은 MVP 범위에서 제외합니다.
export async function extractTextFromPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const data = await pdf(buffer);
  const text = normalizeWhitespace(data.text || '');

  if (text.length < MIN_EXTRACTED_TEXT_LENGTH) {
    const error = new Error('텍스트를 추출할 수 없습니다. OCR 기능이 필요합니다.');
    error.status = 422;
    throw error;
  }

  return {
    text,
    pageCount: data.numpages || 0,
    info: data.info || {}
  };
}

function normalizeWhitespace(text) {
  return text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
