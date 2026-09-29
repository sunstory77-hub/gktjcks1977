import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeImage } from '../src/images.js';
import { renderCards } from '../src/cards.js';
import { buildSlides } from '../src/content.js';
import { TEMPLATE_NAMES, PHOTO_TEXT_MIN_ALPHA, photoSurface, blend, contrast } from '../src/templates.js';
import { makeImage, pixel } from './helpers.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));

test('사진 표지: 새하얀 사진(최악)에서도 글자 대비 — 본문 4.5:1, 강조 3:1 이상', () => {
  const s = photoSurface(brand.colors);
  const worst = blend(brand.colors.dark, '#FFFFFF', PHOTO_TEXT_MIN_ALPHA);
  assert.ok(contrast(s.fg, worst) >= 4.5, `fg ${contrast(s.fg, worst).toFixed(2)}`);
  assert.ok(contrast(s.sub, worst) >= 3, `sub ${contrast(s.sub, worst).toFixed(2)}`);
  assert.ok(contrast(s.tag.fg, s.tag.bg) >= 4.5);
});

test('normalizeImage: PNG·JPG → JPEG, 큰 사진은 줄이고 이미지가 아니면 거부', async () => {
  const d = tmp();
  const png = makeImage(path.join(d, 'big.png'), { size: '3000x4000' });
  const out = await normalizeImage(png, path.join(d, 'out.jpg'));
  const head = fs.readFileSync(out).subarray(0, 3);
  assert.deepEqual([...head], [0xff, 0xd8, 0xff]);

  const fake = path.join(d, 'fake.jpg');
  fs.writeFileSync(fake, 'not an image');
  await assert.rejects(normalizeImage(fake, path.join(d, 'x.jpg')), /JPG 또는 PNG/);
  const empty = path.join(d, 'empty.jpg');
  fs.writeFileSync(empty, '');
  await assert.rejects(normalizeImage(empty, path.join(d, 'y.jpg')), /빈 사진/);
  // 헤더만 JPEG인 깨진 파일
  const broken = path.join(d, 'broken.jpg');
  fs.writeFileSync(broken, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]));
  await assert.rejects(normalizeImage(broken, path.join(d, 'z.jpg')), /읽을 수 없습니다/);
});

test('카드뉴스: 표지 사진이 1장에만 깔리고 나머지 카드는 그대로', async () => {
  const d = tmp();
  const red = await normalizeImage(makeImage(path.join(d, 'red.png'), { color: 'red' }), path.join(d, 'red.jpg'));
  for (const name of TEMPLATE_NAMES) {
    const withPhoto = await renderCards(buildSlides(brief), brand, brief.handle, path.join(d, `p-${name}`), name, { coverImage: red });
    const without = await renderCards(buildSlides(brief), brand, brief.handle, path.join(d, `n-${name}`), name);
    // 표지 상단(덮개가 옅은 구간)은 빨간 기운이 보여야 한다
    const [r, g, b] = pixel(withPhoto[0], 540, 20);
    assert.ok(r > g + 60 && r > b + 60, `${name} 표지 상단 픽셀 ${[r, g, b]}`);
    // 2장(고민)은 사진 여부와 관계없이 같은 결과
    assert.deepEqual(fs.readFileSync(withPhoto[1]), fs.readFileSync(without[1]));
  }
});
