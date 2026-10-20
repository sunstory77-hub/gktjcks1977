'use strict';
/* 테스트 도우미: 모의 Gemini 와 앱 서버를 자식 프로세스로 띄운다. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { createMock } = require('./mock-gemini.js');

const ROOT = path.resolve(__dirname, '..');

function startMock(port) {
  return new Promise((resolve) => {
    const s = createMock();
    s.listen(port || 0, '127.0.0.1', () => resolve({ server: s, port: s.address().port, close: () => new Promise((r) => s.close(r)) }));
  });
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(process.env.DPA_TEST_TMP || os.tmpdir(), `dpa-${tag}-`));
}

function freePort() {
  return new Promise((resolve) => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

// opts: { dataDir, port, mockPort, appRoot, args, env }
// port 를 지정하지 않으면 빈 포트를 따로 받는다(병렬 시험끼리 같은 기본 포트에서 서로의 서버에 붙는 것을 막는다).
async function startApp(opts) {
  if (opts.port == null) opts = { ...opts, port: await freePort() };
  return new Promise((resolve, reject) => {
    const root = opts.appRoot || ROOT;
    const env = { ...process.env, DPA_TEST: '1', DPA_DATA_DIR: opts.dataDir, ...(opts.mockPort ? { DPA_GEMINI_BASE: `http://127.0.0.1:${opts.mockPort}/v1beta` } : {}), ...(opts.port ? { DPA_PORT: String(opts.port) } : {}), ...(opts.env || {}) };
    const child = spawn(process.execPath, [path.join(root, 'src', 'server.js'), '--no-open', ...(opts.args || [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    let done = false;
    const finish = (v, e) => { if (done) return; done = true; e ? reject(e) : resolve(v); };
    child.stdout.on('data', (c) => {
      out += c;
      const m = /DPA_(READY|REUSE) (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(out);
      if (m) finish({ child, kind: m[1], url: m[2], port: Number(m[3]), out: () => out, err: () => err, stop: () => stop(child) });
    });
    child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => finish({ child, kind: 'EXIT', code, out: () => out, err: () => err, stop: () => stop(child) }));
    setTimeout(() => finish(null, new Error('앱 시작 시간 초과\n' + out + err)), 15000);
  });
}
function stop(child) {
  return new Promise((r) => { if (child.exitCode !== null || child.killed) return r(); child.once('exit', () => r()); child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 이미 종료 */ } r(); }, 3000); });
}

function request(port, method, urlPath, { headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { host: `127.0.0.1:${port}`, ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* JSON 아님 */ } resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken(port) {
  const r = await request(port, 'GET', '/');
  const m = /name="dpa-token" content="([a-f0-9]+)"/.exec(r.text);
  if (!m) throw new Error('토큰을 찾지 못했습니다');
  return m[1];
}

function apiClient(port, token) {
  const call = (method, p, obj, extra) => request(port, method, p, { headers: { 'x-dpa-token': token, ...(obj !== undefined ? { 'content-type': 'application/json' } : {}), ...(extra || {}) }, body: obj !== undefined ? (Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)) : undefined });
  return { call, get: (p) => call('GET', p), post: (p, o) => call('POST', p, o === undefined ? {} : o), put: (p, o) => call('PUT', p, o) };
}

module.exports = { ROOT, startMock, startApp, tmpDir, request, getToken, apiClient, stop };
