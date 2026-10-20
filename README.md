# DETAIL PAGE AI · by BAPI

AI 상품 상세페이지 제작 프로그램 (Windows 설치형). 상품 사진과 정보를 입력하면 Google Gemini 가 설명을 정리하고 상세페이지 문구·연출 이미지를 만들며, 결과를 블록별로 편집한 뒤 **JPG / 이미지 ZIP / 프로젝트 JSON** 으로 저장합니다.

> 설치 파일: `dist/DETAIL_PAGE_AI_Setup_v1.1.3.exe` · 사용법: [`docs/사용설명서.md`](docs/사용설명서.md) · 검증 결과와 한계: [`docs/검증결과.md`](docs/검증결과.md) · 배포: [`docs/배포안내.md`](docs/배포안내.md)

## 특징

- 흐름: 상품 정보 입력 → AI로 정리 → AI 생성 → 미리보기 → 블록·이미지 편집 → 저장·내보내기
- **외부 npm 패키지 0개.** 서버는 Node 기본 모듈만, 화면은 순수 JS. 설치 EXE 에 Node 런타임이 들어 있어 별도 설치 불필요
- 서버는 `127.0.0.1` 전용 (Host·Origin·세션 토큰 검증), API 키는 서버 **메모리에만** 보관 (파일·로그·백업에 저장 안 함)
- 직접 수정·순서 변경·숨김·사진 교체·저장은 **API 키 없이** 사용 가능
- 미리보기와 JPG 가 같은 렌더러(캔버스)를 써서 화면과 결과물이 일치. 앱 테마와 상세페이지 디자인은 분리
- 자동 저장(임시 파일 + 교체), 되돌리기/다시 실행, 프로젝트 목록·백업·복원
- **다국어(v1.1)**: 영어·일본어·중국어 간체 상세페이지(원문 한국어). AI 번역은 초안 → 용어집·시장 정보·자동 점검 → XLSX/XLIFF 전문 번역 검수 → 승인 → 언어별 JPG/ZIP 내보내기
- 포트 충돌 시 다른 포트 사용, 중복 실행 시 기존 실행본 재사용, 버전이 다르면 이전 실행본 종료 후 교체, 업데이트 시 자료 보존

## 구조

```
src/            server.js(HTTP·보안·인스턴스), gemini.js(API 클라이언트·모델 선택), ai.js(프롬프트·작업),
                normalize.js(응답 정규화), store.js(프로젝트·이미지 저장, 백업),
                xlsx.js·xliff.js·review.js(번역 검수 패키지)
public/         index.html, css/, js/(schema·render·zip·core·ai·product·preview·i18n·i18n-modals·export·main), fonts/(Pretendard, Noto JP/SC)
build/          NSIS 스크립트(installer/launcher), build.sh, 아이콘 생성
tests/          unit/(node:test), e2e/(Playwright), mock-gemini.js, wine-smoke.sh, verify-installer.sh
docs/           사용설명서, 검증결과, 배포안내
```

## 개발

```bash
node src/server.js          # http://127.0.0.1:47831 (사용 중이면 다음 포트). --no-open 으로 브라우저 자동 열기 끔
npm test                    # 단위 시험
npm run test:e2e            # 브라우저 E2E (playwright + chromium 필요)
npm run build:installer     # dist/DETAIL_PAGE_AI_Setup_v1.1.3.exe
```

환경 변수: `DPA_DATA_DIR`(자료 폴더), `DPA_PORT`(시작 포트), `DPA_IDLE_MS`(유휴 종료). `DPA_TEST=1` + `DPA_GEMINI_BASE` 는 **시험용 모의 서버 전용**이며 평소에는 Google 주소로 고정됩니다.

## 라이선스

자체 코드 © BAPI. 서드파티는 [`LICENSES.md`](LICENSES.md) 참고 (Pretendard: SIL OFL 1.1, Node.js: MIT 등).
