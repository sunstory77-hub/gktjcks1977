// 사용법: node src/cli.js [all|cards|reel|copy] [옵션]
//   --brief <파일>      강의 브리프 JSON (기본 brief.sample.json)
//   --brand <파일>      브랜드킷 JSON (기본 brand.json)
//   --template <이름>   bold | clean | pop | all (기본 bold)
//   --variant <번호>    적용할 카피 안 번호 1~3 (기본 1)
//   --no-ai             Claude 호출 없이 브리프 문구 그대로 사용
//   --copy <파일>       저장해 둔 카피(out/copy.json)를 다시 사용 (Claude 재호출 없음)
//   --bgm <파일>        릴스 배경음악(mp3/wav/m4a)
//   --image <파일>      표지 사진(jpg/png) — 카드 1장과 릴스 표지 장면 배경
//   --ai-image [스타일] AI로 표지 배경 생성 (classroom|workspace|abstract, GEMINI_API_KEY 필요)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildSlides } from './content.js';
import { renderCards } from './cards.js';
import { renderReel } from './reel.js';
import { TEMPLATE_NAMES } from './templates.js';
import { generateCopy, offlineCopy, applyCopy, copyToMarkdown } from './ai.js';
import { normalizeImage } from './images.js';
import { generateCoverImage, IMAGE_STYLES, DEFAULT_IMAGE_STYLE } from './imagegen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brief: { type: 'string', default: 'brief.sample.json' },
    brand: { type: 'string', default: 'brand.json' },
    template: { type: 'string', default: 'bold' },
    variant: { type: 'string', default: '1' },
    'no-ai': { type: 'boolean', default: false },
    copy: { type: 'string' },
    bgm: { type: 'string' },
    image: { type: 'string' },
    'ai-image': { type: 'string' },
  },
});
const mode = positionals[0] ?? 'all';
if (!['all', 'cards', 'reel', 'copy'].includes(mode)) throw new Error(`알 수 없는 명령: ${mode}`);
const templates = opt.template === 'all' ? TEMPLATE_NAMES : [opt.template];
for (const t of templates) if (!TEMPLATE_NAMES.includes(t)) throw new Error(`알 수 없는 템플릿: ${t}`);

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8'));
const brief = readJson(opt.brief);
const brand = readJson(opt.brand);
const outDir = path.join(ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });

// 1) 카피
let copy;
if (opt.copy) {
  copy = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), opt.copy), 'utf8'));
  console.log(`저장된 카피 사용 (${copy.variants.length}안, ${copy.source})`);
} else if (opt['no-ai']) {
  copy = offlineCopy(brief);
} else {
  try {
    const t = Date.now();
    copy = await generateCopy(brief);
    console.log(`AI 카피 ${copy.variants.length}안 생성 (${((Date.now() - t) / 1000).toFixed(1)}s, ${copy.source})`);
  } catch (err) {
    const why = /authentication|api.?key/i.test(err.message) ? 'Claude API 인증 정보 없음 (ANTHROPIC_API_KEY 설정 필요)' : err.message;
    console.warn(`⚠ AI 카피 생성 실패 → 브리프 문구로 진행합니다: ${why}`);
    copy = offlineCopy(brief);
  }
}
fs.writeFileSync(path.join(outDir, 'copy.md'), copyToMarkdown(copy, brief));
fs.writeFileSync(path.join(outDir, 'copy.json'), JSON.stringify(copy, null, 2));
console.log('카피: out/copy.md (다시 쓰려면 --copy out/copy.json)');
if (mode === 'copy') process.exit(0);

const variant = Math.min(Math.max(Number(opt.variant) || 1, 1), copy.variants.length) - 1;
const slides = buildSlides(applyCopy(brief, copy, variant));
const handle = brief.handle ?? '';
let coverImage;
if (opt.image) {
  coverImage = await normalizeImage(path.resolve(process.cwd(), opt.image), path.join(outDir, 'cover.jpg'));
} else if (opt['ai-image'] !== undefined) {
  const style = opt['ai-image'] || DEFAULT_IMAGE_STYLE;
  if (!IMAGE_STYLES[style]) throw new Error(`알 수 없는 이미지 스타일: ${style} (${Object.keys(IMAGE_STYLES).join('|')})`);
  const t = Date.now();
  const r = await generateCoverImage(brief, path.join(outDir, 'cover_ai.jpg'), { style });
  coverImage = r.file;
  console.log(`AI 표지 배경 생성 (${((Date.now() - t) / 1000).toFixed(1)}s, ${r.model}, ${style}) → out/cover_ai.jpg`);
}

// 2) 템플릿별 렌더
for (const template of templates) {
  const dir = path.join(outDir, template);
  if (mode === 'cards' || mode === 'all') {
    const t = Date.now();
    const files = await renderCards(slides, brand, handle, path.join(dir, 'cards'), template, { coverImage });
    console.log(`[${template}] 카드뉴스 ${files.length}장 (${Date.now() - t}ms) → ${path.relative(ROOT, path.join(dir, 'cards'))}/`);
  }
  if (mode === 'reel' || mode === 'all') {
    const t = Date.now();
    const bgm = opt.bgm ? path.resolve(process.cwd(), opt.bgm) : undefined;
    const file = await renderReel(slides, brand, handle, path.join(dir, 'reel.mp4'), { template, bgm, coverImage, verbose: true });
    console.log(`[${template}] 릴스 (${((Date.now() - t) / 1000).toFixed(1)}s) → ${path.relative(ROOT, file)}`);
  }
}
