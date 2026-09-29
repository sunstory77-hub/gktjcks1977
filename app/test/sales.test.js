// 판매 준비 기능: 업종·이미지 보관함·결과물 유지·직접 수정·요금제·팀원·계정·보안
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createApp } from '../src/server.js';
import { runAdmin } from '../src/admin.js';
import { makeImage } from '../../poc/test/helpers.js';

const facts = JSON.parse(fs.readFileSync(new URL('../../poc/brief.sample.json', import.meta.url)));
const product = {
  kind: 'product',
  title: '하루 한 컵\n저당 그래놀라',
  painPoints: ['아침 거르기 일쑤', '시판 시리얼은 너무 달다'],
  curriculum: ['통귀리 45%', '개별 소포장 30g'],
  benefits: ['첫 구매 무료배송'],
  price: '12,900원',
  place: '스마트스토어',
  cta: '프로필 링크에서 구매',
};
const GEMINI_KEY = 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY9876';
const servers = [];
after(() => servers.forEach((s) => s.close()));

const calls = { image: [], import: [] };
async function start(dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-')), env = {}) {
  const server = createApp({
    dataDir,
    env,
    keyTester: async (provider) => (provider === 'anthropic' ? { models: ['claude-opus-5-5'], textModel: 'claude-opus-5-5' } : { models: ['gemini-3.1-flash-image'], imageModel: 'gemini-3.1-flash-image' }),
    imageGenerator: async (f, dest, opts) => {
      calls.image.push({ ...opts, reference: opts.reference?.buffer.length, kind: f.kind });
      makeImage(dest, { color: 'teal', size: opts.aspectRatio === '1:1' ? '800x800' : '768x1376' });
      return { prompt: `prompt ${opts.style}` };
    },
    importer: async (buf, type, opts) => (calls.import.push(opts), { facts: { title: '가져온 상품' }, missing: [], notes: [], source: 'ai:fake' }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { server, dataDir, base: `http://127.0.0.1:${server.address().port}` };
}

function client(base) {
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
  return { req, get: (p) => req('GET', p), post: (p, b, h) => req('POST', p, b, h), put: (p, b) => req('PUT', p, b), del: (p, b) => req('DELETE', p, b), setBase: (b) => (base = b) };
}
async function signup(base, email, extra = {}) {
  const c = client(base);
  const res = await c.post('/api/auth/signup', { email, password: 'password123', name: '담당자', companyName: '테스트 회사', agree: true, ...extra });
  assert.equal(res.status, 201, await res.clone().text());
  return c;
}
const jpg = (color = 'red', size = '600x600') => fs.readFileSync(makeImage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'img-')), 'a.png'), { color, size }));

test('업종: 상품 캠페인은 일시·브랜드 없이 저장, 카드 라벨·자료 가져오기에 업종 전달', async () => {
  const { base } = await start();
  const c = await signup(base, 'kind@a.co');
  const camp = await (await c.post('/api/campaigns', { facts: product })).json();
  assert.equal(camp.facts.kind, 'product');
  const r = await (await c.post(`/api/campaigns/${camp.id}/render`, { template: 'bold' })).json();
  assert.equal(r.render.cards.length, 6);
  assert.equal((await c.post('/api/campaigns', { facts: { ...product, kind: 'edu' } })).status, 400); // 교육은 일시·강사 필수
  const list = await (await c.get('/api/campaigns')).json();
  assert.equal(list[0].kind, 'product');
  await c.put('/api/keys/anthropic', { apiKey: 'sk-ant-api03-TESTKEYTESTKEYTESTKEY' });
  const imp = await (await c.post('/api/import', Buffer.from('%PDF-1.4'), { 'x-file-ext': '.pdf', 'x-kind': 'product', 'content-type': 'application/octet-stream' })).json();
  assert.equal(calls.import.at(-1).kind, 'product');
  assert.equal(imp.facts.kind, 'product');
});

test('이미지 보관함: 올리기·AI 생성(비율·추가 설명·상품 사진 참고)·자리 배정·삭제·회사 격리', async () => {
  const { base } = await start();
  const c = await signup(base, 'img@a.co');
  const other = await signup(base, 'img-other@a.co');
  const camp = await (await c.post('/api/campaigns', { facts: product })).json();
  const id = camp.id;

  // 올리기 → 빈 자리 둘 다 채움
  let r = await (await c.post(`/api/campaigns/${id}/images`, jpg('white'), { 'x-file-ext': '.png' })).json();
  const upload = r.imageId;
  assert.deepEqual(r.slots, { vertical: upload, feed: upload });
  assert.equal(r.images[0].source, 'upload');
  assert.equal((await c.post(`/api/campaigns/${id}/images`, Buffer.from('nope'), { 'x-file-ext': '.png' })).status, 400);

  // AI 생성: 1:1은 피드 자리에, 상품 사진을 참고로
  await c.put('/api/keys/gemini', { apiKey: GEMINI_KEY });
  r = await (await c.post(`/api/campaigns/${id}/images/generate`, { style: 'stage', ratio: '1:1', extra: '파스텔 톤', referenceId: upload })).json();
  const square = r.imageId;
  assert.deepEqual(r.slots, { vertical: upload, feed: square });
  const { apiKey, reference, ...opts } = calls.image.at(-1);
  assert.equal(apiKey, GEMINI_KEY);
  assert.deepEqual(opts, { model: 'gemini-3.1-flash-image', style: 'stage', extra: '파스텔 톤', aspectRatio: '1:1', kind: 'product' });
  assert.ok(reference > 1000); // 올린 사진(JPEG)을 참고로 보냄
  assert.equal(r.images.find((i) => i.id === square).ratio, '1:1');
  // AI 이미지는 참고 사진이 될 수 없음
  assert.equal((await c.post(`/api/campaigns/${id}/images/generate`, { referenceId: square })).status, 400);

  // 자리 배정 바꾸기, 다른 회사 이미지 거부
  r = await (await c.put(`/api/campaigns/${id}/images/slots`, { vertical: square, feed: upload })).json();
  assert.deepEqual(r.slots, { vertical: square, feed: upload });
  assert.equal((await c.put(`/api/campaigns/${id}/images/slots`, { vertical: '00000000-0000-0000-0000-000000000000' })).status, 400);
  const img = await c.get(`/files/campaigns/${id}/images/${square}`);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await other.get(`/files/campaigns/${id}/images/${square}`)).status, 404);
  assert.equal((await other.post(`/api/campaigns/${id}/images`, jpg(), { 'x-file-ext': '.png' })).status, 404);
  // 내 캠페인 주소에 다른 회사 이미지 ID를 넣어도 404, 자리 배정·참고 사진도 거부
  const mine = await (await other.post('/api/campaigns', { facts: product })).json();
  assert.equal((await other.get(`/files/campaigns/${mine.id}/images/${square}`)).status, 404);
  assert.equal((await other.put(`/api/campaigns/${mine.id}/images/slots`, { feed: square })).status, 400);
  assert.equal((await other.del(`/api/campaigns/${mine.id}/images/${square}`)).status, 404);

  // 사진이 결과물에 쓰인다: 광고 스토리는 세로 자리, 피드는 피드 자리
  r = await (await c.post(`/api/campaigns/${id}/ads/render`, {})).json();
  assert.ok(r.ads.images.story);

  // 이미지를 지우면 자리도 비고, 결과물은 다시 만들어야 함
  r = await (await c.del(`/api/campaigns/${id}/images/${square}`)).json();
  assert.deepEqual(r.slots, { vertical: null, feed: upload });
  assert.equal(r.ads, undefined);
  assert.equal(r.images.length, 1);

  // 12장 한도
  for (let i = 0; i < 11; i++) await c.post(`/api/campaigns/${id}/images`, jpg('blue', '64x64'), { 'x-file-ext': '.png' });
  const over = await c.post(`/api/campaigns/${id}/images`, jpg('blue', '64x64'), { 'x-file-ext': '.png' });
  assert.equal(over.status, 400);
  assert.match((await over.json()).error, /12장/);
});

test('결과물 유지: 서버를 다시 켜도 카드·광고·상세·릴스 결과와 ZIP이 남는다', async () => {
  const first = await start();
  const c = await signup(first.base, 'persist@a.co');
  const camp = await (await c.post('/api/campaigns', { facts })).json();
  await c.post(`/api/campaigns/${camp.id}/render`, { template: 'pop', variant: 0 });
  await c.post(`/api/campaigns/${camp.id}/ads/render`, {});
  await c.post(`/api/campaigns/${camp.id}/detail/render`, {});
  await new Promise((r) => first.server.close(r));

  const second = await start(first.dataDir);
  c.setBase(second.base);
  const r = await (await c.get(`/api/campaigns/${camp.id}`)).json();
  assert.equal(r.render.template, 'pop');
  assert.equal(r.render.cards.length, 6);
  assert.equal(r.render.reel.status, 'idle');
  assert.equal(Object.keys(r.ads.images).length, 3);
  assert.equal(r.detailImages.length, 6);
  const zip = unzipSync(new Uint8Array(await (await c.get(`/api/campaigns/${camp.id}/zip`)).arrayBuffer()));
  assert.ok(Object.keys(zip).includes('상세페이지/detail_06_cta.png'));
  // 파일이 사라졌으면 결과 없음으로 본다
  fs.rmSync(path.join(first.dataDir, 'companies'), { recursive: true });
  assert.equal((await (await c.get(`/api/campaigns/${camp.id}`)).json()).render, undefined);
});

test('직접 수정: 카피·광고·상세 문안 — 글자 수 초과는 400, 저장하면 검수 다시·결과물 초기화', async () => {
  const { base } = await start();
  const c = await signup(base, 'edit@a.co');
  await c.put('/api/company/brand', { forbidden: ['무조건'] });
  const camp = await (await c.post('/api/campaigns', { facts })).json();
  let r = await (await c.post(`/api/campaigns/${camp.id}/copy`, { ai: false })).json();
  await c.post(`/api/campaigns/${camp.id}/render`, {});
  const copy = structuredClone(r.copy);
  copy.variants[0].title = '아주아주아주아주 긴 한 줄 제목입니다';
  let bad = await c.put(`/api/campaigns/${camp.id}/copy`, { copy });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /1안 제목 한 줄 \d+자\(최대 10\)/);
  copy.variants[0].title = '업계 1위\n무조건 강의';
  r = await (await c.put(`/api/campaigns/${camp.id}/copy`, { copy })).json();
  assert.equal(r.copy.source, 'edited');
  assert.equal(r.render, undefined); // 카드뉴스는 다시 만들어야 함
  assert.ok(r.warnings.some((w) => /"1위"/.test(w)));
  assert.ok(r.warnings.some((w) => /회사 금지 표현/.test(w)));

  r = await (await c.post(`/api/campaigns/${camp.id}/ads/copy`, { ai: false })).json();
  const ads = structuredClone(r.adCopy);
  ads.ads[0].overlay = '가'.repeat(15);
  bad = await c.put(`/api/campaigns/${camp.id}/ads/copy`, { adCopy: ads });
  assert.equal(bad.status, 400);
  ads.ads[0].overlay = '이번 주말 딱 하루';
  r = await (await c.put(`/api/campaigns/${camp.id}/ads/copy`, { adCopy: ads })).json();
  assert.equal(r.adCopy.ads[0].overlay, '이번 주말 딱 하루');

  r = await (await c.post(`/api/campaigns/${camp.id}/detail/copy`, { ai: false })).json();
  const d = structuredClone(r.detail);
  d.faq[0].a = '합격 보장합니다';
  r = await (await c.put(`/api/campaigns/${camp.id}/detail/copy`, { detail: d })).json();
  assert.equal(r.detail.source, 'edited');
  assert.ok(r.warnings.some((w) => /상세 FAQ1/.test(w)));
  d.features = d.features.slice(0, 2);
  assert.equal((await c.put(`/api/campaigns/${camp.id}/detail/copy`, { detail: d })).status, 400);
});

test('요금제: 체험은 한 달 캠페인 3개, 기간이 끝나면 만들기만 막고 보기는 허용, 관리자 도구로 변경', async () => {
  const { base, dataDir } = await start();
  const c = await signup(base, 'plan@a.co');
  let me = await (await c.get('/api/me')).json();
  assert.equal(me.plan.plan, 'trial');
  assert.equal(me.plan.campaigns.limit, 3);
  assert.ok(me.plan.until > new Date(Date.now() + 13 * 864e5).toISOString());
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await (await c.post('/api/campaigns', { facts })).json()).id);
  // 지워도 이번 달 사용량은 그대로
  await c.del(`/api/campaigns/${ids[0]}`);
  const over = await c.post('/api/campaigns', { facts });
  assert.equal(over.status, 402);
  assert.match((await over.json()).error, /캠페인 3개/);

  assert.match(runAdmin(['set-plan', 'plan@a.co', 'basic', '1'], { dataDir }), /베이직/);
  assert.equal((await c.post('/api/campaigns', { facts })).status, 201);

  // 기간 만료: 새로 만들기·생성은 402, 조회·ZIP은 가능
  runAdmin(['set-plan', 'plan@a.co', 'basic', '1'], { dataDir, at: new Date(Date.now() - 62 * 864e5) });
  me = await (await c.get('/api/me')).json();
  assert.equal(me.plan.expired, true);
  assert.equal((await c.post('/api/campaigns', { facts })).status, 402);
  assert.equal((await c.post(`/api/campaigns/${ids[1]}/render`, {})).status, 402);
  assert.equal((await c.get(`/api/campaigns/${ids[1]}`)).status, 200);
  assert.match(runAdmin(['list'], { dataDir }), /plan@a\.co\tbasic/);
  assert.throws(() => runAdmin(['set-plan', 'plan@a.co', 'gold'], { dataDir }), /요금제는/);
  assert.throws(() => runAdmin(['set-plan', 'nobody@a.co', 'pro'], { dataDir }), /찾을 수 없습니다/);
});

test('팀원: 초대 링크로 가입 → 같은 회사 캠페인 공유, 팀원은 키·회사 설정 불가, 소유자가 내보내기', async () => {
  const { base } = await start();
  const owner = await signup(base, 'owner@team.co');
  const camp = await (await owner.post('/api/campaigns', { facts })).json();
  const inv = await (await owner.post('/api/invites', { email: 'Member@team.co' })).json();
  assert.match(inv.path, /^\/#\/invite\/[A-Za-z0-9_-]+$/);
  const token = inv.path.split('/').pop();
  assert.deepEqual(await (await client(base).get(`/api/invites/${token}`)).json(), { email: 'member@team.co', companyName: '테스트 회사' });

  // 다른 이메일로는 가입 불가, 초대 이메일로 가입하면 회사명 없이도 됨
  assert.equal((await client(base).post('/api/auth/signup', { email: 'x@team.co', password: 'password123', name: '팀원', agree: true, invite: token })).status, 400);
  const member = await signup(base, 'member@team.co', { invite: token, companyName: '' });
  const me = await (await member.get('/api/me')).json();
  assert.equal(me.user.role, 'member');
  assert.equal(me.company.name, '테스트 회사');
  assert.equal((await member.get(`/api/campaigns/${camp.id}`)).status, 200);
  assert.equal((await member.put('/api/keys/gemini', { apiKey: GEMINI_KEY })).status, 403);
  assert.equal((await member.put('/api/company', { name: '바꿈' })).status, 403);
  assert.equal((await member.post('/api/invites', { email: 'z@team.co' })).status, 403);
  // 링크는 1회용
  assert.equal((await client(base).get(`/api/invites/${token}`)).status, 400);

  // 체험 요금제 팀원 2명 한도
  assert.equal((await owner.post('/api/invites', { email: 'third@team.co' })).status, 402);
  const list = await (await owner.get('/api/members')).json();
  assert.equal(list.members.length, 2);
  const mid = list.members.find((m) => m.role === 'member').id;
  assert.equal((await owner.del(`/api/members/${mid}`)).status, 200);
  assert.equal((await member.get('/api/me')).status, 401);
});

test('계정: 비밀번호 변경(다른 기기 로그아웃), 재설정 링크, 소유자 탈퇴 시 회사 데이터 전체 삭제', async () => {
  const { base, dataDir } = await start();
  const a = await signup(base, 'acct@a.co');
  const other = client(base);
  await other.post('/api/auth/login', { email: 'acct@a.co', password: 'password123' });
  assert.equal((await a.put('/api/me/password', { current: 'wrong-pass', next: 'newpassword1' })).status, 400);
  assert.equal((await a.put('/api/me/password', { current: 'password123', next: 'newpassword1' })).status, 200);
  assert.equal((await a.get('/api/me')).status, 200);
  assert.equal((await other.get('/api/me')).status, 401);

  const link = runAdmin(['reset-link', 'acct@a.co'], { dataDir, appUrl: 'https://promo.example' });
  const token = /#\/reset\/([A-Za-z0-9_-]+)/.exec(link)[1];
  assert.equal((await client(base).post('/api/auth/reset', { token, password: 'short' })).status, 400);
  assert.equal((await client(base).post('/api/auth/reset', { token, password: 'resetpass99' })).status, 200);
  assert.equal((await client(base).post('/api/auth/reset', { token, password: 'resetpass99' })).status, 400); // 1회용
  assert.equal((await a.get('/api/me')).status, 401); // 재설정하면 모든 로그인 끊김
  const b = client(base);
  assert.equal((await b.post('/api/auth/login', { email: 'acct@a.co', password: 'resetpass99' })).status, 200);

  const camp = await (await b.post('/api/campaigns', { facts })).json();
  await b.post(`/api/campaigns/${camp.id}/render`, {});
  const companyId = (await (await b.get('/api/me')).json()).company.id;
  assert.ok(fs.existsSync(path.join(dataDir, 'companies', companyId)));
  assert.equal((await b.del('/api/me', { password: 'wrong' })).status, 400);
  assert.equal((await b.del('/api/me', { password: 'resetpass99' })).status, 200);
  assert.ok(!fs.existsSync(path.join(dataDir, 'companies', companyId)));
  assert.equal((await client(base).post('/api/auth/login', { email: 'acct@a.co', password: 'resetpass99' })).status, 401);

  // 백업: DB 사본 + 파일
  const out = runAdmin(['backup', fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'))], { dataDir });
  const dir = /백업 완료: (.+)/.exec(out)[1];
  assert.ok(fs.statSync(path.join(dir, 'app.db')).size > 0);
});

test('운영: 보안 헤더, 상태 확인(/healthz), 약관·개인정보 페이지', async () => {
  const { base } = await start();
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true });
  assert.equal((await fetch(`${base}/healthz`, { method: 'HEAD' })).status, 200); // 로드밸런서 상태 확인
  assert.equal((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
  for (const p of ['/terms.html', '/privacy.html']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /시행일/);
  }
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.deepEqual(meta.kinds.map((k) => k.name), ['edu', 'product', 'service']);
  assert.ok(meta.stylesByKind.product.includes('stage'));
});

test('내 PC 설치형(PROMO_LOCAL=1): 가입하면 요금제 한도·기간 없이 시작', async () => {
  const { base } = await start(undefined, { PROMO_LOCAL: '1' });
  const c = await signup(base, 'local@pc.co');
  const me = await (await c.get('/api/me')).json();
  assert.equal(me.plan.plan, 'pro');
  assert.equal(me.plan.until, null);
  assert.equal(me.plan.expired, false);
});
