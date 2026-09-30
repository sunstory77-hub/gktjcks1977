import { imageLayer, linear, page, shapeLayer, solid, textLayer as text } from './layers';
import type { FormatId, Page } from './types';

export interface Template {
  id: string;
  name: string;
  formatId: FormatId;
  description: string;
  build: () => Page[];
}

const BRAND = '#4f46e5';
const ACCENT = '#facc15';
const DARK = '#0f172a';

export const TEMPLATES: Template[] = [
  // ───────── 인스타 1:1 ─────────
  {
    id: 'sq-cardnews',
    name: '카드뉴스 3장',
    formatId: 'insta-square',
    description: '표지 → 본문 → 저장 유도',
    build: () => [
      page({
        background: linear('#312e81', '#7c3aed'),
        layers: [
          text({ text: 'AI 초보 필독', x: 90, y: 150, w: 900, h: 80, fontSize: 44, color: ACCENT, fontWeight: 900 }),
          text({ text: '업무시간 절반 줄이는\nChatGPT 활용법 3가지', x: 90, y: 250, w: 900, h: 300, fontSize: 88, color: '#fff', fontWeight: 900, fontFamily: 'Black Han Sans', lineHeight: 1.25 }),
          shapeLayer({ x: 90, y: 600, w: 120, h: 10, fill: solid(ACCENT) }),
          text({ text: '밀어서 확인하기 →', x: 90, y: 900, w: 900, h: 60, fontSize: 36, color: '#e0e7ff', fontWeight: 700 }),
        ],
      }),
      page({
        background: solid('#f8fafc'),
        layers: [
          text({ text: '01', x: 90, y: 110, w: 300, h: 120, fontSize: 110, color: BRAND, fontWeight: 900 }),
          text({ text: '회의록은 AI에게 맡기세요', x: 90, y: 280, w: 900, h: 90, fontSize: 64, color: DARK, fontWeight: 900 }),
          text({ text: '녹음 파일을 올리고 "결정사항과 할 일만 표로 정리해줘"라고 요청하면 10분이면 끝납니다.', x: 90, y: 420, w: 900, h: 260, fontSize: 40, color: '#334155', fontWeight: 400, lineHeight: 1.6 }),
          imageLayer({ x: 90, y: 700, w: 900, h: 290, radius: 28 }),
        ],
      }),
      page({
        background: solid(BRAND),
        layers: [
          text({ text: '도움이 됐다면', x: 90, y: 330, w: 900, h: 80, fontSize: 52, color: '#c7d2fe', align: 'center', fontWeight: 700 }),
          text({ text: '저장하고\n필요할 때 꺼내보세요', x: 90, y: 430, w: 900, h: 240, fontSize: 84, color: '#fff', align: 'center', fontWeight: 900, fontFamily: 'Black Han Sans' }),
          text({ text: '@긍정하쌤', x: 90, y: 860, w: 900, h: 60, fontSize: 40, color: ACCENT, align: 'center', fontWeight: 700 }),
        ],
      }),
    ],
  },
  {
    id: 'sq-photo-quote',
    name: '사진 + 한 줄 카피',
    formatId: 'insta-square',
    description: '풀사진 위 하단 카피',
    build: () => [
      page({
        background: solid('#222'),
        layers: [
          imageLayer({ x: 0, y: 0, w: 1080, h: 1080 }),
          shapeLayer({ name: '그라데이션', x: 0, y: 480, w: 1080, h: 600, fill: linear('rgba(0,0,0,0)', 'rgba(0,0,0,0.8)', 180) }),
          text({ text: '배움은 속도가 아니라\n방향입니다', x: 80, y: 760, w: 920, h: 200, fontSize: 70, color: '#fff', fontWeight: 900, shadow: true }),
          text({ text: '긍정하쌤 AI 클래스', x: 80, y: 980, w: 920, h: 50, fontSize: 32, color: ACCENT, fontWeight: 700 }),
        ],
      }),
    ],
  },
  // ───────── 인스타 4:5 ─────────
  {
    id: 'pt-review',
    name: '수강 후기 카드',
    formatId: 'insta-portrait',
    description: '후기 인용 + 별점',
    build: () => [
      page({
        background: solid('#fff7ed'),
        layers: [
          text({ text: '★★★★★', x: 90, y: 160, w: 900, h: 80, fontSize: 64, color: '#f59e0b', align: 'center' }),
          text({ text: '“AI가 어렵다는 생각이\n3시간 만에 사라졌어요”', x: 90, y: 330, w: 900, h: 260, fontSize: 70, color: DARK, align: 'center', fontWeight: 900, fontFamily: 'Nanum Myeongjo', lineHeight: 1.4 }),
          text({ text: '실습 위주라 바로 업무에 써먹을 수 있었고, 강사님 설명이 정말 쉬웠습니다.', x: 150, y: 680, w: 780, h: 200, fontSize: 38, color: '#57534e', align: 'center', fontWeight: 400, lineHeight: 1.6 }),
          shapeLayer({ x: 440, y: 960, w: 200, h: 200, shape: 'ellipse', fill: solid('#fed7aa') }),
          text({ text: '40대 직장인 김○○님', x: 90, y: 1200, w: 900, h: 60, fontSize: 36, color: '#78716c', align: 'center', fontWeight: 700 }),
        ],
      }),
    ],
  },
  {
    id: 'pt-announce',
    name: '강의 모집 공지',
    formatId: 'insta-portrait',
    description: '일정·장소·신청 안내',
    build: () => [
      page({
        background: linear('#0f172a', '#1e3a8a', 160),
        layers: [
          text({ text: '모집 중', x: 90, y: 120, w: 260, h: 80, fontSize: 40, color: DARK, fontWeight: 900, align: 'center', boxColor: ACCENT, boxPadding: 18 }),
          text({ text: '왕초보를 위한\n생성형 AI 실무 특강', x: 90, y: 260, w: 900, h: 280, fontSize: 90, color: '#fff', fontWeight: 900, fontFamily: 'Black Han Sans', lineHeight: 1.2 }),
          shapeLayer({ x: 90, y: 640, w: 900, h: 460, radius: 32, fill: solid('rgba(255,255,255,0.08)'), strokeColor: 'rgba(255,255,255,0.25)', strokeWidth: 2 }),
          text({ text: '일시  10월 20일(월) 19:00\n장소  온라인 ZOOM\n대상  AI가 처음인 누구나\n정원  선착순 30명', x: 140, y: 700, w: 820, h: 360, fontSize: 44, color: '#e2e8f0', fontWeight: 700, lineHeight: 1.9 }),
          text({ text: '프로필 링크에서 신청하세요', x: 90, y: 1170, w: 900, h: 70, fontSize: 42, color: ACCENT, align: 'center', fontWeight: 900 }),
        ],
      }),
    ],
  },
  // ───────── 9:16 ─────────
  {
    id: 'st-shorts',
    name: '쇼츠·릴스 슬라이드 영상',
    formatId: 'story',
    description: '훅 → 포인트 2개 → CTA (영상 내보내기용)',
    build: () => [
      page({
        background: solid('#000'),
        duration: 2.5,
        motion: 'zoom-in',
        layers: [
          imageLayer({ x: 0, y: 0, w: 1080, h: 1920, brightness: 70 }),
          text({ text: '이거 모르면\n손해입니다', x: 60, y: 700, w: 960, h: 400, fontSize: 130, color: '#fff', align: 'center', fontFamily: 'Black Han Sans', strokeColor: '#000', strokeWidth: 8, lineHeight: 1.2 }),
        ],
      }),
      page({
        background: solid('#111827'),
        duration: 3,
        motion: 'pan',
        layers: [
          text({ text: 'POINT 1', x: 60, y: 560, w: 960, h: 90, fontSize: 60, color: ACCENT, align: 'center', fontWeight: 900 }),
          text({ text: '질문을 구체적으로\n쓸수록 답이 좋아진다', x: 60, y: 700, w: 960, h: 320, fontSize: 92, color: '#fff', align: 'center', fontWeight: 900, lineHeight: 1.3 }),
        ],
      }),
      page({
        background: solid('#111827'),
        duration: 3,
        motion: 'pan',
        layers: [
          text({ text: 'POINT 2', x: 60, y: 560, w: 960, h: 90, fontSize: 60, color: ACCENT, align: 'center', fontWeight: 900 }),
          text({ text: '역할을 먼저 정해주면\n전문가처럼 답한다', x: 60, y: 700, w: 960, h: 320, fontSize: 92, color: '#fff', align: 'center', fontWeight: 900, lineHeight: 1.3 }),
        ],
      }),
      page({
        background: linear(BRAND, '#db2777', 160),
        duration: 2.5,
        motion: 'zoom-out',
        layers: [
          text({ text: '팔로우하고\nAI 꿀팁 받기', x: 60, y: 760, w: 960, h: 340, fontSize: 120, color: '#fff', align: 'center', fontFamily: 'Black Han Sans', lineHeight: 1.2 }),
          text({ text: '@긍정하쌤', x: 60, y: 1180, w: 960, h: 80, fontSize: 56, color: ACCENT, align: 'center', fontWeight: 900 }),
        ],
      }),
    ],
  },
  {
    id: 'st-cover',
    name: '릴스 커버',
    formatId: 'story',
    description: '피드 그리드용 커버 한 장',
    build: () => [
      page({
        background: solid('#fef3c7'),
        layers: [
          imageLayer({ x: 90, y: 520, w: 900, h: 900, radius: 450 }),
          text({ text: 'AI 자동화 EP.01', x: 90, y: 300, w: 900, h: 70, fontSize: 48, color: '#92400e', align: 'center', fontWeight: 900 }),
          text({ text: '엑셀 반복업무 끝', x: 60, y: 1480, w: 960, h: 140, fontSize: 120, color: DARK, align: 'center', fontFamily: 'Black Han Sans' }),
        ],
      }),
    ],
  },
  // ───────── 유튜브 썸네일 ─────────
  {
    id: 'yt-bold',
    name: '임팩트 썸네일',
    formatId: 'youtube-thumb',
    description: '좌측 대형 카피 + 우측 인물',
    build: () => [
      page({
        background: linear('#111827', '#1f2937', 90),
        layers: [
          imageLayer({ x: 700, y: 0, w: 580, h: 720 }),
          text({ text: '10분 만에', x: 60, y: 110, w: 700, h: 110, fontSize: 96, color: DARK, fontFamily: 'Black Han Sans', boxColor: ACCENT, boxPadding: 16 }),
          text({ text: 'PPT 끝내는\nAI 사용법', x: 60, y: 270, w: 760, h: 340, fontSize: 140, color: '#fff', fontFamily: 'Black Han Sans', strokeColor: '#000', strokeWidth: 10, lineHeight: 1.1 }),
        ],
      }),
    ],
  },
  {
    id: 'yt-center',
    name: '중앙 타이틀 썸네일',
    formatId: 'youtube-thumb',
    description: '배경 사진 + 가운데 제목',
    build: () => [
      page({
        background: solid('#000'),
        layers: [
          imageLayer({ x: 0, y: 0, w: 1280, h: 720, brightness: 55 }),
          text({ text: '강사가 알려주는\n진짜 AI 활용 루틴', x: 80, y: 200, w: 1120, h: 320, fontSize: 118, color: '#fff', align: 'center', fontWeight: 900, shadow: true, lineHeight: 1.2 }),
        ],
      }),
    ],
  },
  // ───────── 상세페이지 ─────────
  {
    id: 'dt-full',
    name: '상세페이지 풀세트 (6섹션)',
    formatId: 'detail',
    description: '히어로 → 고민 → 특징 → 구성 → 후기 → 신청',
    build: () => [
      page({
        height: 1200,
        background: linear('#1e1b4b', BRAND, 170),
        layers: [
          text({ text: '직장인·강사·소상공인을 위한', x: 60, y: 140, w: 740, h: 60, fontSize: 36, color: '#c7d2fe', align: 'center', fontWeight: 700 }),
          text({ text: '생성형 AI\n실무 마스터 과정', x: 60, y: 220, w: 740, h: 260, fontSize: 96, color: '#fff', align: 'center', fontFamily: 'Black Han Sans', lineHeight: 1.2 }),
          imageLayer({ x: 100, y: 560, w: 660, h: 500, radius: 24 }),
        ],
      }),
      page({
        height: 1000,
        background: solid('#f8fafc'),
        layers: [
          text({ text: '혹시 이런 고민 있으신가요?', x: 60, y: 110, w: 740, h: 80, fontSize: 52, color: DARK, align: 'center', fontWeight: 900 }),
          ...['AI를 써보긴 했는데 결과가 별로다', '매일 반복되는 문서 작업에 지친다', '뭘부터 배워야 할지 모르겠다'].flatMap((t, i) => [
            shapeLayer({ x: 80, y: 280 + i * 210, w: 700, h: 160, radius: 20, fill: solid('#fff'), strokeColor: '#e2e8f0', strokeWidth: 2 }),
            text({ text: `✔  ${t}`, x: 120, y: 330 + i * 210, w: 640, h: 60, fontSize: 36, color: '#334155', fontWeight: 700 }),
          ]),
        ],
      }),
      page({
        height: 1300,
        background: solid('#fff'),
        layers: [
          text({ text: 'POINT', x: 60, y: 100, w: 740, h: 50, fontSize: 32, color: BRAND, align: 'center', fontWeight: 900 }),
          text({ text: '이 과정만의 3가지 특징', x: 60, y: 160, w: 740, h: 80, fontSize: 56, color: DARK, align: 'center', fontWeight: 900 }),
          ...[
            ['100% 실습', '내 업무 자료로 바로 따라하는 실전형 수업'],
            ['프롬프트 템플릿 제공', '복사해서 바로 쓰는 업무별 템플릿 50종'],
            ['수료 후 1:1 피드백', '결과물을 보내면 강사가 직접 코칭'],
          ].flatMap(([h, d], i) => [
            shapeLayer({ x: 80, y: 330 + i * 300, w: 120, h: 120, shape: 'ellipse', fill: solid('#eef2ff') }),
            text({ text: `0${i + 1}`, x: 80, y: 362 + i * 300, w: 120, h: 60, fontSize: 44, color: BRAND, align: 'center', fontWeight: 900 }),
            text({ text: h, x: 240, y: 340 + i * 300, w: 540, h: 60, fontSize: 44, color: DARK, fontWeight: 900 }),
            text({ text: d, x: 240, y: 410 + i * 300, w: 540, h: 100, fontSize: 30, color: '#64748b', fontWeight: 400, lineHeight: 1.5 }),
          ]),
        ],
      }),
      page({
        height: 1100,
        background: solid('#0f172a'),
        layers: [
          text({ text: '커리큘럼', x: 60, y: 110, w: 740, h: 80, fontSize: 56, color: '#fff', align: 'center', fontWeight: 900 }),
          ...['1차시  생성형 AI 이해와 프롬프트 기본', '2차시  문서·보고서 자동화', '3차시  이미지·영상 콘텐츠 제작', '4차시  나만의 업무 자동화 완성'].flatMap((t, i) => [
            shapeLayer({ x: 80, y: 260 + i * 190, w: 700, h: 150, radius: 16, fill: solid('rgba(255,255,255,0.06)') }),
            text({ text: t, x: 120, y: 305 + i * 190, w: 640, h: 60, fontSize: 36, color: '#e2e8f0', fontWeight: 700 }),
          ]),
        ],
      }),
      page({
        height: 1000,
        background: solid('#fff7ed'),
        layers: [
          text({ text: '수강생 후기', x: 60, y: 110, w: 740, h: 80, fontSize: 56, color: DARK, align: 'center', fontWeight: 900 }),
          ...['“반복 업무가 1/3로 줄었어요” - 공무원 A님', '“강의 자료 만드는 시간이 확 줄었어요” - 강사 B님', '“가게 홍보물을 직접 만들어요” - 소상공인 C님'].flatMap((t, i) => [
            shapeLayer({ x: 80, y: 260 + i * 220, w: 700, h: 170, radius: 20, fill: solid('#fff') }),
            text({ text: '★★★★★', x: 120, y: 285 + i * 220, w: 300, h: 40, fontSize: 28, color: '#f59e0b' }),
            text({ text: t, x: 120, y: 335 + i * 220, w: 640, h: 80, fontSize: 32, color: '#44403c', fontWeight: 700 }),
          ]),
        ],
      }),
      page({
        height: 900,
        background: linear(BRAND, '#db2777', 135),
        layers: [
          text({ text: '지금 신청하면\n얼리버드 30% 할인', x: 60, y: 220, w: 740, h: 240, fontSize: 76, color: '#fff', align: 'center', fontFamily: 'Black Han Sans', lineHeight: 1.25 }),
          shapeLayer({ x: 180, y: 560, w: 500, h: 120, radius: 60, fill: solid(ACCENT) }),
          text({ text: '신청하기 →', x: 180, y: 590, w: 500, h: 60, fontSize: 44, color: DARK, align: 'center', fontWeight: 900 }),
        ],
      }),
    ],
  },
];

/** 포맷별 빈 캔버스 */
export function blankPages(formatId: FormatId): Page[] {
  return [page({ height: formatId === 'detail' ? 1200 : undefined })];
}

export function templatesFor(formatId: FormatId): Template[] {
  return TEMPLATES.filter((t) => t.formatId === formatId);
}
