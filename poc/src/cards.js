// 카드뉴스 렌더러: 슬라이드 구성 → 1080×1350 PNG (Satori → SVG → resvg).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { resolveTheme, photoSurface, photoOverlay } from './templates.js';
import { imageDataUri } from './images.js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/public/static');

export const CARD_W = 1080;
export const CARD_H = 1350;

export function loadFonts() {
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
export const h = (style, ...children) => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.flat() },
});
export const lines = (text, style) =>
  h({ flexDirection: 'column', ...style }, ...String(text).split('\n').map((t) => h({}, t)));

// photo: 표지 사진 { src(data URI), overlay(그라데이션) } — 있으면 사진 위에 덮개를 깔고 글자를 아래쪽에 둔다.
function frame(t, s, page, total, handle, body, photo, logo, aiBadge) {
  const sf = photo ? photo.surface : t.surface(s.kind);
  const full = { position: 'absolute', top: 0, left: 0, width: CARD_W, height: CARD_H };
  return h(
    { width: CARD_W, height: CARD_H, flexDirection: 'column', backgroundColor: sf.bg, color: sf.fg, fontFamily: 'Pretendard', wordBreak: 'keep-all', padding: 96, position: 'relative' },
    photo ? [{ type: 'img', props: { src: photo.src, style: { ...full, objectFit: 'cover' } } }, h({ ...full, backgroundImage: photo.overlay })] : [],
    h({ width: 120, height: 14, backgroundColor: t.bar, borderRadius: 7 }),
    // 회사 로고: 표지·신청 카드 오른쪽 위 (가로 최대 240, 세로 72)
    logo ? [{ type: 'img', props: { src: logo, style: { position: 'absolute', top: 68, right: 96, maxWidth: 240, height: 72, objectFit: 'contain' } } }] : [],
    h({ flex: 1, flexDirection: 'column', justifyContent: photo ? 'flex-end' : 'center', paddingBottom: photo ? 56 : 0 }, body),
    h(
      { justifyContent: 'space-between', alignItems: 'center', fontSize: 30, fontWeight: 600, color: sf.sub },
      h({}, handle),
      aiBadge ? aiBadgeEl(sf.sub) : [],
      h({}, `${page} / ${total}`),
    ),
  );
}

// 사람이 보는 AI 생성 표시(인공지능기본법 대응). 기계 판독 표시는 ailabel.js
export const AI_BADGE_TEXT = 'AI 활용 제작';
export const aiBadgeEl = (color, size = 24) =>
  h({ fontSize: size, fontWeight: 600, color, border: `2px solid ${color}`, borderRadius: 999, padding: `${size * 0.2}px ${size * 0.7}px`, opacity: 0.85 }, AI_BADGE_TEXT);

const heading = (text, extra = {}) =>
  lines(text, { fontSize: 76, fontWeight: 800, lineHeight: 1.25, letterSpacing: -2, marginBottom: 56, ...extra });

function bulletList(items, t, marker) {
  const border = t.item.border === 'none' ? {} : { border: t.item.border };
  const shadow = t.item.shadow === 'none' ? {} : { boxShadow: t.item.shadow };
  return h(
    { flexDirection: 'column', gap: 32 },
    items.map((text, i) =>
      h(
        { alignItems: 'center', gap: 28, backgroundColor: t.item.bg, borderRadius: 28, padding: '36px 40px', ...border, ...shadow },
        h(
          { width: 64, height: 64, borderRadius: 32, backgroundColor: t.dot.bg, color: t.dot.fg, fontSize: 34, fontWeight: 800, alignItems: 'center', justifyContent: 'center' },
          marker(i),
        ),
        h({ fontSize: 44, fontWeight: 700, color: t.item.fg, flex: 1 }, text),
      ),
    ),
  );
}

function slideBody(s, t, photo) {
  const sf = photo ? photo.surface : t.surface(s.kind);
  const tag = photo ? photo.surface.tag : t.tag;
  switch (s.kind) {
    case 'cover':
      return h(
        { flexDirection: 'column' },
        s.tag ? h({ alignSelf: 'flex-start', backgroundColor: tag.bg, color: tag.fg, fontSize: 36, fontWeight: 700, padding: '14px 32px', borderRadius: 40, marginBottom: 48 }, s.tag) : [],
        lines(s.title, { fontSize: 112, fontWeight: 800, lineHeight: 1.15, letterSpacing: -4 }),
        s.subtitle ? h({ fontSize: 56, fontWeight: 700, color: sf.emphasis, marginTop: 40 }, s.subtitle) : [],
        s.by ?? s.instructor ? h({ fontSize: 40, fontWeight: 600, color: sf.sub, marginTop: 88 }, s.by ?? `with ${s.instructor}`) : [],
      );
    case 'pain':
      return h({ flexDirection: 'column' }, heading(s.heading), bulletList(s.items, t, () => '✓'));
    case 'promise':
      return h(
        { flexDirection: 'column' },
        h({ fontSize: 44, fontWeight: 700, color: sf.emphasis, marginBottom: 40 }, s.lead ?? '그래서 준비했습니다'),
        lines(s.heading, { fontSize: 92, fontWeight: 800, lineHeight: 1.25, letterSpacing: -3 }),
        s.target ? h({ marginTop: 72, fontSize: 40, fontWeight: 600, color: sf.sub }, `${s.targetLabel ?? '추천 대상'} · ${s.target}`) : [],
      );
    case 'curriculum':
      return h({ flexDirection: 'column' }, heading(s.heading), bulletList(s.items, t, (i) => String(i + 1)));
    case 'benefits':
      return h(
        { flexDirection: 'column' },
        heading(s.heading),
        bulletList(s.items, t, () => '★'),
        s.price ? h({ marginTop: 56, fontSize: 52, fontWeight: 800, color: sf.emphasis }, s.price) : [],
      );
    case 'cta':
      return h(
        { flexDirection: 'column' },
        heading(s.heading),
        ...(s.rows ?? [['일시', s.date], ['장소', s.place], ['수강료', s.price]])
          .filter(([, v]) => v)
          .map(([k, v]) =>
            h(
              { gap: 32, fontSize: 44, marginBottom: 28, alignItems: 'center' },
              h({ width: 210, fontWeight: 600, color: sf.sub }, k),
              h({ fontWeight: 700 }, v),
            ),
          ),
        h(
          { marginTop: 72, alignSelf: 'flex-start', backgroundColor: t.btn.bg, color: t.btn.fg, fontSize: 48, fontWeight: 800, padding: '32px 56px', borderRadius: 60 },
          `${s.cta} →`,
        ),
      );
    default:
      throw new Error(`알 수 없는 슬라이드 종류: ${s.kind}`);
  }
}

// opts.coverImage: 정규화된 표지 사진(JPEG) 경로. 표지(1장)에만 쓴다.
// 카드 1장 → SVG. embedFont:false면 글자가 <text>로 남아 테스트에서 줄바꿈을 확인할 수 있다.
export async function cardSvg(s, i, total, { t, handle, photo, logo, aiBadge, fonts = loadFonts(), embedFont = true }) {
  const tree = frame(t, s, i + 1, total, handle, slideBody(s, t, photo), photo, ['cover', 'cta'].includes(s.kind) ? logo : undefined, aiBadge);
  return satori(tree, { width: CARD_W, height: CARD_H, fonts, embedFont });
}

export async function renderCards(slides, brand, handle, outDir, template = 'bold', { coverImage, logo, aiBadge = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const fonts = loadFonts();
  const t = resolveTheme(template, brand.colors);
  const photo = coverImage
    ? { src: imageDataUri(coverImage), overlay: photoOverlay(brand.colors), surface: photoSurface(brand.colors) }
    : undefined;
  const logoUri = logo ? imageDataUri(logo) : undefined;
  const files = [];
  for (const [i, s] of slides.entries()) {
    const svg = await cardSvg(s, i, slides.length, { t, handle, photo: s.kind === 'cover' ? photo : undefined, logo: logoUri, aiBadge, fonts });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_W } }).render().asPng();
    const file = path.join(outDir, `card_${String(i + 1).padStart(2, '0')}_${s.kind}.png`);
    fs.writeFileSync(file, png);
    files.push(file);
  }
  return files;
}
