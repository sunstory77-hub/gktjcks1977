// 웹 서버: 브라우저에서 브리프 입력 → 카피 선택 → 카드뉴스 미리보기 → 릴스 렌더 → ZIP 다운로드.
// 의존성 최소화를 위해 node:http만 쓴다. 기본 바인딩은 127.0.0.1(로컬 전용).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { buildSlides, validateBrief } from './content.js';
import { renderCards } from './cards.js';
import { renderReel } from './reel.js';
import { TEMPLATE_NAMES, TEMPLATE_LABELS } from './templates.js';
import { generateCopy, offlineCopy, applyCopy, copyToMarkdown } from './ai.js';
import { normalizeImage, IMAGE_EXTS, MAX_IMAGE_BYTES } from './images.js';
import { generateCoverImage, IMAGE_STYLES, DEFAULT_IMAGE_STYLE } from './imagegen.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const FONT_DIR = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/public/static');

const MAX_JSON = 256 * 1024;
const MAX_BGM = 15 * 1024 * 1024;
const MAX_JOBS = 30;
const BGM_EXTS = new Set(['.mp3', '.wav', '.m4a']);
const ID_RE = /^[0-9a-f-]{36}$/;
const IMAGE_ID_RE = /^[0-9a-f-]{36}\.jpg$/;
const FILE_RE = /^(card_\d{2}_[a-z]+\.png|reel\.mp4|copy\.md)$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8', '.otf': 'font/otf', '.json': 'application/json; charset=utf-8' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── 입력 정리: 알려진 필드만 받고 길이를 제한한다 ──
const str = (v, max) => (v === undefined || v === null ? '' : String(v).replace(/\r/g, '').trim().slice(0, max));
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : String(v ?? '').split('\n'))
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

export function sanitizeBrief(raw = {}) {
  const brief = {
    tag: str(raw.tag, 30),
    title: str(raw.title, 60).split('\n').slice(0, 2).join('\n'),
    subtitle: str(raw.subtitle, 40),
    instructor: str(raw.instructor, 30),
    target: str(raw.target, 60),
    painPoints: list(raw.painPoints, 3, 40),
    promise: str(raw.promise, 60),
    curriculum: list(raw.curriculum, 4, 40),
    benefits: list(raw.benefits, 3, 40),
    date: str(raw.date, 40),
    place: str(raw.place, 40),
    price: str(raw.price, 40),
    cta: str(raw.cta, 30),
    handle: str(raw.handle, 30),
    hashtags: list(raw.hashtags, 10, 30),
  };
  try {
    validateBrief(brief);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  return brief;
}

function sanitizeCopy(raw) {
  if (!raw || !Array.isArray(raw.variants) || raw.variants.length === 0) throw new HttpError(400, '카피 정보가 없습니다');
  return {
    source: str(raw.source, 60),
    variants: raw.variants.slice(0, 3).map((v) => ({
      angle: str(v?.angle, 40),
      tag: str(v?.tag, 30),
      title: str(v?.title, 60).split('\n').slice(0, 2).join('\n'),
      subtitle: str(v?.subtitle, 40),
      promise: str(v?.promise, 60),
      cta: str(v?.cta, 30),
    })),
    painPoints: list(raw.painPoints, 3, 40),
    caption: str(raw.caption, 2200),
    hashtags: list(raw.hashtags, 15, 30).map((t) => t.replace(/[\s#]/g, '')),
  };
}

// ── HTTP 유틸 ──
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `요청이 너무 큽니다 (최대 ${Math.round(limit / 1024 / 1024)}MB)`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다');
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(stat.size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

// ── 앱 ──
export function createApp({
  brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8')),
  sampleBrief = JSON.parse(fs.readFileSync(path.join(ROOT, 'brief.sample.json'), 'utf8')),
  workDir = path.join(ROOT, 'out', 'web'),
  copyGenerator = generateCopy,
  reelRenderer = renderReel,
  imageGenerator = generateCoverImage,
} = {}) {
  const jobsDir = path.join(workDir, 'jobs');
  const uploadsDir = path.join(workDir, 'uploads');
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  const jobs = new Map();
  let reelQueue = Promise.resolve(); // 릴스 렌더는 CPU를 많이 쓰므로 한 번에 하나씩

  function pruneJobs() {
    while (jobs.size >= MAX_JOBS) {
      const [oldest] = jobs.keys();
      fs.rmSync(jobs.get(oldest).dir, { recursive: true, force: true });
      jobs.delete(oldest);
    }
  }

  function getJob(id) {
    const job = ID_RE.test(id) && jobs.get(id);
    if (!job) throw new HttpError(404, '작업을 찾을 수 없습니다');
    return job;
  }

  const jobView = (id, job) => ({
    jobId: id,
    template: job.template,
    cards: job.cards.map((f) => `/files/${id}/${f}`),
    copy: `/files/${id}/copy.md`,
    reel: { status: job.reel.status, error: job.reel.error, url: job.reel.status === 'done' ? `/files/${id}/reel.mp4` : null },
    zip: `/api/jobs/${id}/zip`,
  });

  const routes = {
    'GET /api/meta': async () => ({
      templates: TEMPLATE_NAMES.map((name) => ({ name, label: TEMPLATE_LABELS[name] })),
      sampleBrief: sanitizeBrief(sampleBrief),
      colors: brand.colors,
      imageStyles: Object.entries(IMAGE_STYLES).map(([name, s]) => ({ name, label: s.label })),
    }),

    'POST /api/copy': async (req) => {
      const body = await readJson(req);
      const brief = sanitizeBrief(body.brief);
      if (!body.ai) return { copy: offlineCopy(brief) };
      try {
        return { copy: await copyGenerator(brief) };
      } catch (err) {
        const why = /authentication|api.?key/i.test(err.message) ? 'Claude API 인증 정보가 없습니다 (ANTHROPIC_API_KEY)' : err.message;
        return { copy: offlineCopy(brief), warning: `AI 카피 생성 실패 → 입력 문구로 대체했습니다: ${why}` };
      }
    },

    'POST /api/preview': async (req) => {
      const body = await readJson(req);
      const brief = sanitizeBrief(body.brief);
      const copy = sanitizeCopy(body.copy);
      const template = TEMPLATE_NAMES.includes(body.template) ? body.template : 'bold';
      const variant = Math.min(Math.max(Number(body.variant) || 0, 0), copy.variants.length - 1);
      const applied = applyCopy(brief, copy, variant);
      const slides = buildSlides(applied);
      const coverImage = resolveImage(body.imageId);

      pruneJobs();
      const id = crypto.randomUUID();
      const dir = path.join(jobsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      const files = await renderCards(slides, brand, brief.handle, dir, template, { coverImage });
      fs.writeFileSync(path.join(dir, 'copy.md'), copyToMarkdown(copy, brief));
      fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify({ ...applied, template }, null, 2));
      jobs.set(id, { dir, template, slides, coverImage, handle: brief.handle, cards: files.map((f) => path.basename(f)), reel: { status: 'idle' } });
      return jobView(id, jobs.get(id));
    },

    'POST /api/bgm': async (req) => {
      const ext = String(req.headers['x-file-ext'] ?? '').toLowerCase();
      if (!BGM_EXTS.has(ext)) throw new HttpError(400, `지원하지 않는 음악 형식입니다 (${[...BGM_EXTS].join(', ')})`);
      const buf = await readBody(req, MAX_BGM);
      if (buf.length === 0) throw new HttpError(400, '빈 파일입니다');
      const id = crypto.randomUUID();
      fs.writeFileSync(path.join(uploadsDir, id + ext), buf);
      return { bgmId: id + ext };
    },

    // 표지 사진: 올리는 즉시 JPEG로 정규화(크기 조정·메타데이터 제거·이미지 여부 확인)
    'POST /api/image': async (req) => {
      const ext = String(req.headers['x-file-ext'] ?? '').toLowerCase();
      if (!IMAGE_EXTS.has(ext)) throw new HttpError(400, 'JPG 또는 PNG 사진만 사용할 수 있습니다');
      const buf = await readBody(req, MAX_IMAGE_BYTES);
      if (buf.length === 0) throw new HttpError(400, '빈 파일입니다');
      const id = crypto.randomUUID();
      const raw = path.join(uploadsDir, `${id}.upload${ext}`);
      fs.writeFileSync(raw, buf);
      try {
        await normalizeImage(raw, path.join(uploadsDir, `${id}.jpg`));
      } catch (err) {
        throw new HttpError(400, err.message);
      } finally {
        fs.rmSync(raw, { force: true });
      }
      return { imageId: `${id}.jpg` };
    },

    // AI 배경 생성: 결과는 업로드 사진과 같은 자리(uploads/<id>.jpg)에 저장되어 imageId로 쓴다
    'POST /api/image/generate': async (req) => {
      const body = await readJson(req);
      const brief = sanitizeBrief(body.brief);
      const style = Object.hasOwn(IMAGE_STYLES, body.style) ? body.style : DEFAULT_IMAGE_STYLE;
      const id = crypto.randomUUID();
      try {
        const { prompt, model } = await imageGenerator(brief, path.join(uploadsDir, `${id}.jpg`), { style });
        return { imageId: `${id}.jpg`, style, model, prompt };
      } catch (err) {
        throw new HttpError(502, err.message);
      }
    },
  };

  function resolveImage(imageId) {
    if (!imageId) return undefined;
    if (!IMAGE_ID_RE.test(String(imageId))) throw new HttpError(400, '잘못된 사진 ID');
    const file = path.join(uploadsDir, imageId);
    if (!fs.existsSync(file)) throw new HttpError(404, '사진 파일이 없습니다. 다시 올려 주세요');
    return file;
  }

  async function startReel(req, id) {
    const job = getJob(id);
    const body = await readJson(req);
    if (['queued', 'rendering'].includes(job.reel.status)) return jobView(id, job);
    let bgm;
    if (body.bgmId) {
      const m = /^([0-9a-f-]{36})(\.[a-z0-9]+)$/.exec(String(body.bgmId));
      if (!m || !BGM_EXTS.has(m[2])) throw new HttpError(400, '잘못된 배경음악 ID');
      bgm = path.join(uploadsDir, body.bgmId);
      if (!fs.existsSync(bgm)) throw new HttpError(404, '배경음악 파일이 없습니다. 다시 올려 주세요');
    }
    job.reel = { status: 'queued' };
    reelQueue = reelQueue.then(async () => {
      job.reel = { status: 'rendering' };
      try {
        await reelRenderer(job.slides, brand, job.handle, path.join(job.dir, 'reel.mp4'), {
          template: job.template,
          bgm,
          coverImage: job.coverImage,
          projectDir: path.join(job.dir, 'project'),
        });
        job.reel = { status: 'done' };
      } catch (err) {
        job.reel = { status: 'error', error: err.message };
      }
    });
    return jobView(id, job);
  }

  function zipJob(res, id) {
    const job = getJob(id);
    const entries = {};
    for (const f of job.cards) entries[`카드뉴스/${f}`] = [fs.readFileSync(path.join(job.dir, f)), { level: 0 }];
    entries['홍보카피.md'] = fs.readFileSync(path.join(job.dir, 'copy.md'));
    entries['brief.json'] = fs.readFileSync(path.join(job.dir, 'brief.json'));
    if (job.reel.status === 'done') entries['릴스_15초.mp4'] = [fs.readFileSync(path.join(job.dir, 'reel.mp4')), { level: 0 }];
    const zip = Buffer.from(zipSync(entries));
    const name = `홍보키트_${job.template}_${today()}.zip`;
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': zip.length,
      'content-disposition': `attachment; filename="promo-kit_${today()}.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.end(zip);
  }

  function serveStatic(req, res, pathname) {
    if (pathname.startsWith('/fonts/')) {
      const name = pathname.slice(7);
      if (!/^Pretendard-(Regular|SemiBold|Bold|ExtraBold)\.otf$/.test(name)) throw new HttpError(404, '없는 파일');
      return sendFile(req, res, path.join(FONT_DIR, name));
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^[a-z0-9-]+\.(html|js|css)$/.test(rel)) throw new HttpError(404, '없는 파일');
    const file = path.join(PUBLIC_DIR, rel);
    if (!fs.existsSync(file)) throw new HttpError(404, '없는 파일');
    return sendFile(req, res, file);
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const key = `${req.method} ${pathname}`;
      if (routes[key]) return sendJson(res, 200, await routes[key](req));

      let m;
      if ((m = /^\/api\/jobs\/([^/]+)$/.exec(pathname)) && req.method === 'GET') return sendJson(res, 200, jobView(m[1], getJob(m[1])));
      if ((m = /^\/api\/jobs\/([^/]+)\/reel$/.exec(pathname)) && req.method === 'POST') return sendJson(res, 202, await startReel(req, m[1]));
      if ((m = /^\/api\/jobs\/([^/]+)\/zip$/.exec(pathname)) && req.method === 'GET') return zipJob(res, m[1]);
      if ((m = /^\/files\/([^/]+)\/([^/]+)$/.exec(pathname)) && req.method === 'GET') {
        const job = getJob(m[1]);
        if (!FILE_RE.test(m[2])) throw new HttpError(404, '없는 파일');
        const file = path.join(job.dir, m[2]);
        if (!fs.existsSync(file)) throw new HttpError(404, '없는 파일');
        return sendFile(req, res, file);
      }
      if ((m = /^\/api\/image\/([^/]+)$/.exec(pathname)) && req.method === 'GET') return sendFile(req, res, resolveImage(m[1]));
      if (req.method === 'GET') return serveStatic(req, res, pathname);
      throw new HttpError(404, '없는 경로');
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? `서버 오류: ${err.message}` : err.message });
      else res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5173;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`홍보공장 실행 중: http://${host}:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('참고: ANTHROPIC_API_KEY가 없어 AI 카피 대신 입력 문구를 사용합니다');
  });
}
