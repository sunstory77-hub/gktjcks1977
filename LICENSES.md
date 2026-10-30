# DETAIL PAGE AI — 라이선스 및 서드파티 고지

DETAIL PAGE AI © BAPI. 자체 코드(서버, 화면, 렌더러, ZIP 생성기)는 BAPI 소유이며, **외부 JavaScript 라이브러리(npm 의존성)를 사용하지 않습니다.**

## 배포물에 포함되는 구성 요소

| 구성 요소 | 용도 | 라이선스 | 비고 |
|---|---|---|---|
| Pretendard Variable (Kil Hyung-jin) | 화면·상세페이지 글꼴 | SIL Open Font License 1.1 | 상업적 이용·재배포 가능. 전문: `app/public/fonts/Pretendard-LICENSE-OFL.txt`. 글꼴 이름(Pretendard)을 바꾸지 않고 원본 그대로 포함. |
| Noto Sans JP Variable · Noto Sans SC Variable (Google, Fontsource 5.3.1 배포본) | 일본어·중국어(간체) 상세페이지 글꼴 | SIL Open Font License 1.1 (상업적 이용 가능) | 전문: `app/public/fonts/noto-sans-jp/LICENSE-OFL.txt`, `app/public/fonts/noto-sans-sc/LICENSE-OFL.txt`. 원본 그대로 포함(이름 변경·수정 없음). |
| Node.js v22.22.0 (win-x64) | 프로그램 실행 환경 | MIT 및 포함 라이브러리(V8, OpenSSL, ICU, zlib, undici 등) 라이선스 | 전문: `runtime/LICENSE-node.txt` |
| NSIS 3.09 (설치 파일 생성 도구) | 설치·실행기 stub 이 설치 파일에 포함 | zlib/libpng 라이선스 | https://nsis.sourceforge.io/License |

## 빌드·시험에만 쓰이며 배포물에 포함되지 않는 도구

| 도구 | 용도 | 라이선스 |
|---|---|---|
| Playwright (+Chromium) | 브라우저 자동 시험 | Apache-2.0 |
| Pillow | 아이콘 생성 | MIT-CMU (HPND) |
| Pandoc | 사용 설명서 HTML 변환 | GPL-2.0-or-later (도구만 사용, 결과물에 포함 안 됨) |

## 외부 서비스

- **Google Gemini API**: 사용자의 Google 계정과 API 키로 호출하며, 서비스 약관·요금은 Google 정책을 따릅니다. 이 프로그램은 API 키나 Google 서비스를 재판매·중계하지 않습니다.

## 다른 사이트의 코드·자산

- 이 프로그램은 BAPI가 제공한 요구사항 명세를 기준으로 처음부터 새로 작성했습니다. 다른 사이트의 비공개 코드, 로고, 문구, 이미지 등 자산은 사용하지 않았습니다. (제작 환경에서 참고 사이트에 접속할 수 없었고, 해당 사이트의 소스는 열람하지 않았습니다.)
