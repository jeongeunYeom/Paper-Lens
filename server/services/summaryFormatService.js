const EMPTY_MESSAGE = '해당 내용을 명확히 찾지 못했습니다.';

export function normalizeSummary(summary = {}) {
  const results = toBulletItems(summary.results || summary.keyFindings || summary.findings, { maxItems: 5, maxLength: 180 });
  const keywords = normalizeKeywords(summary.keywords);
  const normalized = {
    title: cleanText(summary.title) || '제목 확인 필요',
    authors: normalizeAuthors(summary.authors),
    year: cleanText(summary.year || summary.publicationYear) || '확인할 수 없음',
    background: summarizeText(summary.background, { maxSentences: 4, maxLength: 700 }),
    purpose: summarizeText(summary.purpose, { maxSentences: 3, maxLength: 520 }),
    method: summarizeText(summary.method || summary.methods, { maxSentences: 4, maxLength: 700 }),
    results: results.length ? results : [EMPTY_MESSAGE],
    limitations: summarizeText(summary.limitations, { maxSentences: 3, maxLength: 520 }),
    keywords,
    oneParagraphSummary: summarizeText(summary.oneParagraphSummary || summary.koreanSummary || summary.summary || summary.abstract, { maxSentences: 4, maxLength: 760 }),
    koreanSummary: summarizeText(summary.koreanSummary || summary.oneParagraphSummary || summary.summary || summary.abstract, { maxSentences: 4, maxLength: 760 }),
    englishSummary: summarizeText(summary.englishSummary, { maxSentences: 4, maxLength: 760 }),
    sourceLanguage: normalizeLanguage(summary.sourceLanguage),
    abstract: summarizeText(summary.abstract, { maxSentences: 5, maxLength: 900 })
  };

  return {
    ...normalized,
    publicationYear: normalized.year,
    methods: normalized.method,
    keyFindings: normalized.results
  };
}

export function cleanText(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(' ');
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

export function splitIntoSentences(value) {
  const text = cleanText(value);
  if (!text) return [];
  return text
    .replace(/([.!?。])\s*(?=[A-Z가-힣0-9])/g, '$1|')
    .split('|')
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

export function splitIntoParagraphs(value, { sentencesPerParagraph = 3, maxParagraphs = 4 } = {}) {
  const sentences = splitIntoSentences(value);
  if (!sentences.length) return [EMPTY_MESSAGE];

  const paragraphs = [];
  for (let index = 0; index < sentences.length && paragraphs.length < maxParagraphs; index += sentencesPerParagraph) {
    paragraphs.push(sentences.slice(index, index + sentencesPerParagraph).join(' '));
  }
  return paragraphs;
}

export function toBulletItems(value, { maxItems = 5, maxLength = 180 } = {}) {
  const rawItems = Array.isArray(value)
    ? value
    : cleanText(value)
      .split(/\s*[•·]\s*|\s*\n\s*|(?<=[.!?。])\s+(?=[A-Z가-힣0-9])/)
      .filter(Boolean);

  return rawItems
    .map((item) => trimToLength(cleanText(item).replace(/^[-*]\s*/, ''), maxLength))
    .filter((item) => item && item !== EMPTY_MESSAGE)
    .filter((item, index, array) => array.indexOf(item) === index)
    .slice(0, maxItems);
}

export function summarizeText(value, { maxSentences = 4, maxLength = 700 } = {}) {
  const sentences = splitIntoSentences(value);
  const summarized = sentences.length ? sentences.slice(0, maxSentences).join(' ') : cleanText(value);
  return trimToLength(summarized || EMPTY_MESSAGE, maxLength);
}

export function trimToLength(value, maxLength) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeAuthors(authors) {
  if (Array.isArray(authors)) {
    const cleaned = authors.map(cleanText).filter(Boolean).slice(0, 8);
    return cleaned.length ? cleaned : ['확인할 수 없음'];
  }
  const cleaned = cleanText(authors)
    .split(/,|;| and /i)
    .map((author) => author.trim())
    .filter(Boolean)
    .slice(0, 8);
  return cleaned.length ? cleaned : ['확인할 수 없음'];
}

function normalizeKeywords(keywords) {
  const cleaned = (Array.isArray(keywords) ? keywords : cleanText(keywords).split(/,|;|\s*[•·]\s*/))
    .map(cleanText)
    .filter(Boolean)
    .filter((keyword, index, array) => array.indexOf(keyword) === index)
    .slice(0, 5);
  return cleaned.length ? cleaned : ['PDF 분석', '논문 요약', '연구 방법', '주요 결과', '한계점'];
}

function normalizeLanguage(language) {
  const value = cleanText(language).toLowerCase();
  return ['en', 'ko', 'unknown'].includes(value) ? value : 'unknown';
}
