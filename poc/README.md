# 홍보공장 PoC (1주차 기술 검증)

강의 정보(브리프)를 **한 번 입력**하면 **카드뉴스 6장(PNG)** 과 **15초 릴스(MP4)** 가 함께 생성되는지 확인하는 PoC입니다.
기획서: `../docs/홍보콘텐츠제작툴_기획서_20260927.docx`

## 결과

| 항목 | 결과 |
|---|---|
| 카드뉴스 | 1080×1350 PNG 6장, 약 1.5초 (Satori + resvg) |
| 릴스 | 1080×1920, 30fps, 15.0초 H.264 MP4, 약 2MB, 약 50초 (HyperFrames, CPU 렌더) |
| 한글 폰트 | Pretendard(OFL) 적용, 깨짐 없음 |
| 검증 | `npm test` 5/5 통과, `hyperframes check` 에러 0 |

샘플 결과물은 `samples/` 폴더에 있습니다(`cards_sheet.png`, `reel_frames.png`, `reel_sample.mp4`).

## 실행 방법

```bash
cd poc
npm install
npm run all      # 카드뉴스 + 릴스 → out/
npm run cards    # 카드뉴스만
npm run reel     # 릴스만
npm test         # 테스트
```

다른 강의로 만들려면 브리프 파일을 지정합니다.

```bash
node src/cli.js all 내강의.json brand.json
```

- 필요 환경: Node.js 22 이상
- ffmpeg와 ffprobe는 npm 패키지로 함께 설치되므로 따로 설치하지 않아도 됩니다.
- 영상 렌더에는 Chrome이 필요합니다. `HYPERFRAMES_BROWSER_PATH` 환경변수로 경로를 지정하거나, `npx hyperframes browser ensure`로 설치하세요.

## 구조

```
poc/
├─ brief.sample.json   강의 브리프 (예시 데이터)
├─ brand.json          브랜드킷 (색상·폰트)
├─ src/
│  ├─ content.js       브리프 → 공통 슬라이드 6장 (필수 항목 검증)
│  ├─ cards.js         슬라이드 → 카드뉴스 PNG (Satori)
│  ├─ reel.js          슬라이드 → HyperFrames HTML → MP4
│  ├─ env.js           ffmpeg/ffprobe/Chromium 경로 설정
│  └─ cli.js           실행 진입점
├─ reel/               HyperFrames 프로젝트 (index.html은 매번 자동 생성)
├─ test/               node:test 테스트
└─ samples/            PoC 결과 샘플
```

## 설계 메모

- **공통 슬라이드 구성:** 카드뉴스와 릴스가 같은 슬라이드 구성(`content.js`)을 씁니다. 매체를 추가해도 입력은 늘지 않습니다.
- **입력값 그대로 사용:** 일시·장소·가격은 AI가 만들지 않고 브리프의 값을 그대로 넣습니다. 사실 오류를 막기 위해서입니다.
- **브랜드 주색 조정:** 흰 글씨와의 명도 대비 기준(3:1)을 맞추려고 주황색을 `#FF7A00`에서 `#D95F00`으로 바꿨습니다. 대비는 3.76:1입니다.
- **라이선스:** HyperFrames와 Pretendard를 사용하며, 판매 제약이 없습니다.
  - HyperFrames: Apache-2.0
  - Satori: MPL-2.0
  - GSAP: 무료 표준 라이선스
  - Pretendard: OFL

## 남은 과제 (2주차 이후)

- [ ] Claude API로 카피·구성 생성 (지금은 브리프 문구를 그대로 사용)
- [ ] 템플릿 3종 이상, 템플릿 선택 기능
- [ ] 릴스 장면을 서브 컴포지션으로 분리 (`hyperframes check` 구조 권고 6건 해소)
- [ ] BGM·TTS 내레이션
- [ ] 웹 입력 폼과 미리보기 UI
