'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMock, startApp, tmpDir, getToken, apiClient } = require('../harness.js');
const { png } = require('../mock-gemini.js');
const { makeProject } = require('../fixtures/sample-project.js');
const S = require('../../public/js/schema.js');
const X = require('../../src/xlsx.js');

let mock;
test.before(async () => { mock = await startMock(); });
test.after(async () => { await mock.close(); });

async function boot(key) {
  const app = await startApp({ dataDir: tmpDir('i18n'), mockPort: mock.port });
  const api = apiClient(app.port, await getToken(app.port));
  if (key) { assert.equal((await api.post('/api/connect', { key })).status, 200); await api.post('/api/consent', { agree: true }); }
  return { app, api };
}
const segs = () => { const p = makeProject({ translate: false }); return p.blocks.filter((b) => S.needsTranslation(b)).slice(0, 4).map((b) => ({ type: b.type, segments: Object.fromEntries(S.flatten(b.fields).map((x) => [x.path, x.text])) })); };
const mlog = async () => (await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json());

test('번역 API: 일본어 번역, 용어집·시장 정보가 프롬프트에 전달되고 구조가 유지된다', async () => {
  const { app, api } = await boot('GOOD_KEY_AAAAAAAAAAAAAAAA');
  try {
    const blocks = segs();
    const r = await api.post('/api/ai/translate', { lang: 'ja', blocks, product: { name: '한라봉 주스 200ml 12입' }, glossary: [{ ko: '한라봉', tr: { ja: 'ハルラボン' } }, { ko: 'JEJU-PURE', dnt: true }], market: { price: '¥3,200', name: '済州ハルラボンジュース' }, mode: 'normal' });
    assert.equal(r.status, 200);
    assert.equal(r.json.missing, 0);
    for (const b of blocks) assert.deepEqual(Object.keys(r.json.blocks[b.type].t).sort(), Object.keys(b.segments).sort(), '경로 구조 동일');
    const joined = JSON.stringify(r.json.blocks);
    assert.ok(joined.includes('JA: '), '일본어로 요청됨');
    assert.ok(joined.includes('ハルラボン'), '용어집 번역어 적용');
    const last = (await mlog()).filter((l) => l.task === 'translate').pop();
    assert.match(last.text, /into Japanese/); assert.match(last.text, /Never add claims/); assert.match(last.text, /Local price: "¥3,200"/); assert.match(last.text, /"한라봉" → "ハルラボン"/); assert.match(last.text, /keep exactly as written/);
    assert.ok(last.textLen > 500);
  } finally { await app.stop(); }
});
test('번역 API: 영어·중국어(간체) 언어 지시, 잘못된 입력은 400, 미연결 401, 동의 없으면 428', async () => {
  const { app, api } = await boot();
  try {
    assert.equal((await api.post('/api/ai/translate', { lang: 'en', blocks: segs() })).status, 401);
    await api.post('/api/connect', { key: 'GOOD_KEY_AAAAAAAAAAAAAAAA' });
    assert.equal((await api.post('/api/ai/translate', { lang: 'en', blocks: segs() })).status, 428);
    await api.post('/api/consent', { agree: true });
    assert.equal((await api.post('/api/ai/translate', { lang: 'fr', blocks: segs() })).status, 400);
    assert.equal((await api.post('/api/ai/translate', { lang: 'ko', blocks: segs() })).status, 400);
    assert.equal((await api.post('/api/ai/translate', { lang: 'en', blocks: [] })).status, 400);
    assert.equal((await api.post('/api/ai/translate', { lang: 'en', blocks: [{ type: 'evil', segments: { a: 'b' } }, { type: 'intro', segments: { '../x': 'y', ok: '', body: 5 } }] })).status, 400);
    const en = await api.post('/api/ai/translate', { lang: 'en', blocks: segs() });
    const zh = await api.post('/api/ai/translate', { lang: 'zh-CN', blocks: segs() });
    assert.equal(en.status, 200); assert.equal(zh.status, 200);
    const log = (await mlog()).filter((l) => l.task === 'translate').slice(-2);
    assert.match(log[0].text, /into English/); assert.match(log[1].text, /into Simplified Chinese/);
  } finally { await app.stop(); }
});
test('번역 API 오류: 일부 누락(missing), 잘못된 응답(502), 코드펜스 응답 처리', async () => {
  for (const [key, check] of [
    ['PARTIALTR_KEY_AAAAAAAAAAAAAA', (r) => { assert.equal(r.status, 200); assert.ok(r.json.missing > 0); }],
    ['GARBAGE_KEY_AAAAAAAAAAAAA', (r) => { assert.equal(r.status, 502); assert.equal(r.json.error.code, 'bad_response'); assert.match(r.json.error.message, /번역/); }],
    ['WEIRD_KEY_AAAAAAAAAAAAAAA', (r) => { assert.equal(r.status, 200); assert.equal(r.json.missing, 0); }],
    ['QUOTA_KEY_AAAAAAAAAAAAAAA', (r) => { assert.equal(r.status, 429); }],
  ]) {
    const { app, api } = await boot(key);
    try { check(await api.post('/api/ai/translate', { lang: 'en', blocks: segs() })); } finally { await app.stop(); }
  }
});
test('검수 패키지 API: 내보내기(XLSX/XLIFF/ZIP) → 가져오기 변경 목록, 잘못된 파일 400', async () => {
  const { app, api } = await boot();
  try {
    const proj = (await api.post('/api/projects', {})).json.project;
    const mine = makeProject();
    const put = await api.put(`/api/projects/${proj.id}`, { project: { ...mine, id: proj.id }, baseRev: proj.rev });
    assert.equal(put.status, 200);
    const ex = await api.post(`/api/projects/${proj.id}/review/export`, { langs: ['en', 'ja', 'zh-CN'], format: 'xlsx' });
    assert.equal(ex.status, 200);
    assert.match(ex.headers['content-type'], /spreadsheetml/);
    assert.match(decodeURIComponent(ex.headers['x-dpa-filename']), /_검수_\d{8}\.xlsx$/);
    const book = X.parseXlsx(ex.buf);
    assert.deepEqual(Object.keys(book), ['안내', 'EN', 'JA', '용어집', '시장정보'], '프로젝트에 없는 언어(zh-CN)는 제외');
    const imp = await api.call('POST', `/api/projects/${proj.id}/review/import`, ex.buf, { 'content-type': 'application/octet-stream', 'x-dpa-filename': encodeURIComponent('검수.xlsx') });
    assert.equal(imp.status, 200);
    assert.equal(imp.json.summary.changed, 0); assert.deepEqual(imp.json.langs, ['en', 'ja']);
    const x = await api.post(`/api/projects/${proj.id}/review/export`, { langs: ['en'], format: 'xliff' });
    assert.match(x.headers['content-type'], /xliff/);
    const z = await api.post(`/api/projects/${proj.id}/review/export`, { langs: ['en', 'ja'], format: 'xliff' });
    assert.match(z.headers['content-type'], /zip/);
    const bad = await api.call('POST', `/api/projects/${proj.id}/review/import`, Buffer.from('not a spreadsheet'), { 'content-type': 'application/octet-stream', 'x-dpa-filename': 'a.xlsx' });
    assert.equal(bad.status, 400); assert.match(bad.json.error.message, /검수 파일/);
    assert.equal((await api.post(`/api/projects/${proj.id}/review/export`, { langs: ['xx'], format: 'xlsx' })).status, 400);
  } finally { await app.stop(); }
});
test('백업·복원: 번역·용어집·언어별 이미지가 함께 보존된다', async () => {
  const { app, api } = await boot();
  try {
    const proj = (await api.post('/api/projects', {})).json.project;
    const up = await api.call('POST', `/api/projects/${proj.id}/assets`, png(20, 20, [9, 90, 190]), { 'content-type': 'image/png' });
    const mine = makeProject();
    mine.i18n.data.en.imgs['gallery:g1'] = { assetId: up.json.id, source: 'user' };
    mine.i18n.data.en.market.price = '$24.90';
    await api.put(`/api/projects/${proj.id}`, { project: { ...mine, id: proj.id }, baseRev: proj.rev });
    const bk = await api.get(`/api/projects/${proj.id}/backup`);
    const j = JSON.parse(bk.text);
    assert.ok(j.assets[up.json.id], '언어 전용 이미지도 백업에 포함');
    const r = await api.call('POST', '/api/projects/import', Buffer.from(bk.text), { 'content-type': 'application/json' });
    assert.equal(r.status, 200);
    const np = r.json.project;
    assert.deepEqual(np.i18n.langs, ['en', 'ja']);
    assert.equal(np.i18n.data.en.market.price, '$24.90');
    assert.equal(np.i18n.glossary[0].tr.en, 'Hallabong');
    assert.equal(np.i18n.data.en.imgs['gallery:g1'].assetId, up.json.id);
    assert.ok(Object.keys(np.i18n.data.en.blocks).length >= 5);
    const img = await fetch(`http://127.0.0.1:${app.port}/api/projects/${np.id}/assets/${up.json.id}`);
    assert.equal(img.status, 200);
  } finally { await app.stop(); }
});
