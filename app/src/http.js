// HTTP 유틸: 요청 본문, JSON 응답, 쿠키, 파일 전송(Range 지원)
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.otf': 'font/otf',
  '.json': 'application/json; charset=utf-8',
};

export function readBody(req, limit) {
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

export async function readJson(req, limit = 256 * 1024) {
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다');
  }
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, secure } = {}) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', maxAge !== undefined && `Max-Age=${maxAge}`, secure && 'Secure']
    .filter(Boolean)
    .join('; ');
}

export function sendFile(req, res, file, extraHeaders = {}) {
  if (!fs.existsSync(file)) throw new HttpError(404, '없는 파일');
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] ?? 'application/octet-stream';
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', ...extraHeaders };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(stat.size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}` });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'content-length': stat.size });
  fs.createReadStream(file).pipe(res);
}

// "METHOD /path/:param" 패턴 라우터
export function router(defs) {
  const routes = Object.entries(defs).map(([key, handler]) => {
    const [method, pattern] = key.split(' ');
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`);
    return { method, re, names, handler };
  });
  return (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
}
