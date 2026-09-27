import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSlides } from '../src/content.js';
import { resolveTheme, photoSurface, photoOverlay } from '../src/templates.js';
import { planScenes, buildIndexHtml, buildSceneHtml, REEL_DURATION, SCENES } from '../src/reel.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));
const theme = resolveTheme('bold', brand.colors);

test('루트 컴포지션: 15초, 장면 5개를 이어 붙여 서브 컴포지션으로 마운트', () => {
  const scenes = planScenes(buildSlides(brief));
  const html = buildIndexHtml(scenes, theme);
  assert.equal(REEL_DURATION, 15);
  assert.match(html, /data-composition-id="main"[^>]*data-duration="15"/);
  let t = 0;
  SCENES.forEach((s, i) => {
    assert.match(html, new RegExp(`data-composition-id="s${i + 1}" data-composition-src="compositions/s${i + 1}.html" data-start="${t}" data-duration="${s.dur}"`));
    t += s.dur;
  });
  assert.match(html, /window\.__timelines\["main"\] = tl/);
  assert.doesNotMatch(html, /<audio/);
  assert.doesNotMatch(html, /Math\.random|Date\.now|https?:\/\//);
});

test('서브 컴포지션: 장면 기준 시간으로 등장·퇴장, 마지막 장면은 퇴장 없음', () => {
  const scenes = planScenes(buildSlides(brief));
  const first = buildSceneHtml(scenes[0], scenes[0].slide, theme, brief.handle, false);
  assert.match(first, /<template id="s1-template">/);
  assert.match(first, /window\.__timelines\["s1"\] = tl/);
  assert.match(first, new RegExp(`\\.wrap', \\{ opacity: 0[^)]*\\}, ${(scenes[0].dur - 0.3).toFixed(2)}\\)`));
  const last = scenes.at(-1);
  const lastHtml = buildSceneHtml(last, last.slide, theme, brief.handle, true);
  assert.doesNotMatch(lastHtml, /\.wrap', \{ opacity: 0/);
});

test('배경음악을 주면 루트에 audio 트랙(페이드 포함)을 추가', () => {
  const html = buildIndexHtml(planScenes(buildSlides(brief)), theme, { bgmSrc: 'assets/audio/bgm.mp3' });
  assert.match(html, /<audio id="bgm" src="assets\/audio\/bgm\.mp3" data-start="0" data-duration="15"[^>]*data-fade-out="1\.5"/);
});

test('입력 텍스트를 이스케이프한다', () => {
  const scenes = planScenes(buildSlides({ ...brief, cta: '<script>alert(1)</script>' }));
  const cta = scenes.find((s) => s.kind === 'cta');
  const html = buildSceneHtml(cta, cta.slide, theme, brief.handle, true);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('표지 사진: 표지 장면에 사진·덮개·확대 트윈을 넣고 다른 장면은 그대로', () => {
  const scenes = planScenes(buildSlides(brief));
  const cover = scenes.find((s) => s.kind === 'cover');
  const photo = { src: 'assets/images/cover.jpg', overlay: photoOverlay(brand.colors), surface: photoSurface(brand.colors) };
  const html = buildSceneHtml(cover, cover.slide, theme, brief.handle, false, photo);
  assert.match(html, /<img class="bg" src="assets\/images\/cover\.jpg"/);
  assert.match(html, /class="shade"/);
  assert.match(html, new RegExp(`\\.bg', \\{ scale: 1 \\}, \\{ scale: 1\\.08, duration: ${cover.dur}`));
  assert.match(html, /justify-content: flex-end/);
  const plain = buildSceneHtml(cover, cover.slide, theme, brief.handle, false);
  assert.doesNotMatch(plain, /class="bg"|scale: 1\.08/);
});
