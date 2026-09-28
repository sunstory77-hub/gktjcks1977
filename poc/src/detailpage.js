// 상세페이지: 가로 860px, 6블록(문제공감 → 핵심가치 → 특징 → 근거 → FAQ → 신청)을 블록별 PNG로 만든다.
// 스마트스토어 권장 가로 860px, 이미지 1장 세로 5,000px 이하 [기준: 2026-09 / 확인 필요]
// 세로 길이는 내용에 맞춰 자동(Satori 높이 자동 계산).
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { h, lines, loadFonts, aiBadgeEl } from './cards.js';
import { photoOverlay, photoSurface } from './templates.js';
import { imageDataUri } from './images.js';

export const DETAIL_W = 860;
export const MAX_BLOCK_H = 5000;
const PAD = 64;
const WHITE = '#FFFFFF';

const title = (text, color, extra = {}) => lines(text, { fontSize: 52, fontWeight: 800, lineHeight: 1.3, letterSpacing: -1.5, color, ...extra });
// 문단은 단어(공백 단위) 상자를 줄바꿈 배치한다. 단어 안에서는 끊기지 않으므로 "10:00–12:00" 같은 사실 값이 쪼개지지 않는다.
const flowLine = (line, size) =>
  h({ flexWrap: 'wrap', columnGap: Math.round(size * 0.28) }, ...line.split(/\s+/).filter(Boolean).map((w) => h({}, w)));
export const para = (text, color, extra = {}) => {
  const size = extra.fontSize ?? 30;
  return h({ flexDirection: 'column', gap: 10, fontSize: 30, lineHeight: 1.6, color, ...extra }, ...String(text).split('\n').filter(Boolean).map((l) => flowLine(l, size)));
};
const eyebrow = (text, color) => h({ fontSize: 26, fontWeight: 800, color, letterSpacing: 2, marginBottom: 18 }, text);
const block = (bg, ...children) => h({ width: DETAIL_W, flexDirection: 'column', backgroundColor: bg, padding: `${PAD + 16}px ${PAD}px`, fontFamily: 'Pretendard', wordBreak: 'keep-all' }, ...children);

function blocks(d, facts, c, { photo, logo, aiBadge }) {
  const light = { bg: c.light, fg: c.dark, sub: c.muted, em: c.primary };
  const dark = { bg: c.dark, fg: c.light, sub: c.accent, em: c.accent };
  const card = (children, extra = {}) => h({ flexDirection: 'column', backgroundColor: WHITE, borderRadius: 24, padding: '36px 40px', boxShadow: '0 6px 0 rgba(27,31,59,0.08)', ...extra }, ...children);

  // ① 표지 + 문제공감
  const heroH = 900;
  const hs = photo ? photoSurface(c) : dark;
  const hero = h(
    { width: DETAIL_W, height: heroH, flexDirection: 'column', justifyContent: 'flex-end', padding: PAD, backgroundColor: hs.bg, color: hs.fg, position: 'relative' },
    photo ? [{ type: 'img', props: { src: photo.src, style: { position: 'absolute', top: 0, left: 0, width: DETAIL_W, height: heroH, objectFit: 'cover' } } }, h({ position: 'absolute', top: 0, left: 0, width: DETAIL_W, height: heroH, backgroundImage: photo.overlay })] : [],
    logo ? [{ type: 'img', props: { src: logo, style: { position: 'absolute', top: PAD, left: PAD, maxWidth: 220, height: 60, objectFit: 'contain' } } }] : [],
    aiBadge ? h({ position: 'absolute', top: PAD + 10, right: PAD }, aiBadgeEl(hs.sub, 22)) : [],
    facts.tag ? h({ alignSelf: 'flex-start', backgroundColor: c.accent, color: c.dark, fontSize: 26, fontWeight: 700, padding: '10px 24px', borderRadius: 30, marginBottom: 28 }, facts.tag) : [],
    lines(facts.title, { fontSize: 76, fontWeight: 800, lineHeight: 1.18, letterSpacing: -2.5 }),
    facts.subtitle ? h({ fontSize: 38, fontWeight: 700, color: hs.sub, marginTop: 24 }, facts.subtitle) : [],
  );
  const hook = h(
    { flexDirection: 'column' },
    hero,
    block(light.bg, eyebrow('WHY', light.em), title(d.hook.title, light.fg, { marginBottom: 32 }), para(d.hook.body, light.fg)),
  );

  // ② 핵심가치
  const value = block(dark.bg, eyebrow('VALUE', dark.em), title(d.value.title, dark.fg, { marginBottom: 28 }), para(d.value.body, dark.fg, { opacity: 0.92 }));

  // ③ 특징 3개
  const features = block(
    light.bg,
    eyebrow('POINT', light.em),
    title('이렇게 달라집니다', light.fg, { marginBottom: 36 }),
    h(
      { flexDirection: 'column', gap: 24 },
      ...d.features.map((f, i) =>
        card([
          h({ alignItems: 'center', gap: 18, marginBottom: 12 }, h({ width: 52, height: 52, borderRadius: 26, backgroundColor: c.primary, color: WHITE, fontSize: 28, fontWeight: 800, alignItems: 'center', justifyContent: 'center' }, String(i + 1)), h({ fontSize: 36, fontWeight: 800, color: c.dark }, f.title)),
          para(f.body, c.dark, { fontSize: 28 }),
        ]),
      ),
    ),
  );

  // ④ 근거 (팩트 시트의 커리큘럼·혜택·강사)
  const proof = block(
    WHITE,
    eyebrow('PROOF', light.em),
    title(d.proof.title, c.dark, { marginBottom: 32 }),
    h(
      { flexDirection: 'column', gap: 18 },
      ...d.proof.items.map((t) => h({ alignItems: 'flex-start', gap: 18, fontSize: 30, color: c.dark, lineHeight: 1.5 }, h({ color: c.primary, fontWeight: 800 }, '✓'), h({ flex: 1, fontWeight: 600 }, t))),
    ),
  );

  // ⑤ FAQ
  const faq = block(
    light.bg,
    eyebrow('FAQ', light.em),
    title('자주 묻는 질문', light.fg, { marginBottom: 32 }),
    h({ flexDirection: 'column', gap: 20 }, ...d.faq.map((f) => card([h({ fontSize: 30, fontWeight: 800, color: c.dark, marginBottom: 10 }, `Q. ${f.q}`), para(`A. ${f.a}`, c.dark, { fontSize: 28 })]))),
  );

  // ⑥ 신청 (사실 정보는 팩트 시트 그대로)
  const rows = [['일시', facts.date], ['장소', facts.place], ['수강료', facts.price], ['강사', facts.instructor]].filter(([, v]) => v);
  const cta = block(
    dark.bg,
    eyebrow('JOIN', dark.em),
    title(d.cta.title, dark.fg, { marginBottom: 20 }),
    para(d.cta.body, dark.fg, { marginBottom: 36, opacity: 0.92 }),
    h({ flexDirection: 'column', gap: 16, marginBottom: 44 }, ...rows.map(([k, v]) => h({ gap: 24, fontSize: 32 }, h({ width: 110, fontWeight: 600, color: dark.sub }, k), h({ flex: 1, fontWeight: 700 }, v)))),
    h({ alignSelf: 'flex-start', backgroundColor: c.accent, color: c.dark, fontSize: 36, fontWeight: 800, padding: '26px 48px', borderRadius: 60 }, `${facts.cta} →`),
    facts.handle || aiBadge ? h({ justifyContent: 'space-between', alignItems: 'center', marginTop: 56, fontSize: 24, color: dark.sub }, h({}, facts.handle ?? ''), aiBadge ? aiBadgeEl(dark.sub, 20) : []) : [],
  );

  return [
    ['01_hook', hook],
    ['02_value', value],
    ['03_features', features],
    ['04_proof', proof],
    ['05_faq', faq],
    ['06_cta', cta],
  ];
}

// d: 상세페이지 문안(formats.js), 반환: 블록 PNG 경로 6개
export async function renderDetailPage(d, facts, brand, outDir, { coverImage, logo, aiBadge = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const fonts = loadFonts();
  const photo = coverImage ? { src: imageDataUri(coverImage), overlay: photoOverlay(brand.colors) } : undefined;
  const logoUri = logo ? imageDataUri(logo) : undefined;
  const files = [];
  for (const [name, tree] of blocks(d, facts, brand.colors, { photo, logo: logoUri, aiBadge })) {
    const svg = await satori(tree, { width: DETAIL_W, fonts });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: DETAIL_W } }).render();
    if (png.height > MAX_BLOCK_H) throw new Error(`상세페이지 ${name} 블록이 너무 깁니다 (${png.height}px, 최대 ${MAX_BLOCK_H}px)`);
    const file = path.join(outDir, `detail_${name}.png`);
    fs.writeFileSync(file, png.asPng());
    files.push(file);
  }
  return files;
}
