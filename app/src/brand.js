// 회사 프로필·브랜드 킷 정리와 검사
import { fitColors } from '../../poc/src/templates.js';

const str = (v, max) => (v === undefined || v === null ? '' : String(v).replace(/\r/g, '').trim().slice(0, max));
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/))
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
const HEX = /^#[0-9A-Fa-f]{6}$/;

export const COLOR_ROLES = ['primary', 'accent', 'dark', 'light', 'muted'];
export const DEFAULT_BRAND = {
  colors: { primary: '#D95F00', accent: '#FFD23F', dark: '#1B1F3B', light: '#FFF8EC', muted: '#6B7090' },
  tone: '밝고 친절하게, 과장 없이 구체적으로',
  forbidden: [],
  hashtags: [],
  aiBadge: true, // 결과물에 "AI 활용 제작" 표시(메타데이터 표시는 항상)
};

export function sanitizeProfile(raw = {}) {
  return {
    bizNumber: str(raw.bizNumber, 20),
    phone: str(raw.phone, 30),
    email: str(raw.email, 80),
    website: str(raw.website, 200),
    handle: str(raw.handle, 40),
    intro: str(raw.intro, 300),
  };
}

// 색상은 형식 검사 후 모든 템플릿에서 대비 3:1이 되도록 자동 보정한다. 무엇을 바꿨는지 함께 돌려준다.
export function sanitizeBrand(raw = {}) {
  const colors = {};
  for (const role of COLOR_ROLES) {
    const v = str(raw.colors?.[role], 7);
    colors[role] = HEX.test(v) ? v.toUpperCase() : DEFAULT_BRAND.colors[role];
  }
  const fitted = fitColors(colors);
  return {
    brand: {
      colors: fitted.colors,
      tone: str(raw.tone, 100) || DEFAULT_BRAND.tone,
      forbidden: list(raw.forbidden ?? DEFAULT_BRAND.forbidden, 50, 30),
      hashtags: list(raw.hashtags, 15, 30).map((t) => t.replace(/[\s#]/g, '')),
      aiBadge: raw.aiBadge === undefined ? DEFAULT_BRAND.aiBadge : Boolean(raw.aiBadge),
    },
    adjusted: fitted.changed.map((role) => ({ role, from: colors[role], to: fitted.colors[role] })),
  };
}

// 광고 표현 검수 대상 문장 모으기 (카피·광고 문구·상세페이지)
export function copyEntries(copy) {
  if (!copy) return [];
  return [
    ...(copy.variants ?? []).flatMap((v, i) => ['tag', 'title', 'subtitle', 'promise', 'cta'].map((k) => [`카피 ${i + 1}안 ${k}`, v[k]])),
    ...(copy.painPoints ?? []).map((p, i) => [`고민 ${i + 1}`, p]),
    ['캡션', copy.caption],
  ];
}

export function adEntries(adCopy) {
  return (adCopy?.ads ?? []).flatMap((a, i) => ['primaryText', 'headline', 'description', 'overlay', 'overlaySub'].map((k) => [`광고 ${i + 1}안 ${k}`, a[k]]));
}

export function detailEntries(d) {
  if (!d) return [];
  return [
    ...['hook', 'value', 'cta'].flatMap((k) => [[`상세 ${k} 제목`, d[k]?.title], [`상세 ${k} 본문`, d[k]?.body]]),
    ...(d.features ?? []).flatMap((f, i) => [[`상세 특징${i + 1}`, `${f.title} ${f.body}`]]),
    ...(d.proof?.items ?? []).map((t, i) => [`상세 근거${i + 1}`, t]),
    ...(d.faq ?? []).map((f, i) => [`상세 FAQ${i + 1}`, `${f.q} ${f.a}`]),
  ];
}
