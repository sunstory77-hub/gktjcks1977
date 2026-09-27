// 카드뉴스 렌더러: 슬라이드 구성 → 1080×1350 PNG (Satori → SVG → resvg).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/public/static');

export const CARD_W = 1080;
export const CARD_H = 1350;

function loadFonts() {
  return [
    [400, 'Regular'],
    [600, 'SemiBold'],
    [700, 'Bold'],
    [800, 'ExtraBold'],
  ].map(([weight, file]) => ({
    name: 'Pretendard',
    data: fs.readFileSync(path.join(FONT_DIR, `Pretendard-${file}.otf`)),
    weight,
    style: 'normal',
  }));
}

// Satori 요소 헬퍼. 자식이 여럿인 div는 display:flex가 필수다.
const h = (style, ...children) => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.flat() },
});
const lines = (text, style) =>
  h({ flexDirection: 'column', ...style }, ...String(text).split('\n').map((t) => h({}, t)));

function frame(c, page, total, handle, body, { dark = false } = {}) {
  const bg = dark ? c.dark : c.light;
  const fg = dark ? c.light : c.dark;
  return h(
    { width: CARD_W, height: CARD_H, flexDirection: 'column', backgroundColor: bg, color: fg, fontFamily: 'Pretendard', padding: 96 },
    h({ width: 120, height: 14, backgroundColor: c.primary, borderRadius: 7 }),
    h({ flex: 1, flexDirection: 'column', justifyContent: 'center' }, body),
    h(
      { justifyContent: 'space-between', fontSize: 30, fontWeight: 600, color: dark ? c.accent : c.muted },
      h({}, handle),
      h({}, `${page} / ${total}`),
    ),
  );
}

const heading = (text, c, extra = {}) =>
  lines(text, { fontSize: 76, fontWeight: 800, lineHeight: 1.25, letterSpacing: -2, marginBottom: 56, ...extra });

function bulletList(items, c, marker) {
  return h(
    { flexDirection: 'column', gap: 32 },
    items.map((t, i) =>
      h(
        { alignItems: 'center', gap: 28, backgroundColor: '#FFFFFF', borderRadius: 28, padding: '36px 40px', boxShadow: '0 6px 0 rgba(27,31,59,0.08)' },
        h(
          { width: 64, height: 64, borderRadius: 32, backgroundColor: c.primary, color: '#FFFFFF', fontSize: 34, fontWeight: 800, alignItems: 'center', justifyContent: 'center' },
          marker(i),
        ),
        h({ fontSize: 44, fontWeight: 700, color: c.dark, flex: 1 }, t),
      ),
    ),
  );
}

function slideBody(s, c) {
  switch (s.kind) {
    case 'cover':
      return h(
        { flexDirection: 'column' },
        s.tag ? h({ alignSelf: 'flex-start', backgroundColor: c.primary, color: '#FFFFFF', fontSize: 36, fontWeight: 700, padding: '14px 32px', borderRadius: 40, marginBottom: 48 }, s.tag) : [],
        lines(s.title, { fontSize: 112, fontWeight: 800, lineHeight: 1.15, letterSpacing: -4, color: c.light }),
        s.subtitle ? h({ fontSize: 56, fontWeight: 700, color: c.accent, marginTop: 40 }, s.subtitle) : [],
        h({ fontSize: 40, fontWeight: 600, color: c.light, marginTop: 88, opacity: 0.85 }, `with ${s.instructor}`),
      );
    case 'pain':
      return h({ flexDirection: 'column' }, heading(s.heading, c), bulletList(s.items, c, () => '✓'));
    case 'promise':
      return h(
        { flexDirection: 'column' },
        h({ fontSize: 44, fontWeight: 700, color: c.primary, marginBottom: 40 }, '그래서 준비했습니다'),
        lines(s.heading, { fontSize: 92, fontWeight: 800, lineHeight: 1.25, letterSpacing: -3 }),
        s.target ? h({ marginTop: 72, fontSize: 40, fontWeight: 600, color: c.muted }, `추천 대상 · ${s.target}`) : [],
      );
    case 'curriculum':
      return h({ flexDirection: 'column' }, heading(s.heading, c), bulletList(s.items, c, (i) => String(i + 1)));
    case 'benefits':
      return h(
        { flexDirection: 'column' },
        heading(s.heading, c),
        bulletList(s.items, c, () => '★'),
        s.price ? h({ marginTop: 56, fontSize: 52, fontWeight: 800, color: c.primary }, s.price) : [],
      );
    case 'cta':
      return h(
        { flexDirection: 'column' },
        heading(s.heading, c, { color: c.light }),
        ...[['일시', s.date], ['장소', s.place], ['수강료', s.price]]
          .filter(([, v]) => v)
          .map(([k, v]) =>
            h(
              { gap: 32, fontSize: 44, marginBottom: 28, alignItems: 'center' },
              h({ width: 150, fontWeight: 600, color: c.accent }, k),
              h({ fontWeight: 700, color: c.light }, v),
            ),
          ),
        h(
          { marginTop: 72, alignSelf: 'flex-start', backgroundColor: c.primary, color: '#FFFFFF', fontSize: 48, fontWeight: 800, padding: '32px 56px', borderRadius: 60 },
          `${s.cta} →`,
        ),
      );
    default:
      throw new Error(`알 수 없는 슬라이드 종류: ${s.kind}`);
  }
}

export async function renderCards(slides, brand, handle, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const fonts = loadFonts();
  const c = brand.colors;
  const files = [];
  for (const [i, s] of slides.entries()) {
    const dark = s.kind === 'cover' || s.kind === 'cta';
    const tree = frame(c, i + 1, slides.length, handle, slideBody(s, c), { dark });
    const svg = await satori(tree, { width: CARD_W, height: CARD_H, fonts });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_W } }).render().asPng();
    const file = path.join(outDir, `card_${String(i + 1).padStart(2, '0')}_${s.kind}.png`);
    fs.writeFileSync(file, png);
    files.push(file);
  }
  return files;
}
