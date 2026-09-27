import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSlides, validateBrief } from '../src/content.js';
import { renderCards, CARD_W, CARD_H } from '../src/cards.js';
import { buildReelHtml, REEL_DURATION, SCENES } from '../src/reel.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));

test('브리프 → 슬라이드 6장, 입력값(일시·장소)을 그대로 보존', () => {
  const slides = buildSlides(brief);
  assert.deepEqual(slides.map((s) => s.kind), ['cover', 'pain', 'promise', 'curriculum', 'benefits', 'cta']);
  const cta = slides.at(-1);
  assert.equal(cta.date, brief.date);
  assert.equal(cta.place, brief.place);
});

test('필수 항목이 비면 누락 항목명을 알려준다', () => {
  assert.throws(() => validateBrief({ ...brief, date: '', curriculum: [] }), /date, curriculum|curriculum.*date|date.*curriculum/);
});

test('카드뉴스: 1080×1350 PNG 6장', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
  const files = await renderCards(buildSlides(brief), brand, brief.handle, dir);
  assert.equal(files.length, 6);
  for (const f of files) {
    const buf = fs.readFileSync(f);
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    assert.equal(buf.readUInt32BE(16), CARD_W);
    assert.equal(buf.readUInt32BE(20), CARD_H);
  }
});

test('릴스 HTML: 15초, 장면 타이밍이 이어지고 루트 타임라인을 등록', () => {
  const html = buildReelHtml(buildSlides(brief), brand, brief.handle);
  assert.equal(REEL_DURATION, 15);
  assert.match(html, /data-composition-id="main"[^>]*data-duration="15"/);
  let t = 0;
  SCENES.forEach((s, i) => {
    assert.match(html, new RegExp(`id="s${i + 1}"[^>]*data-start="${t}" data-duration="${s.dur}"`));
    t += s.dur;
  });
  assert.match(html, /window\.__timelines\["main"\] = tl/);
  assert.doesNotMatch(html, /Math\.random|Date\.now|https?:\/\//);
});

test('릴스 HTML: 입력 텍스트를 이스케이프한다', () => {
  const html = buildReelHtml(buildSlides({ ...brief, cta: '<script>alert(1)</script>' }), brand, brief.handle);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
