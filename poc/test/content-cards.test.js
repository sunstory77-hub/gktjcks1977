import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSlides, validateBrief } from '../src/content.js';
import { renderCards, cardSvg, CARD_W, CARD_H } from '../src/cards.js';
import { TEMPLATE_NAMES, resolveTheme, contrast } from '../src/templates.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));
const KINDS = ['cover', 'pain', 'promise', 'curriculum', 'benefits', 'cta'];

test('브리프 → 슬라이드 6장, 입력값(일시·장소)을 그대로 보존', () => {
  const slides = buildSlides(brief);
  assert.deepEqual(slides.map((s) => s.kind), KINDS);
  assert.equal(slides.at(-1).date, brief.date);
  assert.equal(slides.at(-1).place, brief.place);
});

test('필수 항목이 비면 누락 항목명을 알려준다', () => {
  assert.throws(() => validateBrief({ ...brief, date: '', curriculum: [] }), /curriculum.*date|date.*curriculum/);
});

test('템플릿 3종 모두 글자/배경 명도 대비 3:1 이상', () => {
  for (const name of TEMPLATE_NAMES) {
    const t = resolveTheme(name, brand.colors);
    const pairs = [
      ['item', t.item.fg, t.item.bg],
      ['dot', t.dot.fg, t.dot.bg],
      ['tag', t.tag.fg, t.tag.bg],
      ['btn', t.btn.fg, t.btn.bg],
    ];
    for (const kind of KINDS) {
      const sf = t.surface(kind);
      pairs.push([`${kind}.fg`, sf.fg, sf.bg], [`${kind}.sub`, sf.sub, sf.bg], [`${kind}.emphasis`, sf.emphasis, sf.bg]);
    }
    for (const [label, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      assert.ok(r >= 3, `${name} ${label}: ${fg} on ${bg} = ${r.toFixed(2)}:1`);
    }
  }
});

test('알 수 없는 템플릿은 거부', () => {
  assert.throws(() => resolveTheme('neon', brand.colors), /알 수 없는 템플릿/);
});

test('카드뉴스: 템플릿마다 1080×1350 PNG 6장', async () => {
  for (const name of TEMPLATE_NAMES) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cards-${name}-`));
    const files = await renderCards(buildSlides(brief), brand, brief.handle, dir, name);
    assert.equal(files.length, 6);
    for (const f of files) {
      const buf = fs.readFileSync(f);
      assert.equal(buf.toString('ascii', 1, 4), 'PNG');
      assert.equal(buf.readUInt32BE(16), CARD_W);
      assert.equal(buf.readUInt32BE(20), CARD_H);
    }
  }
});

// 카드 SVG(embedFont:false)의 <text>를 y좌표로 묶어 줄 단위 문자열로 복원
function svgLines(svg, fontSize) {
  const rows = new Map();
  for (const [, y, text] of svg.matchAll(new RegExp(`<text[^>]*y="([0-9.]+)"[^>]*font-size="${fontSize}"[^>]*>([^<]*)</text>`, 'g'))) {
    rows.set(y, (rows.get(y) ?? '') + text);
  }
  return [...rows.values()].map((l) => l.trim());
}

test('카드: 한국어 긴 문장은 어절 단위로 줄바꿈 (글자 중간에서 끊지 않음)', async () => {
  const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));
  const heading = '6블록 공식으로 구조부터 잡습니다'; // 실사용 테스트에서 "구조부/터"로 끊겼던 문장
  const svg = await cardSvg({ kind: 'promise', heading }, 2, 6, { t: resolveTheme('bold', brand.colors), handle: '@x', embedFont: false });
  const got = svgLines(svg, 92);
  assert.ok(got.length >= 2, `줄 수 ${got.length}`);
  for (const line of got) for (const word of line.split(' ')) assert.ok(heading.split(' ').includes(word), `잘린 어절: "${word}" (${got.join(' / ')})`);
});
