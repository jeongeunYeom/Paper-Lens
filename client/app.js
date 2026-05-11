const API_BASE_URL = window.PAPER_LENS_API_BASE_URL || '/api';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const uploadCard = document.querySelector('#upload-card');
const fileInput = document.querySelector('#file-input');
const selectFileButton = document.querySelector('#select-file-button');
const uploadMessage = document.querySelector('#upload-message');
const statusCard = document.querySelector('#status-card');
const statusMessage = document.querySelector('#status-message');
const errorBanner = document.querySelector('#error-banner');
const results = document.querySelector('#results');
const resultsTemplate = document.querySelector('#results-template');

selectFileButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => validateAndAnalyze(fileInput.files?.[0]));

uploadCard.addEventListener('dragover', (event) => {
  event.preventDefault();
  uploadCard.classList.add('is-active');
});

uploadCard.addEventListener('dragleave', () => uploadCard.classList.remove('is-active'));

uploadCard.addEventListener('drop', (event) => {
  event.preventDefault();
  uploadCard.classList.remove('is-active');
  validateAndAnalyze(event.dataTransfer.files?.[0]);
});

function validateAndAnalyze(file) {
  clearMessages();
  if (!file) return;

  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
    showUploadMessage('PDF 파일만 업로드할 수 있습니다.');
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showUploadMessage('PDF 파일 크기는 20MB 이하만 업로드할 수 있습니다.');
    return;
  }

  analyzePaper(file);
}

async function analyzePaper(file) {
  const formData = new FormData();
  formData.append('paper', file);
  setBusy(true, 'PDF 업로드 및 분석 요청을 준비하고 있습니다.');

  try {
    statusMessage.textContent = '텍스트 추출, AI 요약, 유사 논문 검색을 진행하고 있습니다.';
    const response = await fetch(`${API_BASE_URL}/analyze`, { method: 'POST', body: formData });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || '논문 분석 중 오류가 발생했습니다.');
    }

    renderResults(payload);
  } catch (error) {
    showError(error.message);
    uploadCard.hidden = false;
  } finally {
    setBusy(false);
    fileInput.value = '';
  }
}

function renderResults(analysis) {
  const summary = analysis.summary || {};
  results.replaceChildren();

  const header = resultsTemplate.content.cloneNode(true);
  header.querySelector('[data-field="title"]').textContent = summary.title || '확인할 수 없음';
  header.querySelector('[data-field="fileMeta"]').textContent = `파일: ${analysis.fileName} · ${analysis.pageCount || 0}쪽`;
  header.querySelector('[data-field="downloadLink"]').href = `${API_BASE_URL}/reports/${analysis.reportId}.pdf`;
  header.querySelector('[data-field="resetButton"]').addEventListener('click', resetApp);
  results.append(header);

  results.append(
    createCard('논문 기본 정보', createInfoList([
      ['제목', summary.title || '확인할 수 없음'],
      ['저자', summary.authors?.join(', ') || '확인할 수 없음'],
      ['출판연도', summary.publicationYear || '확인할 수 없음']
    ])),
    createTextCard('연구 배경', summary.background),
    createTextCard('연구 목적', summary.purpose),
    createTextCard('연구 방법', summary.methods),
    createTextCard('주요 결과', summary.keyFindings),
    createTextCard('한계점', summary.limitations),
    createCard('핵심 키워드', createKeywordList(summary.keywords || [])),
    createTextCard('한 문단 요약', summary.oneParagraphSummary),
    createCard('유사 논문 추천', createRecommendationList(analysis.recommendations || []))
  );

  uploadCard.hidden = true;
  results.hidden = false;
}

function createTextCard(title, text) {
  const paragraph = document.createElement('p');
  paragraph.textContent = text || '확인할 수 없음';
  return createCard(title, paragraph);
}

function createCard(title, content) {
  const card = document.createElement('article');
  card.className = 'result-card';

  const heading = document.createElement('h3');
  heading.textContent = `[${title}]`;
  card.append(heading, content);
  return card;
}

function createInfoList(items) {
  const list = document.createElement('dl');
  list.className = 'info-list';

  for (const [label, value] of items) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    list.append(row);
  }

  return list;
}

function createKeywordList(keywords) {
  const list = document.createElement('div');
  list.className = 'keyword-list';

  if (!keywords.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '핵심 키워드를 찾지 못했습니다.';
    return empty;
  }

  for (const keyword of keywords) {
    const badge = document.createElement('span');
    badge.textContent = keyword;
    list.append(badge);
  }

  return list;
}

function createRecommendationList(recommendations) {
  if (!recommendations.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '추천 논문을 찾지 못했습니다.';
    return empty;
  }

  const list = document.createElement('div');
  list.className = 'recommendation-list';

  for (const paper of recommendations) {
    const article = document.createElement('article');
    article.className = 'recommendation';

    const title = document.createElement('h4');
    title.textContent = paper.title || '제목 없음';

    const meta = document.createElement('p');
    meta.textContent = `${paper.authors?.join(', ') || '저자 정보 없음'} · ${paper.year || '연도 정보 없음'}`;

    const linkInfo = document.createElement('p');
    if (paper.doi) {
      linkInfo.textContent = `DOI: ${paper.doi}`;
    } else if (paper.link) {
      const link = document.createElement('a');
      link.href = paper.link;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = '논문 링크';
      linkInfo.append(link);
    } else {
      linkInfo.textContent = 'DOI 또는 링크 정보 없음';
    }

    const reason = document.createElement('p');
    reason.className = 'reason';
    reason.textContent = `추천 이유: ${paper.reason || '검색 결과 기반 추천입니다.'}`;

    article.append(title, meta, linkInfo, reason);
    list.append(article);
  }

  return list;
}

function setBusy(isBusy, message = '') {
  selectFileButton.disabled = isBusy;
  statusCard.hidden = !isBusy;
  if (message) statusMessage.textContent = message;
}

function showUploadMessage(message) {
  uploadMessage.textContent = message;
  uploadMessage.hidden = false;
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearMessages() {
  uploadMessage.hidden = true;
  uploadMessage.textContent = '';
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

function resetApp() {
  clearMessages();
  results.hidden = true;
  results.replaceChildren();
  uploadCard.hidden = false;
}
