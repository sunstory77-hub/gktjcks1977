import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createApp } from '../src/server.js';
import { makeImage } from '../../poc/test/helpers.js';

const facts = JSON.parse(fs.readFileSync(new URL('../../poc/brief.sample.json', import.meta.url)));
const ANTHROPIC_KEY = 'sk-ant-api03-TESTKEYTESTKEYTESTKEYTESTKEY-wxyz';
const GEMINI_KEY = 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY9876';

let server, base, dataDir, calls;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  calls = { copy: [], image: [], reel: [] };
  server = createApp({
    dataDir,
    env: {},
    keyTester: async (provider, key) => {
      if (key.endsWith('bad')) throw new Error('키가 유효하지 않거나 권한이 없습니다');
      return provider === 'anthropic' ? { models: ['claude-opus-5'], textModel: 'claude-opus-5' } : { models: ['gemini-3.1-flash-image'], imageModel: 'gemini-3.1-flash-image' };
    },
    copyGenerator: async (f, opts) => {
      calls.copy.push(opts);
      return {
        source: 'ai:fake',
        variants: [0, 1, 2].map((i) => ({ angle: `각도${i}`, tag: '특강', title: `제목 ${i}\n둘째 줄`, subtitle: '부제', promise: i === 1 ? '업계 1위 강의' : '약속', cta: '신청하기' })),
        painPoints: ['고민 하나', '고민 둘', '고민 셋'],
        caption: `캡션\n🗓 ${f.date}`,
        hashtags: ['태그'],
      };
    },
    imageGenerator: async (f, dest, opts) => {
      calls.image.push(opts);
      makeImage(dest, { color: 'teal', size: '768x1376' });
    },
    reelRenderer: async (slides, brand, handle, outFile, opts) => {
      calls.reel.push({ brand, opts });
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, 'fake-mp4');
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// 로그인 세션을 쿠키로 들고 다니는 작은 클라이언트
function client() {
  let sid = '';
  const req = async (method, p, body, headers = {}) => {
    const isJson = body !== undefined && !(body instanceof Buffer);
    const res = await fetch(base + p, {
      method,
      headers: { 'x-requested-with': 'fetch', ...(isJson && { 'content-type': 'application/json' }), ...(sid && { cookie: sid }), ...headers },
      body: body === undefined ? undefined : isJson ? JSON.stringify(body) : body,
    });
    const set = res.headers.get('set-cookie');
    if (set) sid = set.split(';')[0];
    return res;
  };
  return { req, get: (p) => req('GET', p), post: (p, b, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), del: (p) => req('DELETE', p) };
}

async function signup(email, companyName = '테스트 회사') {
  const c = client();
  const res = await c.post('/api/auth/signup', { email, password: 'password123', name: '담당자', companyName });
  assert.equal(res.status, 201);
  return c;
}

test('가입·로그인·로그아웃: 중복 이메일 409, 틀린 비밀번호 401, 로그아웃 후 401', async () => {
  assert.deepEqual(await (await client().get('/api/session')).json(), { loggedIn: false });
  const c = await signup('owner@a.co', 'A교육');
  assert.deepEqual(await (await c.get('/api/session')).json(), { loggedIn: true });
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await client().post('/api/auth/signup', { email: 'OWNER@a.co', password: 'password123', name: 'x', companyName: 'y' })).status, 409);
  assert.equal((await client().post('/api/auth/signup', { email: 'x@a.co', password: 'short', name: 'x', companyName: 'y' })).status, 400);
  assert.equal((await client().post('/api/auth/login', { email: 'owner@a.co', password: 'wrong-password' })).status, 401);
  await c.post('/api/auth/logout', {});
  assert.equal((await c.get('/api/me')).status, 401);
  const again = client();
  assert.equal((await again.post('/api/auth/login', { email: 'owner@a.co', password: 'password123' })).status, 200);
  assert.equal((await again.get('/api/me')).status, 200);
});

test('보안: 앱 헤더 없는 변경 요청 403, 로그인 시도 10회 초과 429', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const c = client();
  for (let i = 0; i < 10; i++) assert.equal((await c.post('/api/auth/login', { email: 'brute@a.co', password: 'nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'brute@a.co', password: 'nope' })).status, 429);
});

test('API 키: 연결 테스트 통과해야 저장, 화면엔 끝 4자리만, DB 파일에 원문 없음', async () => {
  const c = await signup('keys@a.co');
  assert.equal((await c.put('/api/keys/anthropic', { apiKey: 'sk-ant-bad' })).status, 400);
  const res = await c.put('/api/keys/anthropic', { apiKey: ANTHROPIC_KEY });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).last4, 'wxyz');
  const me = await (await c.get('/api/me')).json();
  assert.equal(me.keys.anthropic.last4, 'wxyz');
  assert.equal(me.keys.anthropic.textModel, 'claude-opus-5');
  assert.equal(me.keys.gemini, null);
  assert.ok(!JSON.stringify(me).includes(ANTHROPIC_KEY));
  for (const f of fs.readdirSync(dataDir).filter((n) => n.startsWith('app.db'))) {
    assert.ok(!fs.readFileSync(path.join(dataDir, f)).includes(ANTHROPIC_KEY), `${f}에 키 원문`);
  }
  const usage = await (await c.get('/api/usage')).json();
  assert.ok(usage.rows.some((r) => r.kind === 'key_test' && r.provider === 'anthropic'));
});

test('회사 정보·브랜드 킷: 저장, 대비 자동 보정 결과 반환, 로고는 PNG로 정규화', async () => {
  const c = await signup('brand@a.co');
  assert.equal((await c.put('/api/company', { name: '새 이름', profile: { handle: '@new', phone: '010' } })).status, 200);
  const b = await (await c.put('/api/company/brand', { colors: { primary: '#FFB000', accent: '#FFE680', dark: '#1B1F3B', light: '#FFFFFF', muted: '#6B7090' }, tone: '차분하게', forbidden: '최고, 1위' })).json();
  assert.deepEqual(b.adjusted.map((a) => a.role), ['primary']);
  assert.deepEqual(b.brand.forbidden, ['최고', '1위']);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  const logo = fs.readFileSync(makeImage(path.join(d, 'l.png'), { color: 'red', size: '400x120' }));
  assert.equal((await c.post('/api/company/logo', logo, { 'content-type': 'application/octet-stream' })).status, 200);
  const got = await c.get('/api/company/logo');
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal((await c.post('/api/company/logo', Buffer.from('not image'), { 'content-type': 'application/octet-stream' })).status, 400);
  const me = await (await c.get('/api/me')).json();
  assert.equal(me.company.name, '새 이름');
  assert.equal(me.company.profile.handle, '@new');
  assert.equal(me.company.brand.tone, '차분하게');
  assert.ok(me.company.hasLogo);
});

test('회사 간 격리: 다른 회사의 캠페인·파일·표지는 404', async () => {
  const a = await signup('iso-a@a.co', 'A사');
  const b = await signup('iso-b@a.co', 'B사');
  const camp = await (await a.post('/api/campaigns', { facts })).json();
  await a.post(`/api/campaigns/${camp.id}/render`, { template: 'bold' });
  assert.equal((await a.get(`/api/campaigns/${camp.id}`)).status, 200);
  for (const [m, p, body] of [
    ['GET', `/api/campaigns/${camp.id}`],
    ['PUT', `/api/campaigns/${camp.id}`, { facts }],
    ['DELETE', `/api/campaigns/${camp.id}`],
    ['POST', `/api/campaigns/${camp.id}/copy`, { ai: false }],
    ['POST', `/api/campaigns/${camp.id}/render`, { template: 'bold' }],
    ['GET', `/api/campaigns/${camp.id}/zip`],
    ['GET', `/files/campaigns/${camp.id}/bold/card_01_cover.png`],
  ]) {
    assert.equal((await b.req(m, p, body)).status, 404, `${m} ${p}`);
  }
  assert.deepEqual(await (await b.get('/api/campaigns')).json(), []);
  assert.equal((await a.get(`/files/campaigns/${camp.id}/bold/card_01_cover.png`)).status, 200);
  assert.equal((await a.get(`/files/campaigns/${camp.id}/bold/..%2F..%2Fapp.db`)).status, 404);
});

test('캠페인 흐름: 회사 키·톤으로 카피 → 금지 표현 경고 → AI 표지 → 카드(로고) → 릴스 → ZIP', async () => {
  const c = await signup('flow@a.co', '긍정하쌤 교육');
  await c.put('/api/company', { name: '긍정하쌤 교육', profile: { handle: '@긍정하쌤' } });
  await c.put('/api/company/brand', { tone: '밝고 따뜻하게', forbidden: ['1위'], hashtags: ['긍정하쌤'] });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  await c.post('/api/company/logo', fs.readFileSync(makeImage(path.join(d, 'l.png'), { color: 'red', size: '400x120' })), { 'content-type': 'application/octet-stream' });

  const { handle, hashtags, ...raw } = facts;
  const camp = await (await c.post('/api/campaigns', { facts: raw })).json();
  assert.equal(camp.facts.handle, '@긍정하쌤'); // 회사 기본값
  assert.deepEqual(camp.facts.hashtags, ['긍정하쌤']);

  // 키 없이 AI 카피 → 입력 문구 + 안내
  let r = await (await c.post(`/api/campaigns/${camp.id}/copy`, { ai: true })).json();
  assert.equal(r.copy.source, 'offline');
  assert.match(r.warnings[0], /Claude API 키가 등록되지 않아/);

  // 키 등록 후 → 복호화한 키와 회사 톤이 생성기로 전달, 금지 표현 경고
  await c.put('/api/keys/anthropic', { apiKey: ANTHROPIC_KEY });
  r = await (await c.post(`/api/campaigns/${camp.id}/copy`, { ai: true })).json();
  assert.equal(calls.copy.at(-1).apiKey, ANTHROPIC_KEY);
  assert.deepEqual(calls.copy.at(-1).voice, { brandName: '긍정하쌤 교육', tone: '밝고 따뜻하게' });
  assert.equal(r.copy.source, 'ai:fake');
  assert.ok(r.warnings.some((w) => /금지 표현 "1위".*2안 promise/.test(w)));

  // AI 표지: Gemini 키 없으면 400, 있으면 회사 키로 생성
  assert.equal((await c.post(`/api/campaigns/${camp.id}/cover/generate`, { style: 'workspace' })).status, 400);
  await c.put('/api/keys/gemini', { apiKey: GEMINI_KEY });
  assert.equal((await c.post(`/api/campaigns/${camp.id}/cover/generate`, { style: 'workspace' })).status, 200);
  assert.deepEqual(calls.image.at(-1), { apiKey: GEMINI_KEY, model: 'gemini-3.1-flash-image', style: 'workspace' });

  // 카드뉴스(실제 렌더) → 릴스(가짜) → ZIP
  r = await (await c.post(`/api/campaigns/${camp.id}/render`, { template: 'clean', variant: 2 })).json();
  assert.equal(r.render.cards.length, 6);
  assert.equal(r.render.variant, 2);
  const png = await c.get(r.render.cards[0]);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await c.post(`/api/campaigns/${camp.id}/reel`, {})).status, 202);
  for (let i = 0; i < 50 && (await (await c.get(`/api/campaigns/${camp.id}`)).json()).render.reel.status !== 'done'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(calls.reel.at(-1).opts.template, 'clean');
  const zip = unzipSync(new Uint8Array(await (await c.get(`/api/campaigns/${camp.id}/zip`)).arrayBuffer()));
  assert.deepEqual(Object.keys(zip).sort(), [...[1, 2, 3, 4, 5, 6].map((n) => `카드뉴스/card_0${n}_${['cover', 'pain', 'promise', 'curriculum', 'benefits', 'cta'][n - 1]}.png`), '릴스_15초.mp4', '팩트시트.json', '홍보카피.md'].sort());

  // 팩트가 바뀌면 카피·렌더 초기화
  r = await (await c.put(`/api/campaigns/${camp.id}`, { facts: { ...raw, date: '11월 1일(토)' } })).json();
  assert.equal(r.copy, null);
  assert.equal(r.render, undefined);
  assert.equal(r.facts.date, '11월 1일(토)');
});

test('입력 검증: 필수 팩트 누락은 400, 없는 캠페인은 404', async () => {
  const c = await signup('valid@a.co');
  assert.equal((await c.post('/api/campaigns', { facts: { title: '제목만' } })).status, 400);
  assert.equal((await c.get('/api/campaigns/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await c.get('/api/campaigns/not-a-uuid')).status, 404);
});
