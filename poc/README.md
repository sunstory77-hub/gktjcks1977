# 홍보공장 PoC

강의 정보(브리프)를 **한 번 입력**하면 다음이 함께 만들어집니다.
- 홍보 카피 3안
- 카드뉴스 6장(PNG)
- 15초 릴스(MP4)

기획서: `../docs/홍보콘텐츠제작툴_기획서_20260927.docx`

## 진행 현황

| 주차 | 내용 | 상태 |
|---|---|---|
| 1주차 | 카드뉴스(Satori)·릴스(HyperFrames) 렌더링 검증 | 완료 |
| 2주차 | Claude 카피 생성, 템플릿 3종, 릴스 서브 컴포지션 분리, 배경음악 | 완료 |
| 3주차 | 웹 입력 폼과 미리보기, 일괄 다운로드 | 예정 |

## 결과 (2주차 기준)

| 항목 | 결과 |
|---|---|
| 카드뉴스 | 1080×1350 PNG 6장, 템플릿당 약 0.6초 |
| 릴스 | 1080×1920, 30fps, 15.0초 H.264 MP4, 템플릿당 약 26초 (CPU) |
| 템플릿 | `bold`(기본), `clean`, `pop` — 카드뉴스와 릴스에 함께 적용 |
| 배경음악 | `--bgm` 지정 시 AAC 트랙 추가, 0.5초 페이드인 / 1.5초 페이드아웃 |
| AI 카피 | Claude가 3안·고민 포인트·인스타 캡션·해시태그 생성, 글자 수 한도 검증 |

**검증**
- `npm test` 14건 모두 통과
- `hyperframes check`: 에러·경고 0건, 명도 대비 WCAG AA 41/41 통과

샘플은 `samples/`에 있습니다.
- 템플릿별 카드뉴스: `cards_*.png`
- 템플릿별 릴스: `reel_*.mp4`
- 릴스 프레임 비교: `reel_frames_3templates.png`
- 카피 예시: `copy_offline.md`

## 실행 방법

```bash
cd poc
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # 없으면 브리프 문구로 자동 대체

npm run all                   # 카피 + 카드뉴스 + 릴스 (bold)
npm run all:templates         # 템플릿 3종 모두
npm run copy                  # 카피만 → out/copy.md
npm test
```

옵션은 다음과 같습니다.

```bash
node src/cli.js [all|cards|reel|copy] \
  --brief 내강의.json    # 강의 브리프 (기본 brief.sample.json)
  --brand brand.json     # 브랜드킷
  --template pop         # bold | clean | pop | all
  --variant 2            # 적용할 카피 안 (1~3)
  --bgm 음악.mp3         # 릴스 배경음악 (저작권 확인된 파일만)
  --no-ai                # Claude 호출 없이 진행
```

- 결과물 위치
  - 카피: `out/copy.md`
  - 카드뉴스: `out/<템플릿>/cards/`
  - 릴스: `out/<템플릿>/reel.mp4`
- 필요 환경: Node.js 22 이상
- ffmpeg와 ffprobe는 npm 패키지로 함께 설치됩니다.
- 영상 렌더에는 Chrome이 필요합니다. `HYPERFRAMES_BROWSER_PATH`로 경로를 지정하거나, `npx hyperframes browser ensure`로 설치하세요.

## 구조

```
poc/
├─ brief.sample.json   강의 브리프 (예시 데이터)
├─ brand.json          브랜드킷 (색상·폰트)
├─ src/
│  ├─ ai.js            Claude 카피 생성 · 검증 · 오프라인 대체
│  ├─ content.js       브리프 → 공통 슬라이드 6장
│  ├─ templates.js     템플릿 3종 (표면색·부품 스타일) + 명도 대비 계산
│  ├─ cards.js         슬라이드 → 카드뉴스 PNG (Satori)
│  ├─ reel.js          슬라이드 → HyperFrames 프로젝트(장면별 서브 컴포지션) → MP4
│  ├─ env.js           ffmpeg/ffprobe/Chromium 경로 설정
│  └─ cli.js           실행 진입점
├─ reel/               HyperFrames 프로젝트 (index.html·compositions/는 매번 자동 생성)
├─ test/               node:test 테스트 14건
└─ samples/            결과 샘플
```

## 설계 메모

**AI 카피 (`src/ai.js`)**
- 공식 SDK `@anthropic-ai/sdk`를 씁니다. 모델은 `claude-opus-5`이고, `PROMO_MODEL` 환경변수로 바꿀 수 있습니다.
- 적응형 사고(thinking), JSON 스키마 구조화 출력, 서버측 거절 대비 폴백(`fallbacks: "default"`)을 적용했습니다.
- 사실 정보는 AI가 건드리지 않습니다.
  - 대상 항목: 일시·장소·가격·커리큘럼·혜택·강사명
  - 이 값들은 브리프 값을 그대로 넣습니다(`applyCopy`).
  - 프롬프트에도 "브리프에 없는 수치를 만들지 말 것"을 명시했습니다.
- 카피가 글자 수 한도를 넘으면 오류로 처리하고, 브리프 문구로 대신 진행합니다. 레이아웃이 깨지는 것을 막기 위해서입니다.
  - 한도 예: 제목 한 줄 10자 × 2줄

**템플릿 (`src/templates.js`)**
- 카드뉴스와 릴스가 같은 테마 객체를 씁니다.
- 테스트에서 모든 글자·배경 조합의 명도 대비가 3:1 이상인지 검사합니다.

**릴스 (`src/reel.js`)**
- 장면 5개를 각각 `compositions/sN.html` 서브 컴포지션으로 분리했습니다. 각 타임라인은 장면 시작을 0초로 둡니다.
- 1주차에 나왔던 구조 권고 경고 6건은 이 분리로 해소됐습니다.

**라이선스**
- HyperFrames: Apache-2.0
- Satori: MPL-2.0
- GSAP: 무료 표준 라이선스
- Pretendard: OFL
- Anthropic SDK: MIT

## 남은 과제

- [ ] 실제 API 키로 카피 품질 확인 (현재는 모의 응답으로 테스트)
- [ ] 3주차: 웹 입력 폼과 미리보기, 일괄 다운로드
- [ ] TTS 내레이션
- [ ] 강의 녹화본에서 쇼츠 추출 (v2)
