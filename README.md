# Creative Alpha

AI 기반 크리에이티브 디렉터 에이전트 **Creative Alpha**의 제품 개요입니다. 입력한 제품 정보를 바탕으로 시장 조사부터 마케팅 전략, 카피라이팅, 하이엔드 비주얼 생성까지 원스톱으로 처리합니다.

## 주요 기능
- **자동화된 시장 조사**: Google Search Grounding을 활용한 실시간 트렌드 분석 및 타겟 페르소나/소구점 제안.
- **전략 및 카피라이팅**: `gemini-2.5-flash` 기반 톤앤매너 설정, 헤드라인/서브카피/CTA 작성.
- **하이엔드 비주얼 생성**: **Nano Banana Pro**(`gemini-3-pro-image-preview`)로 7가지 스타일 이미지 생성, 제품 사진 참조 지원.
- **포스터 합성 및 다운로드**: 원본·포스터 이미지 저장, 헤드라인/그라데이션 오버레이, Canva·미리캔버스 바로가기.
- **워크플로우**: 브리프 입력 → 전략 제안 → 에셋 생성 → 피드백 기반 수정 및 저장 → 초기화.

## 기술 스택
- Frontend: React, TypeScript, Tailwind CSS
- AI SDK: `@google/genai`
- Models: `gemini-2.5-flash`(텍스트), `gemini-3-pro-image-preview`(이미지)

자세한 흐름과 구현 메모는 [`docs/creative-alpha.md`](docs/creative-alpha.md)에서 확인할 수 있습니다.
