'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DPA_TEST = '1';
const { startMock } = require('../harness.js');
const { GeminiClient, GeminiError, resolveModels, redact } = require('../../src/gemini.js');

let mock;
test.before(async () => { mock = await startMock(); process.env.DPA_GEMINI_BASE = `http://127.0.0.1:${mock.port}/v1beta`; });
test.after(async () => { await mock.close(); });

const GOOD = 'GOOD_KEY_AAAAAAAAAAAAAAAA';

test('모델 선택: 연결 시점 목록에서 최신 flash/pro·이미지 모델을 고른다', async () => {
  const c = new GeminiClient(GOOD);
  const r = resolveModels(await c.listModels());
  assert.equal(r.text.normal, 'gemini-3-flash-preview');
  assert.equal(r.text.high, 'gemini-3-pro-preview');
  assert.equal(r.image.normal, 'gemini-2.5-flash-image');
  assert.equal(r.image.high, 'gemini-3-pro-image-preview');
  assert.ok(!r.available.text.some((x) => /embedding|gemma/.test(x)));
});
test('모델 선택: 이미지 모델이 없으면 null (문구만 사용 가능)', () => {
  const r = resolveModels([{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }]);
  assert.equal(r.text.normal, 'gemini-2.5-flash');
  assert.equal(r.text.high, 'gemini-2.5-flash');
  assert.equal(r.image.normal, null);
});
test('인증 실패(400 API key not valid) → auth, 한국어 안내', async () => {
  await assert.rejects(() => new GeminiClient('BAD_KEY_AAAAAAAAAAAAAAAAA').listModels(), (e) => e.code === 'auth' && /API 키/.test(e.message));
});
test('권한 거부(403) → auth', async () => {
  await assert.rejects(() => new GeminiClient('PERM_KEY_AAAAAAAAAAAAAAAAA').generate({ model: 'm', parts: [{ text: 'x' }] }), (e) => e.code === 'auth');
});
test('사용량 초과(429) → quota', async () => {
  await assert.rejects(() => new GeminiClient('QUOTA_KEY_AAAAAAAAAAAAAAA').generate({ model: 'm', parts: [{ text: 'x' }] }), (e) => e.code === 'quota' && /사용량/.test(e.message));
});
test('시간 초과 → timeout', async () => {
  await assert.rejects(() => new GeminiClient('SLOW_KEY_AAAAAAAAAAAAAAAA').generate({ model: 'm', parts: [{ text: '[TASK:organize]' }], timeoutMs: 400 }), (e) => e.code === 'timeout' && /시간/.test(e.message));
});
test('취소(AbortSignal) → cancelled', async () => {
  const ctrl = new AbortController();
  const p = new GeminiClient('SLOW_KEY_AAAAAAAAAAAAAAAA').generate({ model: 'm', parts: [{ text: 'x' }], signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 100);
  await assert.rejects(p, (e) => e.code === 'cancelled');
});
test('네트워크 오류 → network', async () => {
  const c = new GeminiClient(GOOD); c.base = 'http://127.0.0.1:1/v1beta';
  await assert.rejects(() => c.listModels(), (e) => e.code === 'network');
});
test('잘못된 응답(글자만 옴 / 이미지 없음 / 후보 없음 / 차단) 처리', () => {
  const c = new GeminiClient(GOOD);
  assert.throws(() => c.parse({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }, { wantImage: true }), (e) => e.code === 'bad_response');
  assert.throws(() => c.parse({}), (e) => e.code === 'bad_response');
  assert.throws(() => c.parse({ candidates: [] }), (e) => e.code === 'bad_response');
  assert.throws(() => c.parse({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }), (e) => e.code === 'bad_response');
  assert.throws(() => c.parse({ promptFeedback: { blockReason: 'SAFETY' } }), (e) => e.code === 'blocked');
  assert.throws(() => c.parse({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }, { wantImage: true }), (e) => e.code === 'blocked');
  const ok = c.parse({ candidates: [{ content: { parts: [{ text: 'a' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }, finishReason: 'STOP' }] }, { wantImage: true });
  assert.equal(ok.images.length, 1);
});
test('출처 추출: groundingChunks 의 중복 제거', () => {
  const c = new GeminiClient(GOOD);
  const r = c.parse({ candidates: [{ content: { parts: [{ text: 'x' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://a.com', title: 'a' } }, { web: { uri: 'https://a.com', title: 'a' } }, { web: { uri: 'https://b.com' } }] } }] });
  assert.deepEqual(r.sources.map((s) => s.uri), ['https://a.com', 'https://b.com']);
});
test('키는 URL이 아닌 헤더로만 전송, 오류 메시지에서 키는 가려진다', async () => {
  await new GeminiClient(GOOD).listModels();
  await new GeminiClient(GOOD).generate({ model: 'gemini-3-flash-preview', parts: [{ text: '[TASK:photos]' }] });
  const log = await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json();
  assert.ok(log.length >= 1 && log.every((l) => l.keyHeader));
  assert.equal(redact('요청 AIzaSyA1234567890123456789012345 실패', 'zzz'), '요청 [키] 실패');
  assert.equal(redact('키 SECRETKEYVALUE 노출', 'SECRETKEYVALUE'), '키 [키] 노출');
});
test('테스트 모의 주소는 DPA_TEST=1 일 때만 사용(평소엔 Google 주소 고정)', () => {
  const saved = process.env.DPA_TEST; delete process.env.DPA_TEST;
  try { assert.match(new GeminiClient('k').base, /^https:\/\/generativelanguage\.googleapis\.com/); } finally { process.env.DPA_TEST = saved; }
});
