// 기본 단가는 예시/초기값입니다. 사용 중인 모델 가격에 맞게 수정 필요합니다.
export const TOKEN_PRICES_PER_1M = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 }
};

export function buildAssumedOpenAiUsage({ source, inputText = '', outputText = '', model = 'gpt-4o-mini', error = null } = {}) {
  const promptTokens = estimateTokens(inputText);
  const completionTokens = Math.max(estimateTokens(outputText), 1);
  const totalTokens = promptTokens + completionTokens;
  const prices = getTokenPrices(model);
  const estimatedCostUsd = calculateEstimatedCost({ promptTokens, completionTokens, prices });

  return {
    source,
    usedOpenAi: false,
    assumedOpenAi: true,
    summaryMethod: 'OpenAI API 요약(예상)',
    actualSummaryMethod: source === 'mock' ? '테스트 모드' : '규칙 기반 요약',
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens: 0,
    inputPricePerMillion: prices.input,
    outputPricePerMillion: prices.output,
    estimatedCostUsd,
    currency: 'USD',
    note: error
      ? `실제 OpenAI 호출은 실패했지만(${error.message}) 같은 입력을 OpenAI API로 처리한다고 가정해 추정했습니다.`
      : '실제 OpenAI API를 호출하지 않았지만, 동일 입력을 OpenAI API로 처리한다고 가정해 토큰과 비용을 추정했습니다.'
  };
}

export function estimateTokens(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  const asciiChars = (normalized.match(/[\x00-\x7F]/g) || []).length;
  const nonAsciiChars = normalized.length - asciiChars;
  const asciiTokens = Math.ceil(asciiChars / 4);
  const nonAsciiTokens = Math.ceil(nonAsciiChars / 2);
  return Math.max(1, asciiTokens + nonAsciiTokens);
}

export function buildTokenUsage(usage = {}, model) {
  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
  const cachedPromptTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0;
  const prices = getTokenPrices(model);
  const estimatedCostUsd = calculateEstimatedCost({ promptTokens, completionTokens, prices });

  return {
    source: 'openai',
    usedOpenAi: true,
    summaryMethod: 'OpenAI API 요약',
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    inputPricePerMillion: prices.input,
    outputPricePerMillion: prices.output,
    estimatedCostUsd,
    currency: 'USD',
    note: '표시 비용은 텍스트 토큰 단가 기준 추정치입니다. 실제 청구액은 OpenAI 대시보드와 과금 정책을 확인하세요.'
  };
}

export function calculateEstimatedCost({ promptTokens = 0, completionTokens = 0, prices }) {
  return Number((((promptTokens * prices.input) + (completionTokens * prices.output)) / 1_000_000).toFixed(8));
}

export function getTokenPrices(model) {
  const inputOverride = Number(process.env.OPENAI_INPUT_PRICE_PER_1M_TOKENS);
  const outputOverride = Number(process.env.OPENAI_OUTPUT_PRICE_PER_1M_TOKENS);
  if (Number.isFinite(inputOverride) && Number.isFinite(outputOverride) && inputOverride >= 0 && outputOverride >= 0) {
    return { input: inputOverride, output: outputOverride };
  }

  return TOKEN_PRICES_PER_1M[model] || TOKEN_PRICES_PER_1M['gpt-4o-mini'];
}
