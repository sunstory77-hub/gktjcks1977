'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { startMock, startApp, tmpDir, request, getToken, apiClient, ROOT } = require('../harness.js');
const { png } = require('../mock-gemini.js');

let mock;
test.before(async () => { mock = await startMock(); });
test.after(async () => { await mock.close(); });

const GOOD = 'GOOD_KEY_AAAAAAAAAAAAAAAA';
async function boot(extra) {
  const dataDir = tmpDir('srv');
  const app = await startApp({ dataDir, mockPort: mock.port, port: 0 || undefined, ...(extra || {}) });
  const token = await getToken(app.port);
  return { app, dataDir, token, api: apiClient(app.port, token) };
}
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('보안: Host·Origin·토큰·요청 형식 검증', async () => {
  const port = await freePort();
  const { app, token, api } = await boot({ port });
  try {
    assert.equal((await request(app.port, 'GET', '/api/health')).status, 200);
    assert.equal((await request(app.port, 'GET', '/api/health', { headers: { host: 'evil.example.com' } })).status, 403, '다른 Host 거부(DNS 리바인딩 방지)');
    assert.equal((await request(app.port, 'GET', '/', { headers: { host: 'evil.example.com' } })).status, 403);
    assert.equal((await request(app.port, 'GET', '/api/state')).status, 403, '토큰 없음 거부');
    assert.equal((await request(app.port, 'GET', '/api/state', { headers: { 'x-dpa-token': 'x'.repeat(48) } })).status, 403, '잘못된 토큰 거부');
    const bad = await request(app.port, 'POST', '/api/consent', { headers: { 'x-dpa-token': token, origin: 'https://evil.example.com', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 403, '다른 Origin 거부');
    assert.equal(bad.json.error.code, 'bad_origin');
    const ok = await request(app.port, 'POST', '/api/consent', { headers: { 'x-dpa-token': token, origin: `http://127.0.0.1:${app.port}`, 'content-type': 'application/json' }, body: '{"agree":true}' });
    assert.equal(ok.status, 200);
    const ct = await request(app.port, 'POST', '/api/consent', { headers: { 'x-dpa-token': token, 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(ct.status, 415, 'JSON 이 아닌 형식 거부');
    const junk = await request(app.port, 'POST', '/api/connect', { headers: { 'x-dpa-token': token, 'content-type': 'application/json' }, body: '{깨진' });
    assert.equal(junk.status, 400);
    assert.ok(junk.json.error.message.length > 0);
    assert.equal((await api.get('/api/projects/..%2F..%2Fetc/assets/x')).status, 400);
    const trav = await request(app.port, 'GET', '/..%2f..%2fpackage.json');
    assert.equal(trav.status, 404, '정적 파일 경로 조작 차단');
    const csp = await request(app.port, 'GET', '/');
    assert.match(csp.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(csp.headers['access-control-allow-origin'], undefined, 'CORS 허용 헤더 없음');
    assert.equal((await request(app.port, 'POST', '/api/admin/shutdown', { headers: { 'x-dpa-admin': 'wrong' } })).status, 403);
    const big = await api.call('POST', '/api/consent', Buffer.alloc(3 * 1024 * 1024, 0x20));
    assert.equal(big.status, 413, '본문 크기 제한');
  } finally { await app.stop(); }
});

test('서버는 127.0.0.1 에서만 접속된다(외부 인터페이스 접속 거부)', async () => {
  const { app } = await boot();
  try {
    const ext = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!ext) { console.log('# 외부 인터페이스가 없어 외부 접속 거부 확인은 생략(바인딩 주소는 아래로 확인)'); }
    else {
      const err = await new Promise((r) => { const s = net.connect({ host: ext.address, port: app.port }, () => { s.destroy(); r(null); }); s.on('error', (e) => r(e)); });
      assert.ok(err && err.code === 'ECONNREFUSED', `${ext.address} 접속이 거부되어야 함`);
    }
    const out = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
    assert.match(out, /server\.listen\(port, '127\.0\.0\.1'\)/);
    assert.ok(!/listen\([^)]*0\.0\.0\.0/.test(out));
  } finally { await app.stop(); }
});

test('API 연결: 실패는 한국어 안내, 성공 후 상태에 키가 노출되지 않고 로그·백업에도 없다', async () => {
  const { app, api, dataDir } = await boot();
  try {
    const bad = await api.post('/api/connect', { key: 'BAD_KEY_AAAAAAAAAAAAAAAAA' });
    assert.equal(bad.status, 401);
    assert.match(bad.json.error.message, /API 키/);
    assert.equal((await api.post('/api/connect', { key: 'short' })).status, 400);
    // 마침표가 들어 있는 새 형식 키(AQ.…)도 형식 검사를 통과해야 한다(실제 키로 확인된 회귀)
    const dotted = await api.post('/api/connect', { key: 'BAD_KEY.dotted-format_AAAAAAAAAAAAAAAAAAAA' });
    assert.equal(dotted.status, 401, '형식은 통과하고 인증 단계에서 거절');
    assert.equal((await api.post('/api/connect', { key: 'has space and 한글 AAAAAAAAAAAA' })).status, 400);
    const ok = await api.post('/api/connect', { key: GOOD });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.models.text.normal, 'gemini-3-flash-preview');
    const st = await api.get('/api/state');
    assert.ok(st.json.connected);
    assert.ok(!st.text.includes(GOOD));
    // 프로젝트 만들고 AI 사용(동의 전에는 428)
    const p = (await api.post('/api/projects', {})).json.project;
    const need = await api.post('/api/ai/organize', { projectId: p.id, product: { name: '주스', description: '맛있는 주스' } });
    assert.equal(need.status, 428);
    await api.post('/api/consent', { agree: true });
    const org = await api.post('/api/ai/organize', { projectId: p.id, product: { name: '주스', description: '맛있는 주스 200ml' }, mode: 'normal' });
    assert.equal(org.status, 200);
    assert.ok(org.json.text.includes('상품 한눈에 보기'));
    const backup = await api.get(`/api/projects/${p.id}/backup`);
    assert.ok(!backup.text.includes(GOOD));
    const all = [];
    const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); n.isDirectory() ? walk(f) : all.push(f); } };
    walk(dataDir);
    for (const f of all) assert.ok(!fs.readFileSync(f).includes(GOOD), `${f} 에 키가 남아 있음`);
    // 연결 해제 → 다시 호출 불가
    await api.post('/api/disconnect', {});
    assert.equal((await api.post('/api/ai/organize', { projectId: p.id, product: { name: 'x' } })).status, 401);
  } finally { await app.stop(); }
});

test('이미지 업로드 API: 형식·내용 검증, 보기는 교차 출처 차단 헤더', async () => {
  const { app, api } = await boot();
  try {
    const p = (await api.post('/api/projects', {})).json.project;
    const up = await api.call('POST', `/api/projects/${p.id}/assets`, png(32, 32, [9, 9, 9]), { 'content-type': 'image/png' });
    assert.equal(up.status, 200);
    const fake = await api.call('POST', `/api/projects/${p.id}/assets`, Buffer.from('<?php echo 1;'), { 'content-type': 'image/png' });
    assert.equal(fake.status, 415, '내용이 이미지가 아니면 거부');
    const txt = await api.call('POST', `/api/projects/${p.id}/assets`, png(8, 8, [1, 1, 1]), { 'content-type': 'text/html' });
    assert.equal(txt.status, 415);
    const big = await api.call('POST', `/api/projects/${p.id}/assets`, Buffer.alloc(13 * 1024 * 1024), { 'content-type': 'image/png' });
    assert.equal(big.status, 413);
    const get = await request(app.port, 'GET', `/api/projects/${p.id}/assets/${up.json.id}`);
    assert.equal(get.status, 200);
    assert.equal(get.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(get.headers['content-type'], 'image/png');
  } finally { await app.stop(); }
});

test('자동 저장 복원: 서버를 껐다 켜도 프로젝트가 그대로 남는다(재실행 복원)', async () => {
  const dataDir = tmpDir('persist');
  let a = await startApp({ dataDir, mockPort: mock.port });
  let api = apiClient(a.port, await getToken(a.port));
  const p = (await api.get('/api/projects/current')).json.project;
  const next = { ...p, product: { ...p.product, name: '복원 테스트 상품', description: '설명' } };
  const w = await api.put(`/api/projects/${p.id}`, { project: next, baseRev: p.rev });
  assert.equal(w.status, 200);
  await a.stop();
  await new Promise((r) => setTimeout(r, 300));
  a = await startApp({ dataDir, mockPort: mock.port });
  try {
    api = apiClient(a.port, await getToken(a.port));
    const cur = (await api.get('/api/projects/current')).json.project;
    assert.equal(cur.id, p.id);
    assert.equal(cur.product.name, '복원 테스트 상품');
    assert.equal(cur.rev, 1);
  } finally { await a.stop(); }
});

test('포트 충돌: 기본 포트가 다른 프로그램에 점유되면 다음 포트를 쓴다', async () => {
  const base = await freePort();
  const blocker = net.createServer().listen(base, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const a = await startApp({ dataDir: tmpDir('port'), mockPort: mock.port, port: base });
  try {
    assert.equal(a.kind, 'READY');
    assert.notEqual(a.port, base);
    assert.equal((await request(a.port, 'GET', '/api/health')).status, 200);
  } finally { await a.stop(); blocker.close(); }
});

test('중복 실행: 같은 버전·같은 설치본이 실행 중이면 새로 띄우지 않고 기존 주소를 사용', async () => {
  const dataDir = tmpDir('dup');
  const a = await startApp({ dataDir, mockPort: mock.port });
  try {
    const b = await startApp({ dataDir, mockPort: mock.port });
    assert.equal(b.kind, 'REUSE');
    assert.equal(b.port, a.port);
    await new Promise((r) => b.child.once('exit', r));
    assert.equal(b.child.exitCode, 0);
    assert.equal((await request(a.port, 'GET', '/api/health')).status, 200, '기존 실행본이 살아 있어야 함');
  } finally { await a.stop(); }
});

test('오래된 instance.json(프로세스 없음)이 있어도 정상 시작', async () => {
  const dataDir = tmpDir('stale');
  fs.writeFileSync(path.join(dataDir, 'instance.json'), JSON.stringify({ pid: 99999, port: await freePort(), version: '0.0.1', appRoot: '/nowhere', adminToken: 'x' }));
  const a = await startApp({ dataDir, mockPort: mock.port });
  try { assert.equal(a.kind, 'READY'); } finally { await a.stop(); }
});

test('구버전과 신버전이 함께 있어도 잘못된 실행본에 연결되지 않고 신버전으로 교체, 사용자 자료 보존', async () => {
  const dataDir = tmpDir('upd');
  const oldRoot = tmpDir('oldapp');
  fs.cpSync(path.join(ROOT, 'src'), path.join(oldRoot, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(oldRoot, 'public'), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(oldRoot, 'package.json'), JSON.stringify({ ...pkg, version: '0.9.0' }));
  const oldApp = await startApp({ dataDir, mockPort: mock.port, appRoot: oldRoot });
  const oldApi = apiClient(oldApp.port, await getToken(oldApp.port));
  assert.equal((await request(oldApp.port, 'GET', '/api/health')).json.version, '0.9.0');
  // 구버전에서 프로젝트·사진 만들기
  const p = (await oldApi.get('/api/projects/current')).json.project;
  const up = await oldApi.call('POST', `/api/projects/${p.id}/assets`, png(16, 16, [5, 6, 7]), { 'content-type': 'image/png' });
  await oldApi.put(`/api/projects/${p.id}`, { project: { ...p, product: { ...p.product, name: '업데이트 전 상품' }, photos: [{ assetId: up.json.id, name: 'a.png' }] }, baseRev: p.rev });
  // 신버전 실행 → 구버전을 종료시키고 자신이 뜬다
  const newApp = await startApp({ dataDir, mockPort: mock.port });
  try {
    assert.equal(newApp.kind, 'READY', '구버전에 붙지 않고 새로 시작');
    const h = (await request(newApp.port, 'GET', '/api/health')).json;
    assert.equal(h.version, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
    assert.equal(h.appRoot, ROOT);
    await new Promise((r) => setTimeout(r, 600));
    assert.notEqual(oldApp.child.exitCode, null, '구버전은 종료되어야 함');
    const api = apiClient(newApp.port, await getToken(newApp.port));
    const cur = (await api.get('/api/projects/current')).json.project;
    assert.equal(cur.product.name, '업데이트 전 상품', '프로젝트 보존');
    assert.equal(cur.photos.length, 1);
    const img = await request(newApp.port, 'GET', `/api/projects/${cur.id}/assets/${cur.photos[0].assetId}`);
    assert.equal(img.status, 200, '입력 사진 보존');
    const inst = JSON.parse(fs.readFileSync(path.join(dataDir, 'instance.json'), 'utf8'));
    assert.equal(inst.port, newApp.port);
  } finally { await newApp.stop(); await oldApp.stop(); }
});

test('--quit: 실행 중인 프로그램을 종료하고 instance.json 을 지운다', async () => {
  const dataDir = tmpDir('quit');
  const a = await startApp({ dataDir, mockPort: mock.port });
  const q = await startApp({ dataDir, mockPort: mock.port, args: ['--quit'] }).catch((e) => e);
  void q;
  await new Promise((r) => setTimeout(r, 800));
  assert.notEqual(a.child.exitCode, null);
  assert.ok(!fs.existsSync(path.join(dataDir, 'instance.json')));
});

test('UI 종료 요청(/api/quit)', async () => {
  const { app, api, dataDir } = await boot();
  const r = await api.post('/api/quit', {});
  assert.equal(r.status, 200);
  await new Promise((res) => app.child.once('exit', res));
  assert.ok(!fs.existsSync(path.join(dataDir, 'instance.json')));
});
