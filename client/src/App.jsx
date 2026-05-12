import React from 'react';
import { useState } from 'react';
import FileUpload from './components/FileUpload.jsx';
import LoadingStatus from './components/LoadingStatus.jsx';
import ResultView from './components/ResultView.jsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

export default function App() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);

  async function handleAnalyze(file) {
    setError('');
    setAnalysis(null);
    setStatus('uploading');

    const formData = new FormData();
    formData.append('paper', file);

    try {
      setStatus('extracting');
      const response = await fetch(`${API_BASE_URL}/analyze`, { method: 'POST', body: formData });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || '논문 분석 중 오류가 발생했습니다.');
      }

      setStatus('done');
      setAnalysis(payload);
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }

  function reset() {
    setStatus('idle');
    setError('');
    setAnalysis(null);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Paper Lens</p>
        <h1>PDF 논문 요약 및 유사 논문 추천</h1>
        <p className="hero-copy">PDF를 업로드하면 텍스트 추출, AI 요약, 실제 논문 검색 결과 기반 추천, 요약 PDF 다운로드까지 한 번에 처리합니다.</p>
      </section>

      {!analysis && <FileUpload onAnalyze={handleAnalyze} disabled={status !== 'idle' && status !== 'error'} />}
      {status !== 'idle' && status !== 'done' && <LoadingStatus status={status} />}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {analysis && <ResultView analysis={analysis} apiBaseUrl={API_BASE_URL} onReset={reset} />}
    </main>
  );
}
