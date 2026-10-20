'use strict';
/* DETAIL PAGE AI — 로컬 서버 (127.0.0.1 전용). by BAPI */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const S = require('../public/js/schema.js');
const { Store, StoreError, dataDir, atomicWrite } = require('./store.js');
const { GeminiClient, GeminiError, resolveModels } = require('./gemini.js');
const { AiService, Jobs, runGenerate, runImageJob, errView } = require('./ai.js');
const Review = require('./review.js');

const APP_NAME = 'DETAIL PAGE AI';
const APP_ROOT = path.resolve(__dirname, '..');
const PUBLIC_ROOT = path.join(APP_ROOT, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;
const PREFERRED_PORT = 47831;
const PORT_TRIES = 20;
const IDLE_MS = Number(process.env.DPA_IDLE_MS) || 20 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// ───────────── 로그(요청 본문·API 키는 기록하지 않는다) ─────────────
function makeLogger(dir) {
  const file = path.join(dir, 'logs', 'app.log');
  return (level, msg) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.1'); } catch { /* 첫 기록 */ }
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${String(msg).replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[키]').replace(/\bAQ\.[0-9A-Za-z_.\-]{20,}/g, '[키]').slice(0, 500)}\n`);
    } catch { /* 로그 실패가 동작을 막지 않게 한다 */ }
  };
}

function safeEq(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(new HttpError(413, 'too_large', '요청 데이터가 너무 큽니다.')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

const GEMINI_STATUS = { auth: 401, quota: 429, timeout: 504, network: 502, model: 502, blocked: 422, bad_response: 502, bad_request: 400, server: 502, cancelled: 499 };

// ───────────── 포트·인스턴스 도우미 ─────────────
function probe(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 4096) res.destroy(); });
      res.on('end', () => { try { const j = JSON.parse(b); resolve(j && j.app === APP_NAME ? j : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function httpPostJson(port, urlPath, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', timeout: 3000, headers: { host: `127.0.0.1:${port}`, 'content-length': 0, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end();
  });
}

async function readInstance(dir) {
  try { return JSON.parse(await fsp.readFile(path.join(dir, 'instance.json'), 'utf8')); } catch { return null; }
}

function openBrowser(url) {
  try {
    let child;
    if (process.platform === 'win32') child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    else if (process.platform === 'darwin') child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    else child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* 브라우저를 못 열어도 주소는 표시한다 */ }
}

// ───────────── 앱 서버 ─────────────
function createApp({ dir }) {
  const store = new Store(dir);
  const log = makeLogger(dir);
  const token = crypto.randomBytes(24).toString('hex');
  const adminToken = crypto.randomBytes(24).toString('hex');
  const instanceId = crypto.randomBytes(8).toString('hex');
  const startedAt = new Date().toISOString();
  const jobs = new Jobs();
  const st = { key: null, client: null, models: null, available: null, consent: false, port: 0, lastActivity: Date.now() };
  const ai = new AiService({ store, client: () => { if (!st.client) throw new GeminiError('auth', '먼저 Gemini API를 연결해 주세요.'); return st.client; }, models: () => st.models });
  let server = null;
  let onQuit = () => {};

  const allowedHosts = () => new Set([`127.0.0.1:${st.port}`, `localhost:${st.port}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${st.port}`, `http://localhost:${st.port}`]);

  function send(res, status, body, headers) {
    const isBuf = Buffer.isBuffer(body);
    const data = isBuf ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(status, {
      'content-type': isBuf ? 'application/octet-stream' : (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'),
      'content-length': data.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers,
    });
    res.end(data);
  }
  const fail = (res, status, code, message) => send(res, status, { error: { code, message } });

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', '허용되지 않는 요청입니다.');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'bad_path', '주소가 올바르지 않습니다.'); }
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(PUBLIC_ROOT, '.' + rel);
    if (file !== PUBLIC_ROOT && !file.startsWith(PUBLIC_ROOT + path.sep)) throw new HttpError(404, 'not_found', '찾을 수 없습니다.');
    let buf;
    try { buf = await fsp.readFile(file); } catch { throw new HttpError(404, 'not_found', '찾을 수 없습니다.'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer' };
    if (path.basename(file) === 'index.html') {
      buf = Buffer.from(buf.toString('utf8').replace(/__DPA_TOKEN__/g, token).replace(/__DPA_VERSION__/g, VERSION));
      headers['cache-control'] = 'no-store';
    } else if (ext === '.woff2') headers['cache-control'] = 'public, max-age=31536000, immutable';
    else headers['cache-control'] = 'no-cache';
    headers['content-length'] = buf.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  const jsonBody = async (req, limit = 2 * 1024 * 1024) => {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'bad_type', '요청 형식이 올바르지 않습니다(JSON 필요).');
    const buf = await readBody(req, limit);
    try { const j = JSON.parse(buf.toString('utf8') || '{}'); if (!j || typeof j !== 'object') throw new Error('x'); return j; } catch { throw new HttpError(400, 'bad_json', '요청 내용을 읽을 수 없습니다.'); }
  };

  const idParam = (v, label) => { if (!S.ID_RE.test(String(v || ''))) throw new HttpError(400, 'bad_id', `${label || '번호'}가 올바르지 않습니다.`); return String(v); };
  const needAi = () => {
    if (!st.client || !st.models) throw new HttpError(401, 'not_connected', '먼저 Gemini API를 연결해 주세요.');
    if (!st.consent) throw new HttpError(428, 'consent_required', '외부 전송 및 사용료 안내에 동의한 뒤 사용할 수 있습니다.');
  };
  const modeOf = (b) => (b.mode === 'high' ? 'high' : 'normal');
  const photoIds = (b) => (Array.isArray(b.photoAssetIds) ? b.photoAssetIds.slice(0, 5).map((x) => idParam(x, '사진 번호')) : []);
  const projectOk = async (b) => { const id = idParam(b.projectId, '프로젝트 번호'); await store.readProject(id); return id; };

  function abortOnClose(req, res) {
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
    return ctrl.signal;
  }

  async function api(req, res, url) {
    const m = req.method;
    const p = url.pathname;
    const seg = p.split('/').filter(Boolean); // ['api', ...]
    const isAssetGet = m === 'GET' && seg[1] === 'projects' && seg[3] === 'assets' && seg.length === 5;

    if (m === 'GET' && p === '/api/health') return send(res, 200, { app: APP_NAME, version: VERSION, appRoot: APP_ROOT, instanceId, pid: process.pid, startedAt });
    if (m === 'POST' && p === '/api/admin/shutdown') {
      if (!safeEq(req.headers['x-dpa-admin'], adminToken)) throw new HttpError(403, 'forbidden', '권한이 없습니다.');
      send(res, 200, { ok: true });
      setTimeout(() => onQuit('admin'), 50);
      return;
    }

    // 이미지 보기는 <img> 로 불러오므로 헤더 토큰을 요구하지 않는다(무작위 번호 + Host 검증 + 교차 출처 차단).
    if (!isAssetGet) {
      if (!safeEq(req.headers['x-dpa-token'], token)) throw new HttpError(403, 'bad_token', '화면을 새로고침해 주세요. (보안 토큰이 일치하지 않습니다)');
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins().has(origin)) throw new HttpError(403, 'bad_origin', '허용되지 않은 출처입니다.');
    st.lastActivity = Date.now();

    // 상태·연결
    if (m === 'GET' && p === '/api/state') return send(res, 200, { version: VERSION, connected: !!st.client, models: st.models, available: st.available, consent: st.consent, dataDir: dir });
    if (m === 'POST' && p === '/api/ping') return send(res, 200, { ok: true, running: jobs.running() });
    if (m === 'POST' && p === '/api/quit') { send(res, 200, { ok: true }); setTimeout(() => onQuit('user'), 80); return; }
    if (m === 'POST' && p === '/api/consent') { const b = await jsonBody(req); st.consent = b.agree === true; return send(res, 200, { consent: st.consent }); }
    if (m === 'POST' && p === '/api/disconnect') { st.key = null; st.client = null; st.models = null; st.available = null; st.consent = false; return send(res, 200, { connected: false }); }
    if (m === 'POST' && p === '/api/connect') {
      const b = await jsonBody(req);
      const key = typeof b.key === 'string' ? b.key.trim() : '';
      if (!/^[A-Za-z0-9_.\-]{20,300}$/.test(key)) throw new HttpError(400, 'bad_key', 'API 키 형식이 올바르지 않습니다. 영문·숫자로 된 키를 그대로 붙여넣어 주세요.');
      const client = new GeminiClient(key);
      const list = await client.listModels();
      const r = resolveModels(list);
      if (!r.text.normal) throw new HttpError(502, 'no_model', '사용 가능한 Gemini 문구 모델을 찾지 못했습니다. 키 권한을 확인해 주세요.');
      st.key = key; st.client = client; st.models = { text: r.text, image: r.image }; st.available = r.available;
      return send(res, 200, { connected: true, models: st.models, available: st.available, imageReady: !!r.image.normal });
    }
    if (m === 'POST' && p === '/api/models/select') {
      if (!st.client) throw new HttpError(401, 'not_connected', '먼저 Gemini API를 연결해 주세요.');
      const b = await jsonBody(req);
      const kind = b.kind === 'image' ? 'image' : 'text';
      const mode = b.mode === 'high' ? 'high' : 'normal';
      if (!st.available[kind].includes(b.id)) throw new HttpError(400, 'bad_model', '목록에 없는 모델입니다.');
      st.models[kind][mode] = b.id;
      return send(res, 200, { models: st.models });
    }

    // 프로젝트
    if (seg[1] === 'projects') {
      if (m === 'GET' && seg.length === 2) return send(res, 200, { projects: await store.listProjects(), current: await store.getCurrent() });
      if (m === 'POST' && seg.length === 2) { const b = await jsonBody(req); return send(res, 200, { project: await store.createProject({ name: S.str(b.name, 120) }) }); }
      if (m === 'GET' && seg[2] === 'current') {
        let id = await store.getCurrent();
        if (!id) { const list = await store.listProjects(); id = list[0] ? list[0].id : null; }
        const proj = id ? await store.readProject(id) : await store.createProject({});
        await store.setCurrent(proj.id);
        return send(res, 200, { project: proj });
      }
      if (m === 'POST' && seg[2] === 'import') {
        const buf = await readBody(req, 400 * 1024 * 1024);
        const out = await store.importBackup(buf.toString('utf8'));
        return send(res, 200, out);
      }
      const pid = idParam(seg[2], '프로젝트 번호');
      if (seg.length === 3) {
        if (m === 'GET') { const proj = await store.readProject(pid); await store.setCurrent(pid); return send(res, 200, { project: proj }); }
        if (m === 'PUT') {
          const b = await jsonBody(req, 8 * 1024 * 1024);
          if (!Number.isInteger(b.baseRev)) throw new HttpError(400, 'bad_rev', '저장 버전 정보가 없습니다.');
          return send(res, 200, await store.writeProject(pid, b.project, b.baseRev));
        }
        if (m === 'DELETE') { await store.deleteProject(pid); return send(res, 200, { ok: true }); }
      }
      if (m === 'POST' && seg[3] === 'review' && seg[4] === 'export') {
        const b = await jsonBody(req);
        const proj = await store.readProject(pid);
        const langs = (Array.isArray(b.langs) ? b.langs : []).filter((c) => proj.i18n.langs.includes(c));
        let pkg;
        try { pkg = Review.buildPackage(proj, langs, b.format === 'xliff' ? 'xliff' : 'xlsx', { pending: !!b.pending }); } catch (e) { throw new HttpError(400, 'bad_request', e.message); }
        return send(res, 200, pkg.data, { 'content-type': pkg.mime, 'x-dpa-filename': encodeURIComponent(pkg.filename), 'access-control-expose-headers': 'x-dpa-filename' });
      }
      if (m === 'POST' && seg[3] === 'review' && seg[4] === 'import') {
        const buf = await readBody(req, 30 * 1024 * 1024);
        const proj = await store.readProject(pid);
        let name = String(req.headers['x-dpa-filename'] || 'review.xlsx');
        try { name = decodeURIComponent(name); } catch { /* 인코딩이 깨진 이름은 그대로 쓴다 */ }
        name = name.slice(0, 200);
        try { return send(res, 200, Review.parseReviewFile(proj, name, buf)); } catch (e) { throw new HttpError(400, 'bad_review_file', '검수 파일을 읽지 못했습니다: ' + e.message); }
      }
      if (m === 'GET' && seg[3] === 'backup') {
        const text = await store.exportBackup(pid, VERSION);
        return send(res, 200, Buffer.from(text), { 'content-type': 'application/json; charset=utf-8' });
      }
      if (seg[3] === 'assets') {
        if (m === 'POST' && seg.length === 4) {
          const ct = String(req.headers['content-type'] || '');
          if (!/^image\/(jpeg|png|webp)/i.test(ct)) throw new HttpError(415, 'bad_type', 'JPG, PNG, WEBP 이미지만 사용할 수 있습니다.');
          const saved = await store.saveAsset(pid, await readBody(req, 12 * 1024 * 1024));
          return send(res, 200, saved);
        }
        if (m === 'PUT' && seg[5] === 'ref') {
          await store.saveRef(pid, idParam(seg[4], '이미지 번호'), await readBody(req, 12 * 1024 * 1024));
          return send(res, 200, { ok: true });
        }
        if (m === 'GET' && seg.length === 5) {
          const a = await store.readAsset(pid, idParam(seg[4], '이미지 번호'), url.searchParams.get('ref') === '1');
          return send(res, 200, a.buf, { 'content-type': a.mime, 'cache-control': 'private, max-age=86400, immutable', 'cross-origin-resource-policy': 'same-origin' });
        }
      }
    }

    // AI
    if (seg[1] === 'ai' && m === 'POST') {
      needAi();
      const b = await jsonBody(req, 4 * 1024 * 1024);
      const signal = abortOnClose(req, res);
      if (seg[2] === 'organize') {
        const projectId = await projectOk(b);
        return send(res, 200, await ai.organize({ projectId, product: b.product, photoAssetIds: photoIds(b), mode: modeOf(b), signal }));
      }
      if (seg[2] === 'research') {
        const projectId = await projectOk(b);
        return send(res, 200, await ai.research({ projectId, product: b.product, photoAssetIds: photoIds(b), kind: b.kind === 'photos' ? 'photos' : 'web', mode: modeOf(b), signal }));
      }
      if (seg[2] === 'edit-text') {
        return send(res, 200, await ai.editText({ type: String(b.type || ''), fields: b.fields, instruction: b.instruction, product: b.product, brief: b.brief, mode: modeOf(b), signal }));
      }
      if (seg[2] === 'translate') {
        const lang = String(b.lang || '');
        const meta = S.LANG_BY[lang];
        if (!meta || meta.source) throw new HttpError(400, 'bad_lang', '지원하지 않는 언어입니다.');
        const raw = Array.isArray(b.blocks) ? b.blocks.slice(0, 12) : [];
        const seen = new Set();
        let count = 0;
        const blocks = [];
        for (const x of raw) {
          if (!x || !S.LABELS[x.type] || seen.has(x.type) || !x.segments || typeof x.segments !== 'object') continue;
          seen.add(x.type);
          const segments = {};
          for (const [k, v] of Object.entries(x.segments)) {
            if (!/^[A-Za-z0-9_.]{1,60}$/.test(k) || typeof v !== 'string' || !v.trim()) continue;
            segments[k] = S.str(v, 4500); count += 1;
          }
          if (Object.keys(segments).length) blocks.push({ type: x.type, segments });
        }
        if (!blocks.length || count > 300) throw new HttpError(400, 'no_items', '번역할 문장이 없거나 너무 많습니다.');
        const glossary = S.sanitizeI18n({ langs: [lang], glossary: b.glossary }).glossary;
        const market = S.sanitizeI18n({ langs: [lang], data: { [lang]: { market: b.market } } }).data[lang].market;
        return send(res, 200, await ai.translate({ lang, blocks, product: b.product, glossary, market, mode: modeOf(b), signal }));
      }
      if (seg[2] === 'generate') {
        const projectId = await projectOk(b);
        const job = jobs.create('generate', projectId);
        runGenerate(ai, job, { product: S.sanitizeProduct(b.product), photoAssetIds: photoIds(b), mode: modeOf(b), withImages: b.withImages !== false });
        return send(res, 200, { jobId: job.id });
      }
      if (seg[2] === 'images') {
        const projectId = await projectOk(b);
        const raw = Array.isArray(b.items) ? b.items.slice(0, 16) : [];
        if (!raw.length) throw new HttpError(400, 'no_items', '만들 이미지가 없습니다.');
        const items = raw.map((x) => ({
          slotId: idParam(x.slotId, '슬롯 번호'), prompt: S.str(x.prompt, 1200), aspect: /^\d{1,2}:\d{1,2}$/.test(x.aspect || '') ? x.aspect : '1:1',
          baseAssetId: x.baseAssetId ? idParam(x.baseAssetId, '이미지 번호') : null, instruction: S.str(x.instruction, 600),
        }));
        const job = jobs.create('images', projectId);
        runImageJob(ai, job, { items, product: S.sanitizeProduct(b.product), brief: S.sanitizeBrief(b.brief, b.product), photoAssetIds: photoIds(b), mode: modeOf(b) });
        return send(res, 200, { jobId: job.id });
      }
    }
    if (seg[1] === 'jobs' && seg.length === 3) {
      const job = jobs.get(idParam(seg[2], '작업 번호'));
      if (!job) throw new HttpError(404, 'not_found', '작업을 찾을 수 없습니다. (프로그램이 다시 시작되었을 수 있습니다)');
      if (m === 'GET') return send(res, 200, jobs.view(job));
      if (m === 'DELETE') { jobs.cancel(job.id); return send(res, 200, jobs.view(job)); }
    }
    throw new HttpError(404, 'not_found', '찾을 수 없는 요청입니다.');
  }

  async function handler(req, res) {
    const t0 = Date.now();
    let status = 500;
    try {
      if (!allowedHosts().has(String(req.headers.host || '').toLowerCase())) throw new HttpError(403, 'bad_host', '허용되지 않은 접속 주소입니다.');
      const url = new URL(req.url, `http://127.0.0.1:${st.port}`);
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(req, res, url.pathname);
      status = res.statusCode;
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) { status = e.status; fail(res, e.status, e.code, e.message); }
      else if (e instanceof StoreError) { status = e.status; fail(res, e.status, e.code, e.message); }
      else if (e instanceof GeminiError) { status = GEMINI_STATUS[e.code] || 502; fail(res, status, e.code, e.message); log('WARN', `gemini ${e.code} ${e.status}`); }
      else { status = 500; fail(res, 500, 'internal', '처리 중 오류가 발생했습니다. 다시 시도해 주세요.'); log('ERROR', `${req.method} ${String(req.url).split('?')[0]} ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
    } finally {
      if (String(req.url).startsWith('/api/') && !String(req.url).startsWith('/api/ping')) log('INFO', `${req.method} ${String(req.url).split('?')[0].replace(/[a-z]_[0-9a-f]{16}/g, ':id')} ${status} ${Date.now() - t0}ms`);
    }
  }

  return {
    store, log, jobs, st, token, adminToken, instanceId, startedAt,
    setQuit(fn) { onQuit = fn; },
    create() { server = http.createServer(handler); server.requestTimeout = 0; server.headersTimeout = 30000; return server; },
    get server() { return server; },
  };
}

// ───────────── 시작·중복 실행·종료 ─────────────
function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onErr = (e) => { server.removeListener('listening', onOk); reject(e); };
    const onOk = () => { server.removeListener('error', onErr); resolve(server.address().port); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

async function main(argv) {
  const args = new Set(argv || process.argv.slice(2));
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = await readInstance(dir);
  if (args.has('--quit')) {
    if (existing && existing.adminToken) await httpPostJson(existing.port, '/api/admin/shutdown', { 'x-dpa-admin': existing.adminToken });
    return;
  }

  // 1) 이미 실행 중인 같은 버전·같은 설치본이 있으면 새로 띄우지 않고 그것을 연다.
  const reuse = async (info, src) => {
    const url = `http://127.0.0.1:${info.port}/`;
    console.log(`DPA_REUSE ${url}`);
    if (!args.has('--no-open')) openBrowser(url);
    return src;
  };
  if (existing && existing.port) {
    const h = await probe(existing.port);
    if (h && h.version === VERSION && path.resolve(h.appRoot) === APP_ROOT) { await reuse(existing); return; }
    if (h && existing.adminToken) {
      // 2) 다른 버전(또는 다른 설치 위치)이 실행 중이면 종료시키고 이 버전으로 교체한다.
      await httpPostJson(existing.port, '/api/admin/shutdown', { 'x-dpa-admin': existing.adminToken });
      for (let i = 0; i < 30 && (await probe(existing.port, 400)); i++) await new Promise((r) => setTimeout(r, 150));
    }
  }

  const app = createApp({ dir });
  await app.store.init();
  const server = app.create();

  // 3) 포트 선택: 기본 포트가 사용 중이면 다음 포트, 끝까지 안 되면 운영체제가 정한 빈 포트.
  let port = 0;
  const base = Number(process.env.DPA_PORT) || PREFERRED_PORT;
  for (let i = 0; i <= PORT_TRIES && !port; i++) {
    try { port = await listenOn(server, base + i); } catch (e) {
      if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
      const h = await probe(base + i, 800);
      if (h && h.version === VERSION && path.resolve(h.appRoot) === APP_ROOT) { await reuse({ port: base + i }); return; }
    }
  }
  if (!port) port = await listenOn(server, 0);
  app.st.port = port;

  const infoFile = path.join(dir, 'instance.json');
  await atomicWrite(infoFile, JSON.stringify({ pid: process.pid, port, version: VERSION, appRoot: APP_ROOT, instanceId: app.instanceId, adminToken: app.adminToken, startedAt: app.startedAt }));

  let closing = false;
  const quit = async (why) => {
    if (closing) return;
    closing = true;
    app.log('INFO', `종료: ${why}`);
    try { const cur = await readInstance(dir); if (cur && cur.instanceId === app.instanceId) await fsp.rm(infoFile, { force: true }); } catch { /* 무시 */ }
    server.close();
    setTimeout(() => process.exit(0), 200).unref();
  };
  app.setQuit(quit);
  process.on('SIGINT', () => quit('SIGINT'));
  process.on('SIGTERM', () => quit('SIGTERM'));
  const idle = setInterval(() => { if (Date.now() - app.st.lastActivity > IDLE_MS && !app.jobs.running()) quit('유휴'); }, 30000);
  idle.unref();

  const url = `http://127.0.0.1:${port}/`;
  app.log('INFO', `시작 v${VERSION} ${url}`);
  console.log(`DPA_READY ${url}`);
  if (!args.has('--no-open')) openBrowser(url);
}

if (require.main === module) {
  // 예상하지 못한 비동기 오류 하나로 프로그램 전체(키·작업 상태)가 꺼지지 않게 기록만 남긴다.
  const crashLog = (kind, e) => { try { makeLogger(dataDir())('ERROR', `${kind} ${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`); } catch { /* 무시 */ } };
  process.on('unhandledRejection', (e) => crashLog('unhandledRejection', e));
  process.on('uncaughtException', (e) => { crashLog('uncaughtException', e); process.exit(1); });
  main().catch((e) => { console.error('시작 실패:', e && e.message); crashLog('시작 실패', e); process.exit(1); });
}

module.exports = { main, createApp, probe, VERSION, APP_ROOT, errView };
