const SEMANTIC_SCHOLAR_ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/search';

// 실제 검색 API 결과만 반환합니다. 결과가 없거나 실패하면 빈 배열을 반환하여 임의 추천을 방지합니다.
export async function searchSimilarPapers(summary) {
  const query = buildSearchQuery(summary);
  if (!query) return [];

  try {
    const url = new URL(SEMANTIC_SCHOLAR_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('fields', 'title,authors,year,url,externalIds,abstract');

    const headers = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.warn(`Semantic Scholar search failed: ${response.status}`);
      return [];
    }

    const payload = await response.json();
    return (payload.data || []).slice(0, 5).map((paper) => ({
      title: paper.title || '제목 없음',
      authors: (paper.authors || []).map((author) => author.name).filter(Boolean).slice(0, 6),
      year: paper.year || '연도 정보 없음',
      doi: paper.externalIds?.DOI || '',
      link: paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : ''),
      reason: makeRecommendationReason(summary, paper)
    }));
  } catch (error) {
    console.warn('Semantic Scholar search error:', error.message);
    return [];
  }
}

function buildSearchQuery(summary) {
  const abstractTerms = summary?.abstract ? summary.abstract.split(/\s+/).slice(0, 25).join(' ') : '';
  const parts = [summary?.title, abstractTerms, ...(summary?.keywords || [])].filter(Boolean);
  return parts.join(' ').slice(0, 300);
}

function makeRecommendationReason(summary, paper) {
  const keywords = summary?.keywords?.filter((keyword) => paper.title?.toLowerCase().includes(keyword.toLowerCase()));
  if (keywords?.length) {
    return `업로드한 논문의 핵심 키워드(${keywords.slice(0, 2).join(', ')})와 제목이 겹치는 검색 결과입니다.`;
  }
  return '추출된 제목과 핵심 키워드를 기반으로 Semantic Scholar에서 검색된 관련 논문입니다.';
}
