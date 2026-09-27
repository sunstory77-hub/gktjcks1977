// 릴스 렌더러: 슬라이드 구성 → HyperFrames 프로젝트(1080×1920, 15초) → MP4.
// 장면마다 서브 컴포지션 파일(compositions/sN.html)을 만들고, index.html이 순서대로 불러온다.
// 카드뉴스와 같은 슬라이드·템플릿을 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { toolEnv } from './env.js';
import { resolveTheme } from './templates.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REEL_DIR = path.join(ROOT, 'reel');
export const REEL_W = 1080;
export const REEL_H = 1920;
const BGM_VOLUME = 0.5;

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

function sceneMarkup(s) {
  const list = (items, marker) =>
    items.map((t, i) => `<li class="item anim"><span class="dot">${marker(i)}</span><span>${esc(t)}</span></li>`).join('');
  switch (s.kind) {
    case 'pain':
      return `<h2 class="head anim">${esc(s.heading)}</h2><ul class="list">${list(s.items, () => '✓')}</ul>`;
    case 'cover':
      return `${s.tag ? `<div class="tag anim">${esc(s.tag)}</div>` : ''}<h1 class="title anim">${br(s.title)}</h1>${
        s.subtitle ? `<p class="sub anim">${esc(s.subtitle)}</p>` : ''
      }<p class="by anim">with ${esc(s.instructor)}</p>`;
    case 'curriculum':
      return `<h2 class="head anim">${esc(s.heading)}</h2><ul class="list">${list(s.items, (i) => i + 1)}</ul>`;
    case 'benefits':
      return `<h2 class="head anim">${esc(s.heading)}</h2><ul class="list">${list(s.items, () => '★')}</ul>${
        s.price ? `<p class="price anim">${esc(s.price)}</p>` : ''
      }`;
    case 'cta':
      return `<h2 class="head anim">${esc(s.heading)}</h2><dl class="info">${[
        ['일시', s.date],
        ['장소', s.place],
        ['수강료', s.price],
      ]
        .filter(([, v]) => v)
        .map(([k, v]) => `<div class="row anim"><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
        .join('')}</dl><div class="btn anim">${esc(s.cta)} →</div>`;
    default:
      throw new Error(`릴스에서 지원하지 않는 장면: ${s.kind}`);
  }
}

// 서브 컴포지션: 장면 하나. 타임라인 시간은 장면 시작 기준(0초부터)이다.
export function buildSceneHtml(scene, slide, theme, handle, isLast) {
  const sf = theme.surface(slide.kind);
  const sel = `[data-composition-id="${scene.id}"]`;
  const exit = isLast
    ? ''
    : `tl.to('${sel} .wrap', { opacity: 0, y: -40, duration: 0.3, ease: "power2.in" }, ${(scene.dur - 0.3).toFixed(2)});`;
  return `<!-- 자동 생성 파일: src/reel.js가 매 렌더마다 덮어쓴다. -->
<template id="${scene.id}-template">
  <div data-composition-id="${scene.id}" data-width="${REEL_W}" data-height="${REEL_H}" data-duration="${scene.dur}">
    <section class="scene" style="background:${sf.bg};color:${sf.fg}">
      <div class="bar"></div>
      <div class="wrap">${sceneMarkup(slide)}</div>
      <div class="foot">${esc(handle)}</div>
    </section>
    <style>
      ${sel} .foot, ${sel} .row dt, ${sel} .by { color: ${sf.sub}; }
      ${sel} .sub, ${sel} .price { color: ${sf.emphasis}; }
    </style>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        tl.fromTo('${sel} .anim', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.18 }, 0.1);
        ${exit}
        window.__timelines = window.__timelines || {};
        window.__timelines["${scene.id}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

export function planScenes(slides) {
  const byKind = Object.fromEntries(slides.map((s) => [s.kind, s]));
  let t = 0;
  return SCENES.map(({ kind, dur }, i) => {
    if (!byKind[kind]) throw new Error(`슬라이드 구성에 '${kind}' 장면이 없습니다`);
    const scene = { id: `s${i + 1}`, kind, start: t, dur, slide: byKind[kind] };
    t += dur;
    return scene;
  });
}

// 루트 컴포지션: 공통 스타일·폰트 + 장면 마운트 + (선택) 배경음악.
export function buildIndexHtml(scenes, theme, { bgmSrc } = {}) {
  const font = (w, f) =>
    `@font-face { font-family: "Pretendard"; font-weight: ${w}; src: url("assets/fonts/Pretendard-${f}.otf") format("opentype"); }`;
  const border = theme.item.border === 'none' ? '' : `border: ${theme.item.border};`;
  const shadow = theme.item.shadow === 'none' ? '' : `box-shadow: ${theme.item.shadow};`;
  const mounts = scenes
    .map(
      (s, i) =>
        `      <div id="${s.id}-host" class="clip scene-host" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="${i}"></div>`,
    )
    .join('\n');
  const audio = bgmSrc
    ? `\n      <audio id="bgm" src="${esc(bgmSrc)}" data-start="0" data-duration="${REEL_DURATION}" data-volume="${BGM_VOLUME}" data-fade-in="0.5" data-fade-out="1.5" data-track-index="${scenes.length}"></audio>`
    : '';
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
      html, body { width: ${REEL_W}px; height: ${REEL_H}px; overflow: hidden; background: ${theme.surface('pain').bg}; }
      #root { position: relative; width: 100%; height: 100%; font-family: "Pretendard", sans-serif; }
      .scene-host { position: absolute; inset: 0; }
      .scene { position: absolute; inset: 0; padding: 150px 96px; display: flex; flex-direction: column; justify-content: center; }
      .wrap { display: flex; flex-direction: column; }
      .bar { position: absolute; top: 150px; left: 96px; width: 140px; height: 16px; border-radius: 8px; background: ${theme.bar}; }
      .foot { position: absolute; bottom: 130px; left: 96px; font-size: 36px; font-weight: 600; }
      .head { font-size: 92px; font-weight: 800; line-height: 1.25; letter-spacing: -2px; margin-bottom: 72px; }
      .list { list-style: none; display: flex; flex-direction: column; gap: 36px; }
      .item { display: flex; align-items: center; gap: 32px; background: ${theme.item.bg}; color: ${theme.item.fg}; border-radius: 32px; padding: 44px; font-size: 52px; font-weight: 700; ${border} ${shadow} }
      .dot { flex: none; width: 80px; height: 80px; border-radius: 40px; background: ${theme.dot.bg}; color: ${theme.dot.fg}; font-size: 42px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      .tag { align-self: flex-start; background: ${theme.tag.bg}; color: ${theme.tag.fg}; font-size: 44px; font-weight: 700; padding: 18px 40px; border-radius: 48px; margin-bottom: 56px; }
      .title { font-size: 136px; font-weight: 800; line-height: 1.15; letter-spacing: -5px; }
      .sub { font-size: 68px; font-weight: 700; margin-top: 48px; }
      .by { font-size: 48px; font-weight: 600; margin-top: 96px; }
      .price { font-size: 64px; font-weight: 800; margin-top: 64px; }
      .info { display: flex; flex-direction: column; gap: 36px; }
      .row { display: flex; gap: 40px; font-size: 52px; }
      .row dt { width: 180px; font-weight: 600; }
      .row dd { font-weight: 700; }
      .btn { align-self: flex-start; margin-top: 96px; background: ${theme.btn.bg}; color: ${theme.btn.fg}; font-size: 56px; font-weight: 800; padding: 40px 64px; border-radius: 72px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${REEL_DURATION}" data-width="${REEL_W}" data-height="${REEL_H}">
${mounts}${audio}
      <script>
        const tl = gsap.timeline({ paused: true });
        window.__timelines = window.__timelines || {};
        window.__timelines["main"] = tl;
      </script>
    </div>
  </body>
</html>
`;
}

const PROJECT_CONFIG_FILES = ['hyperframes.json', 'meta.json'];

function copyAssets(projectDir, bgmFile) {
  const fontDir = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/public/static');
  const dest = path.join(projectDir, 'assets');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'vendor'), { recursive: true });
  for (const f of ['SemiBold', 'Bold', 'ExtraBold']) {
    fs.copyFileSync(path.join(fontDir, `Pretendard-${f}.otf`), path.join(dest, 'fonts', `Pretendard-${f}.otf`));
  }
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(dest, 'vendor', 'gsap.min.js'));
  if (!bgmFile) return undefined;
  if (!fs.existsSync(bgmFile)) throw new Error(`배경음악 파일이 없습니다: ${bgmFile}`);
  fs.mkdirSync(path.join(dest, 'audio'), { recursive: true });
  const rel = `assets/audio/bgm${path.extname(bgmFile).toLowerCase()}`;
  fs.copyFileSync(bgmFile, path.join(projectDir, rel));
  return rel;
}

// projectDir: HyperFrames 프로젝트 폴더. 기본은 poc/reel, 웹 서버는 작업(job)마다 별도 폴더를 쓴다.
export function writeReelProject(slides, brand, handle, { template = 'bold', bgm, projectDir = REEL_DIR } = {}) {
  const theme = resolveTheme(template, brand.colors);
  const scenes = planScenes(slides);
  fs.mkdirSync(projectDir, { recursive: true });
  if (projectDir !== REEL_DIR) {
    for (const f of PROJECT_CONFIG_FILES) fs.copyFileSync(path.join(REEL_DIR, f), path.join(projectDir, f));
  }
  const bgmSrc = copyAssets(projectDir, bgm);
  const compDir = path.join(projectDir, 'compositions');
  fs.rmSync(compDir, { recursive: true, force: true });
  fs.mkdirSync(compDir, { recursive: true });
  scenes.forEach((s, i) =>
    fs.writeFileSync(path.join(compDir, `${s.id}.html`), buildSceneHtml(s, s.slide, theme, handle, i === scenes.length - 1)),
  );
  fs.writeFileSync(path.join(projectDir, 'index.html'), buildIndexHtml(scenes, theme, { bgmSrc }));
}

const execFileAsync = promisify(execFile);

// 비동기 렌더: 웹 서버의 이벤트 루프를 막지 않는다. quiet=false면 진행 로그를 터미널에 그대로 보여준다.
export async function renderReel(slides, brand, handle, outFile, opts = {}) {
  const projectDir = opts.projectDir ?? REEL_DIR;
  writeReelProject(slides, brand, handle, { ...opts, projectDir });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const cli = path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs');
  const child = execFileAsync(process.execPath, [cli, 'render', '--quiet', '--output', outFile], {
    cwd: projectDir,
    env: toolEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (opts.verbose) {
    child.child.stdout.pipe(process.stdout);
    child.child.stderr.pipe(process.stderr);
  }
  try {
    await child;
  } catch (err) {
    const tail = String(err.stderr || err.stdout || err.message).trim().split('\n').slice(-5).join('\n');
    throw new Error(`릴스 렌더 실패: ${tail}`);
  }
  if (!fs.existsSync(outFile)) throw new Error('릴스 렌더 결과 파일이 없습니다');
  return outFile;
}
