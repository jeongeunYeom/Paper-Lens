import React from 'react';
import { useRef, useState } from 'react';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function FileUpload({ onAnalyze, disabled }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState('');

  function validateAndSubmit(file) {
    setMessage('');
    if (!file) return;
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      setMessage('PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setMessage('PDF 파일 크기는 20MB 이하만 업로드할 수 있습니다.');
      return;
    }
    onAnalyze(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    validateAndSubmit(event.dataTransfer.files?.[0]);
  }

  return (
    <section
      className={`upload-card ${dragActive ? 'is-active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <div className="upload-icon">PDF</div>
      <h2>논문 PDF를 업로드하세요</h2>
      <p>드래그앤드롭하거나 버튼을 눌러 파일을 선택할 수 있습니다. OCR이 필요한 스캔 PDF는 첫 버전에서 지원하지 않습니다.</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => validateAndSubmit(event.target.files?.[0])}
      />
      <button type="button" className="primary-button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        PDF 파일 선택
      </button>
      {message && <p className="inline-error" role="alert">{message}</p>}
    </section>
  );
}
