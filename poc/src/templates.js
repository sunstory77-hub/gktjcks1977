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
