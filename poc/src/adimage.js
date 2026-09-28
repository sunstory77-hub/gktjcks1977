// 인스타그램 광고 이미지: 1:1(피드) · 4:5(피드 세로) · 9:16(스토리·릴스) 3종.
// 글자는 적게(큰 문구 1줄 + 보조 1줄 + 버튼), 사진이 있으면 배경으로 깐다.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { h, lines, loadFonts, aiBadgeEl } from './cards.js';
import { resolveTheme, photoOverlay, photoSurface } from './templates.js';
import { imageDataUri } from './images.js';

// 스토리는 위·아래가 인스타 화면 요소(프로필·답장창)에 가려지므로 여백을 크게 둔다 [기준: 2026-09 / 확인 필요]
export const AD_SIZES = {
  square: { w: 1080, h: 1080, pad: [80, 80, 80, 80], title: 96, label: '1:1 피드' },
  portrait: { w: 1080, h: 1350, pad: [96, 88, 96, 88], title: 104, label: '4:5 피드' },
  story: { w: 1080, h: 1920, pad: [260, 88, 360, 88], title: 112, label: '9:16 스토리' },
};

function adTree({ size, ad, facts, t, photo, logo, aiBadge }) {
  const { w, h: H, pad, title } = AD_SIZES[size];
  const sf = photo ? photoSurface(photo.colors) : t.surface('cover');
  const btn = photo ? { bg: photo.colors.accent, fg: photo.colors.dark } : t.btn;
  const full = { position: 'absolute', top: 0, left: 0, width: w, height: H };
  return h(
    { width: w, height: H, flexDirection: 'column', backgroundColor: sf.bg, color: sf.fg, fontFamily: 'Pretendard', wordBreak: 'keep-all', padding: `${pad[0]}px ${pad[1]}px ${pad[2]}px ${pad[3]}px`, position: 'relative' },
    photo ? [{ type: 'img', props: { src: photo.src, style: { ...full, objectFit: 'cover' } } }, h({ ...full, backgroundImage: photo.overlay })] : [],
    h(
      { justifyContent: 'space-between', alignItems: 'center', height: 72 },
      logo ? { type: 'img', props: { src: logo, style: { maxWidth: 260, height: 72, objectFit: 'contain' } } } : h({}),
      aiBadge ? aiBadgeEl(sf.sub, 26) : [],
    ),
    h(
      // 사진이 있으면 글자를 아래(덮개가 짙은 곳)에, 없으면 가운데에
      { flex: 1, flexDirection: 'column', justifyContent: photo ? 'flex-end' : 'center' },
      lines(ad.overlay, { fontSize: title, fontWeight: 800, lineHeight: 1.15, letterSpacing: -3 }),
      ad.overlaySub ? h({ fontSize: Math.round(title * 0.46), fontWeight: 700, color: sf.emphasis, marginTop: 32 }, ad.overlaySub) : [],
      h(
        { marginTop: 56, alignSelf: 'flex-start', backgroundColor: btn.bg, color: btn.fg, fontSize: 44, fontWeight: 800, padding: '28px 52px', borderRadius: 60 },
        `${facts.cta} →`,
      ),
    ),
  );
}

// ad: { overlay, overlaySub }, 반환: 파일 경로 3개 { square, portrait, story }
export async function renderAdImages(ad, facts, brand, outDir, template = 'bold', { coverImage, logo, aiBadge = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const fonts = loadFonts();
  const t = resolveTheme(template, brand.colors);
  const photo = coverImage ? { src: imageDataUri(coverImage), overlay: photoOverlay(brand.colors), colors: brand.colors } : undefined;
  const logoUri = logo ? imageDataUri(logo) : undefined;
  const files = {};
  for (const size of Object.keys(AD_SIZES)) {
    const { w, h: H } = AD_SIZES[size];
    const svg = await satori(adTree({ size, ad, facts, t, photo, logo: logoUri, aiBadge }), { width: w, height: H, fonts });
    const file = path.join(outDir, `ad_${size}.png`);
    fs.writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng());
    files[size] = file;
  }
  return files;
}
