# Paper Lens

PDF 논문을 업로드하면 서버에서 텍스트를 추출하고, OpenAI API로 구조화된 요약 보고서를 만든 뒤, Semantic Scholar 검색 결과 기반으로 유사 논문을 추천하는 **HTML/CSS/JavaScript + Express** 웹 MVP입니다. 별도 프론트엔드 빌드 없이 Express가 정적 HTML 화면과 API를 함께 제공합니다.

## 주요 기능

- PDF 전용 업로드: 드래그앤드롭과 버튼 업로드 지원
- 파일 검증: PDF 확장자/MIME 타입, 20MB 이하 제한
- PDF 텍스트 추출: `pdf-parse` 사용, 텍스트가 거의 없는 스캔 PDF는 OCR 필요 안내
- AI 요약: 제목, 저자, 출판연도, 연구 배경/목적/방법/결과/한계점, 키워드 5개, 한 문단 요약 생성
- 유사 논문 추천: Semantic Scholar API 검색 결과만 표시하며 결과가 없으면 “추천 논문을 찾지 못했습니다.” 표시
- PDF 다운로드: 업로드 원문이 아닌 AI 요약 보고서만 `pdfkit`으로 생성
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
- OpenAI API 키
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

3. `.env`에 OpenAI API 키를 입력합니다.

   ```dotenv
   OPENAI_API_KEY=your_openai_api_key_here
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

## 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `PORT` | 아니오 | Express 서버 포트, 기본값 `4000` |
| `OPENAI_API_KEY` | 예 | 서버에서만 사용하는 OpenAI API 키 |
| `OPENAI_MODEL` | 아니오 | 요약에 사용할 모델, 기본값 `gpt-4o-mini` |
| `CLIENT_ORIGIN` | 아니오 | 별도 프론트엔드 도메인을 둘 때 CORS 허용 주소 |
| `SEMANTIC_SCHOLAR_API_KEY` | 아니오 | Semantic Scholar 검색 API 키 |
| `REPORT_FONT_PATH` | 아니오 | PDF 보고서 생성에 사용할 TTF 폰트 경로 |

## 사용 흐름

1. 첫 화면의 큰 업로드 박스에 PDF 논문을 드래그앤드롭하거나 `PDF 파일 선택` 버튼으로 업로드합니다.
2. 서버가 PDF 텍스트를 추출합니다.
3. OpenAI API가 추출 텍스트를 기반으로 구조화된 요약 JSON을 생성합니다.
4. 서버가 제목, 초록, 핵심 키워드를 기반으로 Semantic Scholar에서 유사 논문을 검색합니다.
5. 결과 화면에서 카드 형태의 요약 보고서와 추천 논문을 확인합니다.
6. `요약 PDF 다운로드` 버튼으로 보고서 PDF를 다운로드합니다.

## 제한사항

- 첫 MVP에는 OCR이 포함되어 있지 않습니다. 스캔 PDF처럼 추출 텍스트가 거의 없는 파일은 분석할 수 없습니다.
- 유사 논문 추천은 실제 Semantic Scholar 검색 결과만 사용합니다. API 오류, 네트워크 문제, 결과 없음이 발생하면 임의 데이터를 만들지 않고 “추천 논문을 찾지 못했습니다.”를 표시합니다.
- PDF 보고서의 한글 렌더링 품질은 서버에 설치된 폰트에 따라 달라질 수 있습니다. 필요하면 `REPORT_FONT_PATH`에 한글 TTF 폰트를 지정하세요.

## 유용한 명령어

```bash
npm run dev      # Express 웹/API 서버 실행
npm run build    # 정적 HTML 방식이라 별도 빌드 없이 안내 메시지만 출력
npm run lint     # 서버 문법 검사
npm start        # Express 서버 실행
```
