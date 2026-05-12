import React from 'react';
const STATUS_TEXT = {
  uploading: 'PDF 업로드 및 분석 요청을 준비하고 있습니다.',
  extracting: '텍스트 추출, AI 요약, 유사 논문 검색을 진행하고 있습니다.',
  error: '분석을 완료하지 못했습니다.'
};

export default function LoadingStatus({ status }) {
  return (
    <section className="status-card" aria-live="polite">
      <div className="spinner" />
      <div>
        <strong>분석 진행 상태</strong>
        <p>{STATUS_TEXT[status] || '처리 중입니다.'}</p>
      </div>
    </section>
  );
}
