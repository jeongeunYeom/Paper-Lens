# Paper Lens

PDF 논문을 업로드하면 서버에서 텍스트를 추출하고, OpenAI API로 구조화된 요약 보고서를 만든 뒤, Semantic Scholar 검색 결과 기반으로 유사 논문을 추천하는 **HTML/CSS/JavaScript + Express** 웹 MVP입니다. 별도 프론트엔드 빌드 없이 Express가 정적 HTML 화면과 API를 함께 제공합니다.

## 주요 기능

- PDF 전용 업로드: 드래그앤드롭과 버튼 업로드 지원
- 파일 검증: PDF 확장자/MIME 타입, 20MB 이하 제한
- PDF 텍스트 추출: `pdf-parse` 사용, 텍스트가 거의 없는 스캔 PDF는 OCR 필요 안내
- AI 요약: 제목, 저자, 출판연도, 연구 배경/목적/방법/결과/한계점, 키워드 5개, 영문/국문 요약 생성
- 유사 논문 추천: Semantic Scholar API 검색 결과만 표시하며 결과가 없으면 “추천 논문을 찾지 못했습니다.” 표시
- PDF 다운로드: 영문 논문은 참고문헌을 제외한 한국어 번역본과 영문/국문 요약을 포함하고, 국문 논문은 영문/국문 요약을 포함한 보고서를 `pdfkit`으로 생성
- 보안: OpenAI API 키는 Express 서버 환경변수로만 사용하고 브라우저 코드에 포함하지 않음
- 업로드 파일 삭제: 분석 성공/실패와 관계없이 요청 종료 시 서버 업로드 파일 삭제

## 프로젝트 구조

```text
client/
  index.html
  app.js
  styles.css
server/
  index.js
  routes/
    analyze.js
  services/
    pdfService.js
    openaiService.js
    paperSearchService.js
    pdfReportService.js
  uploads/
.env.example
package.json
README.md
```

## 사전 준비

- Node.js 20 이상 권장
- 필수: OpenAI API 키(서버 환경변수 `OPENAI_API_KEY`에 설정)
- 선택: Semantic Scholar API 키
- 선택: 한글 PDF 출력을 더 안정적으로 하려면 Noto Sans KR 같은 TTF 폰트 경로

## 로컬 실행 방법

1. 의존성을 설치합니다.

   ```bash
   npm install
   ```

2. 환경변수 파일을 만듭니다.

   ```bash
   cp .env.example .env
   ```

3. `.env`에 OpenAI API 키를 입력합니다. OpenAI API 크레딧이 있는 계정의 서버 전용 키를 사용하세요.

   ```dotenv
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   ```

4. 웹 서버를 실행합니다.

   ```bash
   npm run dev
   ```

5. 브라우저에서 아래 주소를 엽니다.

   ```text
   http://localhost:4000
   ```

Express 서버가 정적 HTML 화면과 `/api` 엔드포인트를 함께 제공합니다.


## OpenAI 토큰 사용량과 예상 비용

OpenAI API를 사용한 요약은 응답의 `usage` 값을 읽어 입력 토큰, 출력 토큰, 총 토큰을 결과 화면에 표시합니다. 예상 비용은 아래 공식으로 계산합니다.

```text
(prompt_tokens * OPENAI_INPUT_PRICE_PER_1M_TOKENS + completion_tokens * OPENAI_OUTPUT_PRICE_PER_1M_TOKENS) / 1,000,000
```

기본 단가는 `gpt-4o-mini` 기준 입력 `$0.15 / 1M tokens`, 출력 `$0.60 / 1M tokens`이며, 실제 청구액은 OpenAI 대시보드와 최신 가격 정책을 기준으로 확인하세요. 다른 모델을 쓰거나 가격이 바뀌면 Render 환경변수에서 `OPENAI_INPUT_PRICE_PER_1M_TOKENS`, `OPENAI_OUTPUT_PRICE_PER_1M_TOKENS`를 조정하면 됩니다.

## OpenAI API 없이 실행하기

기본 분석 흐름은 실제 OpenAI API 호출을 사용합니다. `OPENAI_API_KEY`가 없거나 API 호출에 실패하면 규칙 기반 요약으로 조용히 대체하지 않고, 화면에 설정/결제 상태를 확인하라는 오류를 표시합니다.

비용 없이 전체 업로드·결과 표시·PDF 다운로드 흐름만 확인해야 한다면 `USE_MOCK_SUMMARY=true`를 사용하세요. OpenAI 장애 시에도 임시로 규칙 기반 요약을 허용해야 하는 운영 환경이라면 아래처럼 명시적으로 fallback을 켤 수 있습니다.

```dotenv
ALLOW_RULE_BASED_FALLBACK=true
```

## OpenAI quota 없이 빠른 테스트

OpenAI API 결제/한도 문제로 바로 테스트가 필요하면 Render 또는 로컬 `.env`에 아래 환경변수를 설정하세요.

```dotenv
USE_MOCK_SUMMARY=true
```

이 모드에서는 PDF 텍스트 추출, 결과 화면 표시, 유사 논문 영역, 요약 PDF 다운로드 흐름을 확인할 수 있지만 실제 AI 요약은 생성하지 않습니다. 실제 서비스로 전환할 때는 `USE_MOCK_SUMMARY=false`로 바꾸고 유효한 `OPENAI_API_KEY`를 설정하세요.

## 보고서 UI/PDF 출력 개선 사항

- 화면 결과 카드는 문장 단위 문단 분리와 bullet 목록을 사용해 보고서처럼 읽기 쉽게 표시합니다.
- 요약 PDF는 `Paper Lens 논문 분석 보고서` 제목, 기본 정보 카드, 1~7번 요약 본문 섹션 순서로 생성됩니다. API 토큰 사용량과 유사 논문 추천 목록은 화면 결과에만 표시하고 PDF 보고서에는 포함하지 않습니다. 다운로드는 현재 화면의 분석 결과를 `POST /api/reports/pdf`로 전달해 생성하므로 서버 재시작이나 캐시 만료로 빈 PDF가 내려오는 문제를 줄였습니다.
- PDF 한글 출력은 `REPORT_FONT_PATH`, `fonts/NotoSansKR-Regular.otf`, `fonts/NotoSansKR-Regular.ttf`, `fonts/Pretendard-Regular.otf`, `@fontsource/noto-sans-kr`, 시스템 Noto/Nanum 폰트 순서로 찾고, 폰트가 없으면 기본 폰트로 fallback합니다.
- OpenAI API 키 누락 또는 호출 실패는 기본적으로 오류로 표시합니다. `ALLOW_RULE_BASED_FALLBACK=true`를 명시한 경우에만 규칙 기반 fallback을 사용합니다.

수정된 주요 파일:

```text
client/app.js
client/styles.css
server/services/openaiService.js
server/services/summaryFormatService.js
server/services/pdfReportService.js
server/services/tokenUsageService.js
fonts/README.md
```

## Render 배포 설정

Render에서는 저장소 루트를 기준으로 Web Service를 만들고 아래 설정을 사용하세요. 이 저장소에는 `render.yaml`도 포함되어 있어 Blueprint로 배포할 수도 있습니다.

```text
Root Directory: 비워두기
Build Command: npm install
Start Command: npm start
Node Version: 20.x
```

서버 시작 오류를 피하려면 Render의 Root Directory를 `server`로 바꾸지 말고 비워두는 것을 권장합니다. `package.json`에는 Node 20 이상 23 미만 엔진 범위를 명시했습니다.

## GitHub Pages 안내

GitHub Pages는 Node.js/Express 서버를 실행하지 않는 정적 호스팅입니다. 이 저장소에는 루트 `index.html`이 있어 Pages에서 README 대신 `client/` 웹 화면으로 이동합니다. Pages 설정은 `Deploy from a branch` 기준으로 `main` 브랜치의 `/(root)` 폴더를 선택해야 하며, 저장소 루트에는 `.nojekyll` 파일을 두어 README가 사이트 첫 화면처럼 처리되지 않게 합니다.

단, PDF 분석·OpenAI 요약·보고서 PDF 생성은 서버 API가 필요합니다. 전체 기능을 쓰려면 로컬에서 `npm run dev`를 실행하거나 Express 서버를 Render, Railway, Fly.io 같은 Node.js 호스팅에 배포한 뒤 `window.PAPER_LENS_API_BASE_URL`을 해당 API 주소로 설정하세요.

## 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `PORT` | 아니오 | Express 서버 포트, 기본값 `4000` |
| `OPENAI_API_KEY` | 예 | OpenAI API 요약에 사용할 서버 전용 API 키 |
| `OPENAI_MODEL` | 아니오 | 요약에 사용할 모델, 기본값 `gpt-4o-mini` |
| `OPENAI_TRANSLATION_MODEL` | 아니오 | 영문 논문 한국어 번역에 사용할 모델, 기본값은 `OPENAI_MODEL` |
| `MAX_TRANSLATION_INPUT_CHARS` | 아니오 | 참고문헌 제외 후 번역에 사용할 최대 원문 글자 수, 기본값 `20000` |
| `TRANSLATION_CHUNK_SIZE` | 아니오 | 번역 API 호출당 원문 조각 크기, 기본값 `3500` |
| `TRANSLATION_RETRY_ATTEMPTS` | 아니오 | 번역 chunk별 재시도 횟수, 기본값 `3` |
| `OPENAI_REQUEST_TIMEOUT_MS` | 아니오 | OpenAI API 요청 타임아웃(ms), 기본값 `180000` |
| `OPENAI_MAX_RETRIES` | 아니오 | OpenAI SDK 자체 재시도 횟수, 기본값 `2` |
| `LAYOUT_TRANSLATION_RENDER_DPI` | 아니오 | Figure 보존 번역 PDF에서 원본 페이지 배경을 렌더링할 DPI, 기본값 `180`; 실패 시 더 낮은 DPI로 자동 재시도 |
| `LAYOUT_TRANSLATION_POPPLER_TIMEOUT_MS` | 아니오 | Poppler(`pdftoppm`/`pdftotext`) 실행 타임아웃(ms), 기본값 `180000` |
| `OPENAI_INPUT_PRICE_PER_1M_TOKENS` | 아니오 | 예상 비용 계산용 입력 토큰 단가(USD/1M) |
| `OPENAI_OUTPUT_PRICE_PER_1M_TOKENS` | 아니오 | 예상 비용 계산용 출력 토큰 단가(USD/1M) |
| `USE_MOCK_SUMMARY` | 아니오 | `true`이면 OpenAI API 호출 없이 테스트용 요약 반환 |
| `ALLOW_RULE_BASED_FALLBACK` | 아니오 | `true`이면 OpenAI API 키 누락/호출 실패 시 규칙 기반 요약으로 대체 |
| `CLIENT_ORIGIN` | 아니오 | 별도 프론트엔드 도메인을 둘 때 CORS 허용 주소 |
| `SEMANTIC_SCHOLAR_API_KEY` | 아니오 | Semantic Scholar 검색 API 키 |
| `REPORT_FONT_PATH` | 아니오 | PDF 보고서 생성에 사용할 TTF 폰트 경로 |

## 사용 흐름

1. 첫 화면의 큰 업로드 박스에 PDF 논문을 드래그앤드롭하거나 `PDF 파일 선택` 버튼으로 업로드합니다.
2. 서버가 PDF 텍스트를 추출합니다.
3. OpenAI API가 추출 텍스트를 기반으로 구조화된 요약 JSON을 생성하고 영문/국문 요약을 함께 만듭니다.
4. 원문이 영문이면 서버가 참고문헌 섹션을 제외한 본문을 한국어로 번역합니다.
5. 서버가 제목, 초록, 핵심 키워드를 기반으로 Semantic Scholar에서 유사 논문을 검색합니다.
6. 결과 화면에서 카드 형태의 요약/번역 보고서와 추천 논문을 확인합니다.
7. `요약 PDF 다운로드` 버튼으로 보고서 PDF를 다운로드합니다. 다운로드 파일명은 `논문제목_요약.pdf` 형식으로 지정되며, PDF 보고서에는 번역본과 영문/국문 요약을 포함하고 API 토큰 사용량과 유사 논문 추천 목록은 제외합니다. 서버에 Poppler가 설치되어 있고 영문 논문 번역본이 생성되면 `Figure 보존 번역 PDF`도 함께 받을 수 있습니다.

## 제한사항

- 첫 MVP에는 OCR이 포함되어 있지 않습니다. 스캔 PDF처럼 추출 텍스트가 거의 없는 파일은 분석할 수 없습니다.
- 유사 논문 추천은 실제 Semantic Scholar 검색 결과만 사용합니다. API 오류, 네트워크 문제, 결과 없음이 발생하면 임의 데이터를 만들지 않고 “추천 논문을 찾지 못했습니다.”를 표시합니다.
- PDF 보고서의 한글 렌더링 품질은 서버에 설치된 폰트에 따라 달라질 수 있습니다. 필요하면 `REPORT_FONT_PATH`에 한글 TTF 폰트를 지정하세요.
- Figure 보존 번역 PDF는 Poppler 도구(`pdftoppm`, `pdftotext`)가 서버에 설치된 경우에만 생성됩니다. 원본 페이지를 고해상도 배경으로 렌더링한 뒤 텍스트 영역을 번역문으로 오버레이하므로 figure 위치/형태는 보존되지만, 원문 텍스트 영역 감지 품질은 PDF 구조에 따라 달라질 수 있습니다. 구현 세부사항은 [`docs/figure-preserving-translation.md`](docs/figure-preserving-translation.md)를 참고하세요.

## 유용한 명령어

```bash
npm run dev      # Express 웹/API 서버 실행
npm run build    # 정적 HTML 방식이라 별도 빌드 없이 안내 메시지만 출력
npm run lint     # 서버 문법 검사
npm start        # Express 서버 실행
```
