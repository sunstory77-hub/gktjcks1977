// 디자인 템플릿 3종. 브랜드 색상을 받아 슬라이드 종류별 표면(배경·글자색)과 부품 스타일을 정한다.
// 카드뉴스(cards.js)와 릴스(reel.js)가 같은 테마를 쓰므로 템플릿을 바꾸면 두 매체가 함께 바뀐다.

export const TEMPLATE_NAMES = ['bold', 'clean', 'pop'];

export const TEMPLATE_LABELS = {
  bold: '볼드 — 네이비 표지 + 크림 본문 (기본)',
  clean: '클린 — 흰 배경 미니멀',
  pop: '팝 — 노랑 배경 + 굵은 테두리',
};

const HERO_KINDS = new Set(['cover', 'cta']);

export function resolveTheme(name, colors) {
  const c = colors;
  const WHITE = '#FFFFFF';
  const heroDark = { bg: c.dark, fg: c.light, sub: c.accent, emphasis: c.accent };
  switch (name) {
    case 'bold':
      return {
        name,
        surface: (kind) => (HERO_KINDS.has(kind) ? heroDark : { bg: c.light, fg: c.dark, sub: c.muted, emphasis: c.primary }),
        item: { bg: WHITE, fg: c.dark, border: 'none', shadow: '0 6px 0 rgba(27,31,59,0.08)' },
        dot: { bg: c.primary, fg: WHITE },
        tag: { bg: c.primary, fg: WHITE },
        btn: { bg: c.primary, fg: WHITE },
        bar: c.primary,
      };
    case 'clean':
      return {
        name,
        surface: () => ({ bg: WHITE, fg: c.dark, sub: c.muted, emphasis: c.primary }),
        item: { bg: '#F5F6FA', fg: c.dark, border: '3px solid #E4E6EF', shadow: 'none' },
        dot: { bg: c.dark, fg: WHITE },
        tag: { bg: c.dark, fg: WHITE },
        btn: { bg: c.dark, fg: WHITE },
        bar: c.dark,
      };
    case 'pop':
      return {
        name,
        surface: (kind) => (HERO_KINDS.has(kind) ? heroDark : { bg: c.accent, fg: c.dark, sub: c.dark, emphasis: c.dark }),
        item: { bg: WHITE, fg: c.dark, border: `4px solid ${c.dark}`, shadow: `8px 8px 0 ${c.dark}` },
        dot: { bg: c.dark, fg: c.accent },
        tag: { bg: c.accent, fg: c.dark },
        btn: { bg: c.accent, fg: c.dark },
        bar: c.primary,
      };
    default:
      throw new Error(`알 수 없는 템플릿: ${name} (사용 가능: ${TEMPLATE_NAMES.join(', ')})`);
  }
}

// WCAG 명도 대비. 테스트에서 모든 템플릿의 글자/배경 조합을 검사하는 데 쓴다.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── 표지 사진 ──
// 사진 위 글자가 어떤 사진에서도 읽히도록, 브랜드 dark 색 덮개를 위(옅게)→아래(짙게) 그라데이션으로 깐다.
// 글자는 카드 아래쪽(덮개 불투명도 PHOTO_TEXT_MIN_ALPHA 이상인 구간)에 배치한다.
export const PHOTO_TEXT_MIN_ALPHA = 0.72;
const PHOTO_STOPS = [
  [0, 0.2],
  [0.38, PHOTO_TEXT_MIN_ALPHA],
  [1, 0.9],
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (arr) => '#' + arr.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

export function photoOverlay(colors) {
  const [r, g, b] = rgb(colors.dark);
  return `linear-gradient(to bottom, ${PHOTO_STOPS.map(([pos, a]) => `rgba(${r},${g},${b},${a}) ${pos * 100}%`).join(', ')})`;
}

// 사진 표지는 템플릿과 관계없이 어두운 표면 규칙을 쓴다.
export function photoSurface(colors) {
  return { bg: colors.dark, fg: colors.light, sub: colors.accent, emphasis: colors.accent, tag: { bg: colors.accent, fg: colors.dark } };
}

// 알파 합성: 배경 위에 color를 alpha만큼 덮었을 때의 색
export function blend(color, under, alpha) {
  const c = rgb(color);
  const u = rgb(under);
  return toHex(c.map((v, i) => v * alpha + u[i] * (1 - alpha)));
}

// ── 회사 브랜드 색상 검사·보정 (판매용 앱: 고객이 넣은 색이 대비 기준을 못 넘을 수 있다) ──
const SLIDE_KINDS = ['cover', 'pain', 'promise', 'curriculum', 'benefits', 'cta'];

// 템플릿 하나에서 글자/배경으로 함께 쓰이는 색 조합 전체
export function themePairs(name, colors) {
  const t = resolveTheme(name, colors);
  const pairs = [
    ['item', t.item.fg, t.item.bg],
    ['dot', t.dot.fg, t.dot.bg],
    ['tag', t.tag.fg, t.tag.bg],
    ['btn', t.btn.fg, t.btn.bg],
  ];
  for (const kind of SLIDE_KINDS) {
    const sf = t.surface(kind);
    pairs.push([`${kind}.fg`, sf.fg, sf.bg], [`${kind}.sub`, sf.sub, sf.bg], [`${kind}.emphasis`, sf.emphasis, sf.bg]);
  }
  return pairs;
}

export const MIN_CONTRAST = 3;
const DARKEN = new Set(['dark', 'primary', 'muted']); // 어둡게 보정할 역할
const mix = (hex, to, amount) => blend(to, hex, amount);

// 모든 템플릿에서 대비 3:1을 넘을 때까지 색을 조금씩 조정한다.
// 어두운 역할(dark·primary·muted)은 검정 쪽으로, 밝은 역할(light·accent)은 흰색 쪽으로 옮긴다.
export function fitColors(colors) {
  const out = { ...colors };
  for (let step = 0; step < 60; step++) {
    const failing = TEMPLATE_NAMES.flatMap((n) => themePairs(n, out)).filter(([, fg, bg]) => contrast(fg, bg) < MIN_CONTRAST);
    if (!failing.length) break;
    const roles = new Set();
    for (const [, fg, bg] of failing) for (const [role, v] of Object.entries(out)) if (v === fg || v === bg) roles.add(role);
    for (const role of roles) out[role] = mix(out[role], DARKEN.has(role) ? '#000000' : '#FFFFFF', 0.06);
  }
  const changed = Object.keys(colors).filter((k) => colors[k].toUpperCase() !== out[k].toUpperCase());
  return { colors: out, changed };
}
