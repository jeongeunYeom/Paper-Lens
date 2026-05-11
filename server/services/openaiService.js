import OpenAI from 'openai';

const SUMMARY_SCHEMA = {
  name: 'paper_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      authors: { type: 'array', items: { type: 'string' } },
      publicationYear: { type: 'string' },
      abstract: { type: 'string' },
      background: { type: 'string' },
      purpose: { type: 'string' },
      methods: { type: 'string' },
      keyFindings: { type: 'string' },
      limitations: { type: 'string' },
      keywords: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string' } },
      oneParagraphSummary: { type: 'string' }
    },
    required: [
      'title',
      'authors',
      'publicationYear',
      'abstract',
      'background',
      'purpose',
      'methods',
      'keyFindings',
      'limitations',
      'keywords',
      'oneParagraphSummary'
    ]
  }
};

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// 논문 원문 일부를 구조화된 JSON 요약으로 변환합니다. API 키는 서버 환경변수에서만 읽습니다.
export async function summarizePaper(text, pdfMetadata = {}) {
  if (!client) {
    const error = new Error('OPENAI_API_KEY가 설정되어 있지 않습니다. .env 파일을 확인해 주세요.');
    error.status = 500;
    throw error;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
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
          '핵심 키워드는 반드시 5개만 반환하세요.'
        ].join('\n')
      },
      {
        role: 'user',
        content: `PDF 메타데이터: ${JSON.stringify(pdfMetadata)}\n\n논문 텍스트:\n${truncatedText}`
      }
    ]
  });

  return JSON.parse(completion.choices[0].message.content);
}
