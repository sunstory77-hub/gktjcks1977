// 릴스 렌더러: 슬라이드 구성 → HyperFrames HTML 컴포지션(1080×1920, 15초) → MP4.
// 카드뉴스와 같은 슬라이드·브랜드킷을 쓰고, 장면 5개를 GSAP 타임라인으로 연결한다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { toolEnv } from './env.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REEL_DIR = path.join(ROOT, 'reel');
export const REEL_W = 1080;
export const REEL_H = 1920;

// 장면 타이밍(초). 합계가 릴스 길이가 된다.
export const SCENES = [
  { kind: 'pain', dur: 3 },
  { kind: 'cover', dur: 3 },
  { kind: 'curriculum', dur: 3.5 },
  { kind: 'benefits', dur: 3 },
  { kind: 'cta', dur: 2.5 },
];
export const REEL_DURATION = SCENES.reduce((a, s) => a + s.dur, 0);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const br = (s) => esc(s).replace(/\n/g, '<br>');

function sceneHtml(s, id) {
  const list = (items, marker) =>
    items.map((t, i) => `<li class="item"><span class="dot">${marker(i)}</span><span>${esc(t)}</span></li>`).join('');
  switch (s.kind) {
    case 'pain':
      return `<h2 class="head">${esc(s.heading)}</h2><ul class="list">${list(s.items, () => '✓')}</ul>`;
    case 'cover':
      return `${s.tag ? `<div class="tag">${esc(s.tag)}</div>` : ''}<h1 class="title">${br(s.title)}</h1>${
        s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ''
      }<p class="by">with ${esc(s.instructor)}</p>`;
    case 'curriculum':
      return `<h2 class="head">${esc(s.heading)}</h2><ul class="list">${list(s.items, (i) => i + 1)}</ul>`;
    case 'benefits':
      return `<h2 class="head">${esc(s.heading)}</h2><ul class="list">${list(s.items, () => '★')}</ul>${
        s.price ? `<p class="price">${esc(s.price)}</p>` : ''
      }`;
    case 'cta':
      return `<h2 class="head">${esc(s.heading)}</h2><dl class="info">${[
        ['일시', s.date],
        ['장소', s.place],
        ['수강료', s.price],
      ]
        .filter(([, v]) => v)
        .map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
        .join('')}</dl><div class="btn">${esc(s.cta)} →</div>`;
    default:
      throw new Error(`릴스에서 지원하지 않는 장면: ${s.kind} (${id})`);
  }
}

export function buildReelHtml(slides, brand, handle) {
  const c = brand.colors;
  const byKind = Object.fromEntries(slides.map((s) => [s.kind, s]));
  let t = 0;
  const scenes = SCENES.map(({ kind, dur }, i) => {
    const s = byKind[kind];
    if (!s) throw new Error(`슬라이드 구성에 '${kind}' 장면이 없습니다`);
    const scene = { id: `s${i + 1}`, kind, start: t, dur, dark: kind === 'cover' || kind === 'cta', html: sceneHtml(s, `s${i + 1}`) };
    t += dur;
    return scene;
  });

  // 장면마다: 들어올 때 제목·항목 순차 등장, 나갈 때 페이드아웃(마지막 장면 제외).
  const anim = scenes
    .map((s, i) => {
      const last = i === scenes.length - 1;
      return [
        `tl.fromTo("#${s.id} .anim", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.18 }, ${s.start + 0.1});`,
        last ? '' : `tl.to("#${s.id} .wrap", { opacity: 0, y: -40, duration: 0.3, ease: "power2.in" }, ${(s.start + s.dur - 0.3).toFixed(2)});`,
      ].join('\n      ');
    })
    .join('\n      ');

  const font = (w, f) =>
    `@font-face { font-family: "Pretendard"; font-weight: ${w}; src: url("assets/fonts/Pretendard-${f}.otf") format("opentype"); }`;

  return `<!doctype html>
<!-- 자동 생성 파일: src/reel.js가 매 렌더마다 덮어쓴다. 직접 수정하지 말 것. -->
<html lang="ko" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${REEL_W}, height=${REEL_H}" />
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      ${font(600, 'SemiBold')}
      ${font(700, 'Bold')}
      ${font(800, 'ExtraBold')}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${REEL_W}px; height: ${REEL_H}px; overflow: hidden; background: ${c.light}; }
      #root { position: relative; width: 100%; height: 100%; font-family: "Pretendard", sans-serif; }
      .scene { position: absolute; inset: 0; padding: 150px 96px; display: flex; flex-direction: column; justify-content: center; background: ${c.light}; color: ${c.dark}; }
      .scene.dark { background: ${c.dark}; color: ${c.light}; }
      .wrap { display: flex; flex-direction: column; }
      .bar { position: absolute; top: 150px; left: 96px; width: 140px; height: 16px; border-radius: 8px; background: ${c.primary}; }
      .foot { position: absolute; bottom: 130px; left: 96px; font-size: 36px; font-weight: 600; color: ${c.muted}; }
      .dark .foot { color: ${c.accent}; }
      .head { font-size: 92px; font-weight: 800; line-height: 1.25; letter-spacing: -2px; margin-bottom: 72px; }
      .list { list-style: none; display: flex; flex-direction: column; gap: 36px; }
      .item { display: flex; align-items: center; gap: 32px; background: #fff; color: ${c.dark}; border-radius: 32px; padding: 44px 44px; font-size: 52px; font-weight: 700; box-shadow: 0 8px 0 rgba(27,31,59,0.08); }
      .dot { flex: none; width: 80px; height: 80px; border-radius: 40px; background: ${c.primary}; color: #fff; font-size: 42px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      .tag { align-self: flex-start; background: ${c.primary}; color: #fff; font-size: 44px; font-weight: 700; padding: 18px 40px; border-radius: 48px; margin-bottom: 56px; }
      .title { font-size: 136px; font-weight: 800; line-height: 1.15; letter-spacing: -5px; }
      .sub { font-size: 68px; font-weight: 700; color: ${c.accent}; margin-top: 48px; }
      .by { font-size: 48px; font-weight: 600; margin-top: 96px; opacity: 0.85; }
      .price { font-size: 64px; font-weight: 800; color: ${c.primary}; margin-top: 64px; }
      .info { display: flex; flex-direction: column; gap: 36px; }
      .row { display: flex; gap: 40px; font-size: 52px; }
      .row dt { width: 180px; font-weight: 600; color: ${c.accent}; }
      .row dd { font-weight: 700; }
      .btn { align-self: flex-start; margin-top: 96px; background: ${c.primary}; color: #fff; font-size: 56px; font-weight: 800; padding: 40px 64px; border-radius: 72px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${REEL_DURATION}" data-width="${REEL_W}" data-height="${REEL_H}">
${scenes
  .map(
    (s, i) => `      <section id="${s.id}" class="clip scene${s.dark ? ' dark' : ''}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="0">
        <div class="bar"></div>
        <div class="wrap">${s.html.replace(/class="(head|title|tag|sub|by|price|item|row|btn)"/g, 'class="$1 anim"')}</div>
        <div class="foot">${esc(handle)}</div>
      </section>`,
  )
  .join('\n')}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${anim}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

function copyAssets() {
  const fontDir = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/public/static');
  const dest = path.join(REEL_DIR, 'assets');
  fs.mkdirSync(path.join(dest, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'vendor'), { recursive: true });
  for (const f of ['SemiBold', 'Bold', 'ExtraBold']) {
    fs.copyFileSync(path.join(fontDir, `Pretendard-${f}.otf`), path.join(dest, 'fonts', `Pretendard-${f}.otf`));
  }
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(dest, 'vendor', 'gsap.min.js'));
}

export function writeReelProject(slides, brand, handle) {
  copyAssets();
  fs.writeFileSync(path.join(REEL_DIR, 'index.html'), buildReelHtml(slides, brand, handle));
}

export async function renderReel(slides, brand, handle, outFile) {
  writeReelProject(slides, brand, handle);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const cli = path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs');
  execFileSync(process.execPath, [cli, 'render', '--quiet', '--output', outFile], { cwd: REEL_DIR, env: toolEnv(), stdio: 'inherit' });
  return outFile;
}
