// 사용법: node src/cli.js [cards|reel|all] [브리프.json] [브랜드.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSlides } from './content.js';
import { renderCards } from './cards.js';
import { renderReel } from './reel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode = 'all', briefPath = 'brief.sample.json', brandPath = 'brand.json'] = process.argv.slice(2);
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));

const brief = readJson(briefPath);
const brand = readJson(brandPath);
const slides = buildSlides(brief);
const outDir = path.join(ROOT, 'out');

if (mode === 'cards' || mode === 'all') {
  const t = Date.now();
  const files = await renderCards(slides, brand, brief.handle ?? '', path.join(outDir, 'cards'));
  console.log(`카드뉴스 ${files.length}장 생성 (${Date.now() - t}ms)`);
  files.forEach((f) => console.log('  ' + path.relative(ROOT, f)));
}
if (mode === 'reel' || mode === 'all') {
  const t = Date.now();
  const file = await renderReel(slides, brand, brief.handle ?? '', path.join(outDir, 'reel.mp4'));
  console.log(`릴스 생성 (${((Date.now() - t) / 1000).toFixed(1)}s)\n  ${path.relative(ROOT, file)}`);
}
