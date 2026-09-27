// 브리프(강의 정보) → 매체 공통 슬라이드 구성.
// 카드뉴스와 릴스가 같은 구성을 공유해 "1회 입력 → 다매체 출력"을 보장한다.
// 날짜·장소·가격은 AI 생성 없이 입력값을 그대로 쓴다(기획서 10장 리스크 대응).

const REQUIRED = ['title', 'instructor', 'painPoints', 'curriculum', 'benefits', 'date', 'place', 'cta'];

export function validateBrief(brief) {
  const missing = REQUIRED.filter((k) => {
    const v = brief[k];
    return v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
  });
  if (missing.length) throw new Error(`브리프 필수 항목 누락: ${missing.join(', ')}`);
}

export function buildSlides(brief) {
  validateBrief(brief);
  return [
    { kind: 'cover', tag: brief.tag ?? '', title: brief.title, subtitle: brief.subtitle ?? '', instructor: brief.instructor },
    { kind: 'pain', heading: '이런 고민 있으신가요?', items: brief.painPoints.slice(0, 3) },
    { kind: 'promise', heading: brief.promise ?? brief.title, target: brief.target ?? '' },
    { kind: 'curriculum', heading: '이렇게 배웁니다', items: brief.curriculum.slice(0, 4) },
    { kind: 'benefits', heading: '수강 혜택', items: brief.benefits.slice(0, 3), price: brief.price ?? '' },
    { kind: 'cta', heading: '지금 신청하세요', date: brief.date, place: brief.place, price: brief.price ?? '', cta: brief.cta },
  ];
}
