import OpenAI from 'openai';
import { cleanText, normalizeSummary, summarizeText, toBulletItems } from './summaryFormatService.js';
import { buildAssumedOpenAiUsage, buildTokenUsage } from './tokenUsageService.js';

const SUMMARY_SCHEMA = {
  name: 'paper_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      authors: { type: 'array', items: { type: 'string' } },
      year: { type: 'string' },
      abstract: { type: 'string' },
      background: { type: 'string' },
      purpose: { type: 'string' },
      method: { type: 'string' },
      results: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'string' },
      keywords: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string' } },
      oneParagraphSummary: { type: 'string' },
      englishSummary: { type: 'string' },
      koreanSummary: { type: 'string' },
      sourceLanguage: { type: 'string', enum: ['en', 'ko', 'unknown'] }
    },
    required: [
      'title',
      'authors',
      'year',
      'abstract',
      'background',
      'purpose',
      'method',
      'results',
      'limitations',
      'keywords',
      'oneParagraphSummary',
      'englishSummary',
      'koreanSummary',
      'sourceLanguage'
    ]
  }
};

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const isMockSummaryEnabled = isEnabled(process.env.USE_MOCK_SUMMARY);
const isRuleBasedFallbackEnabled = isEnabled(process.env.ALLOW_RULE_BASED_FALLBACK);
const FALLBACK_MESSAGE = 'OpenAI API 없이 규칙 기반으로 추출한 요약입니다. 실제 AI 요약보다 정확도가 낮을 수 있습니다.';
const TRANSLATION_CHUNK_SIZE = Number(process.env.TRANSLATION_CHUNK_SIZE || 6000);
const MAX_TRANSLATION_INPUT_CHARS = Number(process.env.MAX_TRANSLATION_INPUT_CHARS || 30000);
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'have', 'has', 'had', 'not', 'but',
  'paper', 'study', 'research', 'using', 'based', 'between', 'these', 'those', 'their', 'which', 'into', 'than',
  '논문', '연구', '결과', '방법', '분석', '대한', '통해', '위한', '있다', '있는', '한다', '에서', '으로', '그리고'
]);
// 기본 동작은 실제 OpenAI API 요약입니다. mock/fallback은 명시적으로 켠 경우에만 사용합니다.
export async function summarizePaper(text, pdfMetadata = {}) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (isMockSummaryEnabled) {
    const summary = normalizeSummary(createMockSummary(text, pdfMetadata));
    return attachAssumedUsage(summary, { source: 'mock', text, pdfMetadata, model });
  }

  if (!client) {
    if (isRuleBasedFallbackEnabled) {
      const summary = normalizeSummary(createRuleBasedSummary(text, pdfMetadata, 'OPENAI_API_KEY가 없어 규칙 기반 요약을 사용했습니다.'));
      return attachAssumedUsage(summary, { source: 'rule-based', text, pdfMetadata, model });
    }

    throw createOpenAiError('OPENAI_API_KEY가 설정되어 있지 않습니다. OpenAI API 크레딧을 사용하려면 서버 환경변수에 유효한 API 키를 설정해 주세요.', 503);
  }

  try {
    const truncatedText = text.slice(0, 70000);

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: SUMMARY_SCHEMA },
      messages: [
        {
          role: 'system',
          content: [
            '당신은 학술 논문 분석 도우미입니다.',
            '제공된 PDF 텍스트에 근거해서만 한국어 요약 보고서를 작성하세요.',
            '알 수 없는 항목은 추측하지 말고 "확인할 수 없음"이라고 쓰세요.',
            '핵심 키워드는 반드시 5개만 반환하세요.',
            'results는 원문 복사가 아니라 3~5개의 짧은 한국어 bullet 문장 배열로 반환하세요.',
            'koreanSummary는 한국어 한 문단 요약, englishSummary는 영어 한 문단 요약으로 작성하세요.',
            'sourceLanguage는 원문 주요 언어가 영어면 en, 한국어면 ko, 판단이 어려우면 unknown으로 반환하세요.'
          ].join('\n')
        },
        {
          role: 'user',
          content: `PDF 메타데이터: ${JSON.stringify(pdfMetadata)}\n\n논문 텍스트:\n${truncatedText}`
        }
      ]
    });

    return attachTokenUsage(normalizeSummary(JSON.parse(completion.choices[0].message.content)), buildTokenUsage(completion.usage, model));
  } catch (error) {
    if (isRuleBasedFallbackEnabled) {
      console.warn('OpenAI summarization failed; falling back to rule-based summary:', error.message);
      const summary = normalizeSummary(createRuleBasedSummary(text, pdfMetadata, `OpenAI API 호출 실패(${error.status || error.code || 'unknown'})로 규칙 기반 요약을 사용했습니다.`));
      return attachAssumedUsage(summary, { source: 'fallback', text, pdfMetadata, model, error });
    }

    console.error('OpenAI summarization failed:', error.message);
    throw createOpenAiError(`OpenAI API 요약에 실패했습니다: ${getOpenAiErrorMessage(error)}`, getOpenAiErrorStatus(error));
  }
}

export function detectPaperLanguage(text = '') {
  const sample = cleanText(text).slice(0, 12000);
  const koreanMatches = sample.match(/[가-힣]/g) || [];
  const englishMatches = sample.match(/[A-Za-z]/g) || [];
  if (englishMatches.length > koreanMatches.length * 3 && englishMatches.length > 300) return 'en';
  if (koreanMatches.length > englishMatches.length * 0.15 && koreanMatches.length > 120) return 'ko';
  return 'unknown';
}

export async function translatePaperToKorean(text, pdfMetadata = {}) {
  const sourceLanguage = detectPaperLanguage(text);
  if (sourceLanguage !== 'en') {
    return {
      sourceLanguage,
      targetLanguage: 'ko',
      status: 'not_needed',
      title: '한국어 번역본',
      body: '',
      note: '원문이 영문 논문이 아닌 것으로 판단되어 전체 번역본은 생성하지 않았습니다.'
    };
  }

  const sourceText = stripReferences(text).slice(0, MAX_TRANSLATION_INPUT_CHARS);
  if (isMockSummaryEnabled) {
    return {
      sourceLanguage,
      targetLanguage: 'ko',
      status: 'translated',
      title: `${pdfMetadata.Title || '영문 논문'} 한국어 번역본`,
      body: `[테스트 모드 번역] ${summarizeText(sourceText, { maxSentences: 10, maxLength: 1800 })}`,
      note: '테스트 모드에서는 OpenAI API를 호출하지 않아 축약된 번역 예시만 생성합니다.'
    };
  }

  if (!client) {
    throw createOpenAiError('영문 논문 전체 번역에는 OPENAI_API_KEY가 필요합니다.', 503);
  }

  try {
    const chunks = chunkText(sourceText, TRANSLATION_CHUNK_SIZE);
    const translatedChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const completion = await client.chat.completions.create({
        model: process.env.OPENAI_TRANSLATION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: [
              '당신은 학술 논문 전문 번역가입니다.',
              '영문 논문 본문을 자연스러운 한국어 학술 문체로 충실히 번역하세요.',
              '수식, 변수명, 단위, 표/그림 캡션 표기는 가능한 한 보존하세요.',
              '참고문헌 목록은 번역하지 않습니다.',
              '설명이나 요약을 덧붙이지 말고 번역문만 반환하세요.'
            ].join('\n')
          },
          { role: 'user', content: `번역할 본문 조각 ${index + 1}/${chunks.length}:\n\n${chunks[index]}` }
        ]
      });
      translatedChunks.push(cleanText(completion.choices[0]?.message?.content || ''));
    }

    return {
      sourceLanguage,
      targetLanguage: 'ko',
      status: 'translated',
      title: `${pdfMetadata.Title || '영문 논문'} 한국어 번역본`,
      body: translatedChunks.filter(Boolean).join('\n\n'),
      note: '참고문헌 섹션은 제외했습니다. 현재 서버는 PDF 텍스트 추출 기반이므로 원본 figure 이미지를 동일하게 복제하지는 못하고, 텍스트와 캡션 번역을 중심으로 생성합니다.'
    };
  } catch (error) {
    console.error('OpenAI translation failed:', error.message);
    throw createOpenAiError(`OpenAI 번역에 실패했습니다: ${getOpenAiErrorMessage(error)}`, getOpenAiErrorStatus(error));
  }
}

function stripReferences(text = '') {
  const normalized = String(text || '');
  const match = normalized.match(/(?:^|\n)\s*(references|bibliography|works cited|참고문헌)\s*\n/i);
  return match?.index ? normalized.slice(0, match.index).trim() : normalized.trim();
}

function chunkText(text, size) {
  const chunks = [];
  const paragraphs = String(text || '').split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  let current = '';
  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > size && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length && text) {
    for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function isEnabled(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function createOpenAiError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getOpenAiErrorStatus(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return error.status;
  }
  return 502;
}

function getOpenAiErrorMessage(error) {
  if (error?.status === 401) return 'API 키가 올바르지 않거나 권한이 없습니다.';
  if (error?.status === 429) return '요청 한도 또는 결제/크레딧 상태를 확인해 주세요.';
  return error?.message || '알 수 없는 오류';
}

function attachTokenUsage(summary, tokenUsage) {
  return { ...summary, _tokenUsage: tokenUsage };
}


function buildPromptText(text, pdfMetadata = {}) {
  return [
    '당신은 학술 논문 분석 도우미입니다.',
    '제공된 PDF 텍스트에 근거해서만 한국어 요약 보고서를 작성하세요.',
    '알 수 없는 항목은 추측하지 말고 "확인할 수 없음"이라고 쓰세요.',
    '핵심 키워드는 반드시 5개만 반환하세요.',
    'results는 원문 복사가 아니라 3~5개의 짧은 한국어 bullet 문장 배열로 반환하세요.',
    'koreanSummary는 한국어 한 문단 요약, englishSummary는 영어 한 문단 요약으로 작성하세요.',
    'sourceLanguage는 원문 주요 언어가 영어면 en, 한국어면 ko, 판단이 어려우면 unknown으로 반환하세요.',
    `PDF 메타데이터: ${JSON.stringify(pdfMetadata)}`,
    `논문 텍스트:\n${String(text || '').slice(0, 70000)}`
  ].join('\n');
}

function attachAssumedUsage(summary, { source, text, pdfMetadata, model, error = null }) {
  return attachTokenUsage(summary, buildAssumedOpenAiUsage({
    source,
    inputText: buildPromptText(text, pdfMetadata),
    outputText: JSON.stringify(summary),
    model,
    error
  }));
}

function createRuleBasedSummary(text, pdfMetadata = {}, reason = FALLBACK_MESSAGE) {
  const normalized = normalizeText(text);
  const abstract = extractSection(normalized, ['abstract', '초록', '요약'], ['introduction', '1 introduction', '서론', 'keywords', '키워드']);
  const introduction = extractSection(normalized, ['introduction', '서론', 'background'], ['method', 'methods', 'materials', '방법', 'methodology']);
  const methods = extractSection(normalized, ['method', 'methods', 'materials and methods', 'methodology', '방법'], ['result', 'results', '결과', 'discussion']);
  const results = extractSection(normalized, ['result', 'results', 'findings', '결과'], ['discussion', 'conclusion', '결론', 'limitations']);
  const limitations = extractSection(normalized, ['limitation', 'limitations', '한계', '제한점'], ['conclusion', 'references', 'acknowledg']);
  const conclusion = extractSection(normalized, ['conclusion', 'conclusions', '결론'], ['references', '참고문헌']);
  const keywords = extractKeywords(normalized);

  return {
    title: pdfMetadata.Title || guessTitle(normalized) || '제목 확인 필요',
    authors: parseAuthors(pdfMetadata.Author),
    year: guessPublicationYear(normalized, pdfMetadata),
    abstract: truncate(abstract || normalized, 900),
    background: withFallback(summarizeText(introduction, { maxSentences: 4, maxLength: 650 }), '서론/배경 섹션을 명확히 찾지 못했습니다.'),
    purpose: inferPurpose(abstract || introduction || normalized),
    method: withFallback(summarizeText(methods, { maxSentences: 4, maxLength: 650 }), '방법 섹션을 명확히 찾지 못했습니다.'),
    results: toBulletItems(results || conclusion, { maxItems: 5, maxLength: 170 }),
    limitations: withFallback(summarizeText(limitations, { maxSentences: 3, maxLength: 480 }), '한계점 섹션을 명확히 찾지 못했습니다. 원문에서 limitations 또는 discussion 섹션을 확인해 주세요.'),
    keywords,
    oneParagraphSummary: `${reason} ${summarizeText(abstract || conclusion || normalized, { maxSentences: 4, maxLength: 620 })}`,
    koreanSummary: `${reason} ${summarizeText(abstract || conclusion || normalized, { maxSentences: 4, maxLength: 620 })}`,
    englishSummary: 'Rule-based English summary is unavailable. Please use OpenAI API summarization for a bilingual summary.',
    sourceLanguage: detectPaperLanguage(normalized)
  };
}

function createMockSummary(text, pdfMetadata = {}) {
  const normalized = normalizeText(text);
  const title = pdfMetadata.Title || guessTitle(normalized) || '테스트용 논문 제목';

  return {
    title: `[테스트 모드] ${title}`,
    authors: ['테스트 저자'],
    year: String(pdfMetadata.CreationDate?.match(/\d{4}/)?.[0] || new Date().getFullYear()),
    abstract: normalized.slice(0, 600) || '테스트 모드에서 생성된 초록입니다.',
    background: 'OpenAI API quota 또는 결제 설정 없이 업로드부터 결과 표시까지 확인하기 위한 테스트 모드 요약입니다.',
    purpose: 'PDF 텍스트 추출, 화면 렌더링, 추천 논문 영역, 요약 PDF 다운로드 흐름이 정상 동작하는지 검증합니다.',
    method: '업로드된 PDF에서 추출한 텍스트 일부와 PDF 메타데이터를 이용해 서버 내부에서 고정 형식의 mock 요약을 생성합니다.',
    results: normalized ? [`추출 텍스트가 정상적으로 확인되었습니다: ${normalized.slice(0, 150)}`, '결과 화면과 PDF 다운로드 흐름을 테스트할 수 있습니다.'] : ['추출된 텍스트가 제한적입니다.'],
    limitations: '이 결과는 실제 AI 요약이 아니므로 논문 내용의 정확한 학술적 해석이나 최종 결과로 사용하면 안 됩니다.',
    keywords: ['테스트 모드', 'PDF 분석', '논문 요약', '업로드 검증', '보고서 생성'],
    oneParagraphSummary: '현재 결과는 OpenAI API를 호출하지 않고 생성된 테스트용 요약입니다. 배포와 UI 흐름을 빠르게 검증한 뒤 실제 서비스에서는 USE_MOCK_SUMMARY를 false로 바꾸고 유효한 OPENAI_API_KEY를 설정하세요.',
    koreanSummary: '현재 결과는 OpenAI API를 호출하지 않고 생성된 테스트용 한국어 요약입니다.',
    englishSummary: 'This is a mock English summary generated without calling the OpenAI API.',
    sourceLanguage: detectPaperLanguage(normalized)
  };
}

function normalizeText(text) {
  return cleanText(text);
}

function extractSection(text, startMarkers, endMarkers) {
  const lower = text.toLowerCase();
  const starts = startMarkers.map((marker) => lower.indexOf(marker.toLowerCase())).filter((index) => index >= 0);
  if (!starts.length) return '';

  const start = Math.min(...starts);
  const afterStart = start + 1;
  const ends = endMarkers
    .map((marker) => lower.indexOf(marker.toLowerCase(), afterStart + 80))
    .filter((index) => index > start);
  const end = ends.length ? Math.min(...ends) : Math.min(text.length, start + 1800);
  return truncate(text.slice(start, end), 1200);
}

function extractKeywords(text) {
  const counts = new Map();
  const matches = text.toLowerCase().match(/[a-zA-Z][a-zA-Z-]{3,}|[가-힣]{2,}/g) || [];
  for (const word of matches) {
    const cleaned = word.replace(/^-|-$/g, '');
    if (STOPWORDS.has(cleaned) || cleaned.length < 2) continue;
    counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
  }

  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .filter((word, index, array) => array.findIndex((item) => item.includes(word) || word.includes(item)) === index)
    .slice(0, 5);

  return [...keywords, 'PDF 분석', '논문 요약', '연구 방법', '주요 결과', '한계점'].slice(0, 5);
}

function inferPurpose(text) {
  const sentences = splitSentences(text);
  const purposeSentence = sentences.find((sentence) => /aim|objective|purpose|goal|investigate|propose|목적|목표|제안|분석/.test(sentence.toLowerCase()));
  return summarizeText(purposeSentence || sentences[0] || '연구 목적을 명확히 찾지 못했습니다.', { maxSentences: 2, maxLength: 420 });
}

function splitSentences(text) {
  return text.split(/(?<=[.!?。])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function parseAuthors(authorMetadata) {
  if (!authorMetadata) return ['확인할 수 없음'];
  return String(authorMetadata).split(/,|;| and /i).map((author) => author.trim()).filter(Boolean).slice(0, 8);
}

function guessPublicationYear(text, pdfMetadata) {
  const metadataYear = String(pdfMetadata.CreationDate || pdfMetadata.ModDate || '').match(/\d{4}/)?.[0];
  if (metadataYear) return metadataYear;
  return text.match(/\b(19|20)\d{2}\b/)?.[0] || '확인할 수 없음';
}

function withFallback(value, fallback) {
  return value ? truncate(value, 1000) : fallback;
}

function truncate(text, maxLength) {
  const normalized = normalizeText(String(text || ''));
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function guessTitle(text) {
  return text.split(/[.\n]/).find((line) => line.trim().length >= 8)?.trim().slice(0, 120);
}
