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
  forbidden: ['최고', '1위', '유일', '100%', '무조건', '보장'],
  hashtags: [],
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
    },
    adjusted: fitted.changed.map((role) => ({ role, from: colors[role], to: fitted.colors[role] })),
  };
}

// 카피에서 회사가 금지한 표현을 찾는다(차단이 아니라 경고 — 최종 판단은 사용자)
export function findForbidden(copy, forbidden) {
  if (!forbidden?.length || !copy) return [];
  const texts = [
    ...(copy.variants ?? []).flatMap((v, i) => ['tag', 'title', 'subtitle', 'promise', 'cta'].map((k) => [`${i + 1}안 ${k}`, v[k]])),
    ...(copy.painPoints ?? []).map((p, i) => [`고민 ${i + 1}`, p]),
    ['캡션', copy.caption],
  ];
  const hits = [];
  for (const word of forbidden) {
    const where = texts.filter(([, t]) => String(t ?? '').includes(word)).map(([w]) => w);
    if (where.length) hits.push({ word, where });
  }
  return hits;
}
