# Detail Pages Monorepo

상품 상세페이지 생성 기능을 위한 프론트엔드(`apps/web`)와 백엔드(`apps/api`)를 포함한 워크스페이스 구조입니다.

## 디렉터리 구조

- `apps/web`: 이미지 업로드 UI와 캔버스 미리보기(`/editor`)를 제공하는 React + Vite 프론트엔드
- `apps/api`: 헬스체크(`GET /health`) 및 상세페이지 생성 요청 스켈레톤(`POST /detail-pages`) API
- `.env.example`: API 실행용 환경 변수 예시

## 시작하기

```bash
npm install
cp .env.example .env
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001

## 공통 스크립트

- `npm run dev`: `apps/web`, `apps/api` 개발 서버 동시 실행
- `npm run build`: 각 워크스페이스 build 스크립트 실행
- `npm run lint`: 각 워크스페이스 lint 스크립트 실행

## API 예시

```bash
curl http://localhost:3001/health

curl -X POST http://localhost:3001/detail-pages \
  -H "Content-Type: application/json" \
  -d '{"title":"신규 상품","images":["https://example.com/1.png"]}'
```
