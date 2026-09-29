// 브리프(팩트 시트) → 매체 공통 슬라이드 구성.
// 카드뉴스와 릴스가 같은 구성을 공유해 "1회 입력 → 다매체 출력"을 보장한다.
// 날짜·장소·가격은 AI 생성 없이 입력값을 그대로 쓴다(기획서 10장 리스크 대응).
// 제목·라벨·필수 항목은 업종(kind)별로 다르다(kinds.js).
import { kindOf, factRows } from './kinds.js';

export function validateBrief(brief) {
  const missing = kindOf(brief).required.filter((k) => {
    const v = brief[k];
    return v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
  });
  if (missing.length) throw new Error(`브리프 필수 항목 누락: ${missing.join(', ')}`);
}

export function buildSlides(brief) {
  validateBrief(brief);
  const k = kindOf(brief);
  return [
    { kind: 'cover', tag: brief.tag ?? '', title: brief.title, subtitle: brief.subtitle ?? '', instructor: brief.instructor ?? '', by: brief.instructor ? k.by(brief.instructor) : '' },
    { kind: 'pain', heading: k.heads.pain, items: brief.painPoints.slice(0, 3) },
    { kind: 'promise', heading: brief.promise || String(brief.title), target: brief.target ?? '', lead: k.heads.promise, targetLabel: k.labels.target },
    { kind: 'curriculum', heading: k.heads.curriculum, items: brief.curriculum.slice(0, 4) },
    { kind: 'benefits', heading: k.heads.benefits, items: (brief.benefits ?? []).slice(0, 3), price: brief.price ?? '' },
    { kind: 'cta', heading: k.heads.cta, date: brief.date ?? '', place: brief.place ?? '', price: brief.price ?? '', cta: brief.cta, rows: factRows(brief) },
  ];
}
