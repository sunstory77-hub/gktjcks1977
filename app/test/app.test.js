import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createApp } from '../src/server.js';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { makeImage } from '../../poc/test/helpers.js';

const require = createRequire(new URL('../../poc/package.json', import.meta.url));

const facts = JSON.parse(fs.readFileSync(new URL('../../poc/brief.sample.json', import.meta.url)));
const ANTHROPIC_KEY = 'sk-ant-api03-TESTKEYTESTKEYTESTKEYTESTKEY-wxyz';
const GEMINI_KEY = 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY9876';

let server, base, dataDir, calls;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  calls = { copy: [], image: [], reel: [], ads: [], detail: [], import: [] };
  server = createApp({
    dataDir,
    env: {},
    keyTester: async (provider, key) => {
      if (key.endsWith('bad')) throw new Error('키가 유효하지 않거나 권한이 없습니다');
      // 키 확인 당시 저장된 모델(claude-opus-5)보다 엔진 기본 모델(목록에 있으면)을 써야 한다
      return provider === 'anthropic' ? { models: ['claude-opus-5', 'claude-opus-5-5'], textModel: 'claude-opus-5' } : { models: ['gemini-3.1-flash-image'], imageModel: 'gemini-3.1-flash-image' };
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
    adGenerator: async (f, opts) => {
      calls.ads.push(opts);
      return { source: 'ai:fake', ads: [0, 1, 2].map((i) => ({ angle: `광고${i}`, primaryText: `본문 ${f.date}`, headline: '제목', description: '설명', overlay: i === 0 ? '업계 최고 강의' : '짧은 문구', overlaySub: '보조' })) };
    },
    detailGenerator: async (f, opts) => {
      calls.detail.push(opts);
      return { source: 'ai:fake', hook: { title: '공감', body: '본문' }, value: { title: '가치', body: '본문' }, features: [1, 2, 3].map((i) => ({ title: `특징${i}`, body: '설명' })), proof: { title: '근거', items: f.curriculum.slice(0, 3) }, faq: [1, 2, 3].map((i) => ({ q: `질문${i}`, a: f.date })), cta: { title: '신청', body: f.cta } };
    },
    importer: async (buf, type, opts) => {
      calls.import.push({ type, size: buf.length, ...opts });
      return { facts: { title: '가져온 제목', date: '' }, missing: ['date'], notes: ['일시 확인 필요'], source: 'ai:fake' };
    },
    reelRenderer: async (slides, brand, handle, outFile, opts) => {
      calls.reel.push({ brand, opts });
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      // 실제 HyperFrames 대신 1초짜리 진짜 MP4 (AI 표시 메타데이터를 넣을 수 있어야 함)
      execFileSync(require('ffmpeg-static'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=64x64:d=1', '-pix_fmt', 'yuv420p', outFile]);
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
  assert.equal(me.keys.anthropic.textModel, 'claude-opus-5-5'); // 화면에도 실제로 쓰는 모델
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
  assert.equal(calls.copy.at(-1).model, 'claude-opus-5-5');
  assert.deepEqual(calls.copy.at(-1).voice, { brandName: '긍정하쌤 교육', tone: '밝고 따뜻하게' });
  assert.equal(r.copy.source, 'ai:fake');
  assert.ok(r.warnings.some((w) => /"1위".*카피 2안 promise/.test(w)));
  assert.ok(r.warnings.some((w) => /회사 금지 표현.*카피 2안 promise/.test(w)));

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

test('5~8주 포맷: 인스타 광고(문구 3안·이미지 3비율)·상세페이지(6블록), 광고 표현 경고, AI 표시, ZIP 포함', async () => {
  const { readPngLabel } = await import('../../poc/src/ailabel.js');
  const c = await signup('formats@a.co', '포맷 회사');
  const camp = await (await c.post('/api/campaigns', { facts })).json();

  // 키 없이 → 입력 문구 기반 + 안내
  let r = await (await c.post(`/api/campaigns/${camp.id}/ads/copy`, { ai: true })).json();
  assert.equal(r.adCopy.source, 'offline');
  assert.match(r.warnings[0], /Claude API 키가 등록되지 않아/);

  await c.put('/api/keys/anthropic', { apiKey: ANTHROPIC_KEY });
  r = await (await c.post(`/api/campaigns/${camp.id}/ads/copy`, { ai: true })).json();
  assert.equal(calls.ads.at(-1).apiKey, ANTHROPIC_KEY);
  assert.equal(r.adCopy.ads.length, 3);
  assert.ok(r.warnings.some((w) => /"최고".*광고 1안 overlay/.test(w)), r.warnings.join('|'));

  r = await (await c.post(`/api/campaigns/${camp.id}/ads/render`, { variant: 1, template: 'pop' })).json();
  assert.deepEqual(Object.keys(r.ads.images), ['square', 'portrait', 'story']);
  assert.equal(r.ads.variant, 1);
  const img = await c.get(r.ads.images.story);
  assert.equal(img.headers.get('content-type'), 'image/png');

  r = await (await c.post(`/api/campaigns/${camp.id}/detail/copy`, { ai: true })).json();
  assert.equal(r.detail.source, 'ai:fake');
  r = await (await c.post(`/api/campaigns/${camp.id}/detail/render`, {})).json();
  assert.equal(r.detailImages.length, 6);

  // AI 생성 표시: 저장된 결과물 PNG에 XMP
  const dir = path.join(dataDir, 'companies');
  const pngs = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /^(ad_|detail_)/.test(e.name) && pngs.push(path.join(d, e.name))));
  walk(dir);
  assert.ok(pngs.length >= 9);
  for (const f of pngs) assert.ok(readPngLabel(f), `${path.basename(f)} AI 표시 없음`);

  // ZIP: 카드 먼저 필요, 만든 포맷이 모두 들어감
  assert.equal((await c.get(`/api/campaigns/${camp.id}/zip`)).status, 409);
  await c.post(`/api/campaigns/${camp.id}/render`, { template: 'bold' });
  const zip = unzipSync(new Uint8Array(await (await c.get(`/api/campaigns/${camp.id}/zip`)).arrayBuffer()));
  const names = Object.keys(zip);
  assert.ok(['인스타광고/ad_square.png', '인스타광고/ad_story.png', '인스타광고/광고문구.md', '상세페이지/detail_01_hook.png', '상세페이지/detail_06_cta.png'].every((n) => names.includes(n)), names.join(','));
  assert.match(Buffer.from(zip['인스타광고/광고문구.md']).toString(), /2안 · 광고1 \(이미지에 사용\)/);

  // 팩트가 바뀌면 광고·상세 문안도 초기화
  r = await (await c.put(`/api/campaigns/${camp.id}`, { facts })).json();
  assert.equal(r.adCopy, null);
  assert.equal(r.detail, null);
  assert.equal(r.ads, undefined);
});

test('자료 가져오기: 형식·키 검사, 초안만 돌려주고 저장하지 않음', async () => {
  const c = await signup('import@a.co');
  assert.equal((await c.post('/api/import', Buffer.from('x'), { 'x-file-ext': '.hwp', 'content-type': 'application/octet-stream' })).status, 400);
  const noKey = await c.post('/api/import', Buffer.from('%PDF-1.4'), { 'x-file-ext': '.pdf', 'content-type': 'application/octet-stream' });
  assert.equal(noKey.status, 400);
  assert.match((await noKey.json()).error, /Claude API 키/);
  await c.put('/api/keys/anthropic', { apiKey: ANTHROPIC_KEY });
  const r = await (await c.post('/api/import', Buffer.from('%PDF-1.4 hello'), { 'x-file-ext': '.pdf', 'content-type': 'application/octet-stream' })).json();
  assert.deepEqual(r.missing, ['date']);
  assert.equal(calls.import.at(-1).type, 'pdf');
  assert.equal(calls.import.at(-1).apiKey, ANTHROPIC_KEY);
  assert.deepEqual(await (await c.get('/api/campaigns')).json(), []);
});
