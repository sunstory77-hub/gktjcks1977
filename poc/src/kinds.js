// 업종(캠페인 종류)별 팩트 시트 정의.
// 필드 이름(date·place·price·instructor·curriculum·benefits·cta)은 공통으로 쓰고, 화면 라벨·필수 항목·카드 문구·AI 설명만 업종별로 바꾼다.
// 기본은 교육·행사(edu) — 기존 브리프는 kind가 없으므로 edu로 동작한다.

export const KINDS = {
  edu: {
    label: '교육·행사',
    labels: { instructor: '강사', curriculum: '커리큘럼', benefits: '혜택', date: '일시', place: '장소', price: '수강료', cta: '신청 안내', target: '추천 대상', painPoints: '수강 대상의 고민' },
    required: ['title', 'instructor', 'painPoints', 'curriculum', 'benefits', 'date', 'place', 'cta'],
    heads: { pain: '이런 고민 있으신가요?', promise: '그래서 준비했습니다', curriculum: '이렇게 배웁니다', benefits: '수강 혜택', cta: '지금 신청하세요' },
    by: (v) => `with ${v}`,
    writer: '교육·강의·행사',
    subject: '강의·행사',
    audience: '수강 대상',
    // AI 자리표시자 이름 → 필드
    tokens: { 일시: 'date', 장소: 'place', 수강료: 'price', 강사: 'instructor', 신청: 'cta' },
    faq: { when: '언제, 어디서 진행하나요?', price: '수강료는 얼마인가요?', how: '어떻게 신청하나요?' },
  },
  product: {
    label: '상품 판매',
    labels: { instructor: '브랜드', curriculum: '주요 특징', benefits: '구매 혜택', date: '판매 기간', place: '구매처', price: '가격', cta: '구매 안내', target: '추천 대상', painPoints: '고객의 불편' },
    required: ['title', 'painPoints', 'curriculum', 'benefits', 'cta'],
    heads: { pain: '이런 불편 있으셨죠?', promise: '그래서 만들었습니다', curriculum: '이런 점이 다릅니다', benefits: '구매 혜택', cta: '지금 만나보세요' },
    by: (v) => v,
    writer: '상품 판매·커머스',
    subject: '상품',
    audience: '구매 고객',
    tokens: { 기간: 'date', 구매처: 'place', 가격: 'price', 브랜드: 'instructor', 구매: 'cta' },
    faq: { when: '언제, 어디서 살 수 있나요?', price: '가격은 얼마인가요?', how: '어떻게 구매하나요?' },
  },
  service: {
    label: '서비스·매장',
    labels: { instructor: '브랜드·담당', curriculum: '서비스 구성', benefits: '이용 혜택', date: '운영 시간', place: '위치', price: '가격', cta: '예약 안내', target: '추천 대상', painPoints: '고객의 고민' },
    required: ['title', 'painPoints', 'curriculum', 'benefits', 'place', 'cta'],
    heads: { pain: '이런 고민 있으신가요?', promise: '그래서 준비했습니다', curriculum: '이렇게 진행됩니다', benefits: '이용 혜택', cta: '지금 예약하세요' },
    by: (v) => v,
    writer: '서비스업·매장',
    subject: '서비스·매장',
    audience: '이용 고객',
    tokens: { 시간: 'date', 위치: 'place', 가격: 'price', 브랜드: 'instructor', 예약: 'cta' },
    faq: { when: '언제, 어디서 이용할 수 있나요?', price: '가격은 얼마인가요?', how: '어떻게 예약하나요?' },
  },
};
export const KIND_NAMES = Object.keys(KINDS);
export const DEFAULT_KIND = 'edu';

export const kindOf = (facts) => KINDS[facts?.kind] ?? KINDS[DEFAULT_KIND];

// 사실 정보 줄(라벨, 값): 카드 신청 장·릴스·상세페이지 신청 블록 공통
export function factRows(facts) {
  const L = kindOf(facts).labels;
  return [
    [L.date, facts.date],
    [L.place, facts.place],
    [L.price, facts.price],
  ].filter(([, v]) => String(v ?? '').trim());
}

// 모든 업종의 자리표시자 이름(AI가 다른 업종 이름을 써도 같은 필드로 채운다)
export const ALL_TOKENS = Object.assign({}, ...Object.values(KINDS).map((k) => k.tokens));
// 사실 라벨 직접 작성 검사용 라벨
export const FACT_LABEL_WORDS = [...new Set(['일시', '날짜', '장소', '수강료', '가격', '강사', ...Object.values(KINDS).flatMap((k) => [k.labels.date, k.labels.place, k.labels.price])])].filter((w) => !/\s/.test(w));

// AI에게 필드 의미를 알려 주는 한 줄 (예: instructor=브랜드, curriculum=주요 특징)
export function fieldGuide(facts) {
  const k = kindOf(facts);
  return `이 팩트 시트는 "${k.label}" 홍보용입니다. 필드 의미: ${Object.entries(k.labels)
    .map(([f, l]) => `${f}=${l}`)
    .join(', ')}.`;
}
