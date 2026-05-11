import React from 'react';
export default function ResultView({ analysis, apiBaseUrl, onReset }) {
  const { summary, recommendations } = analysis;
  const downloadUrl = `${apiBaseUrl}/reports/${analysis.reportId}.pdf`;

  return (
    <section className="results">
      <div className="result-header">
        <div>
          <p className="eyebrow">분석 완료</p>
          <h2>{summary.title}</h2>
          <p className="muted">파일: {analysis.fileName} · {analysis.pageCount}쪽</p>
        </div>
        <div className="actions">
          <a className="primary-button" href={downloadUrl}>요약 PDF 다운로드</a>
          <button type="button" className="secondary-button" onClick={onReset}>새 PDF 분석</button>
        </div>
      </div>

      <Card title="논문 기본 정보">
        <dl className="info-list">
          <div><dt>제목</dt><dd>{summary.title || '확인할 수 없음'}</dd></div>
          <div><dt>저자</dt><dd>{summary.authors?.join(', ') || '확인할 수 없음'}</dd></div>
          <div><dt>출판연도</dt><dd>{summary.publicationYear || '확인할 수 없음'}</dd></div>
        </dl>
      </Card>
      <Card title="연구 배경">{summary.background}</Card>
      <Card title="연구 목적">{summary.purpose}</Card>
      <Card title="연구 방법">{summary.methods}</Card>
      <Card title="주요 결과">{summary.keyFindings}</Card>
      <Card title="한계점">{summary.limitations}</Card>
      <Card title="핵심 키워드">
        <div className="keyword-list">{summary.keywords?.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
      </Card>
      <Card title="한 문단 요약">{summary.oneParagraphSummary}</Card>
      <Card title="유사 논문 추천">
        {recommendations.length === 0 ? (
          <p className="muted">추천 논문을 찾지 못했습니다.</p>
        ) : (
          <div className="recommendation-list">
            {recommendations.map((paper) => (
              <article key={`${paper.title}-${paper.year}`} className="recommendation">
                <h4>{paper.title}</h4>
                <p>{paper.authors?.join(', ') || '저자 정보 없음'} · {paper.year}</p>
                {paper.doi ? <p>DOI: {paper.doi}</p> : paper.link && <p><a href={paper.link} target="_blank" rel="noreferrer">논문 링크</a></p>}
                <p className="reason">추천 이유: {paper.reason}</p>
              </article>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function Card({ title, children }) {
  return (
    <article className="result-card">
      <h3>[{title}]</h3>
      <div>{children}</div>
    </article>
  );
}
