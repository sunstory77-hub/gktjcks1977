import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildImagePrompt, generateImage, generateCoverImage, IMAGE_STYLES } from '../src/imagegen.js';
import { makeImage } from './helpers.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));

// Gemini generateContent 응답 모양을 흉내 내는 가짜 fetch
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const { status = 200, json } = respond(calls.length);
    return { ok: status < 400, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}
const imageResponse = (buf, mimeType = 'image/png') => ({
  json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType, data: buf.toString('base64') } }] } }] },
});

test('프롬프트: 강의 주제는 넣고, 글자·로고 금지를 명시하고, 사실 정보(가격·일시·강사)는 보내지 않음', () => {
  for (const style of Object.keys(IMAGE_STYLES)) {
    const p = buildImagePrompt(brief, style);
    assert.match(p, /AI 업무 자동화/);
    assert.match(p, /no text, letters, numbers, logos/);
    assert.match(p, /lower half calm/);
    for (const fact of [brief.price, brief.date, brief.instructor, brief.handle]) assert.ok(!p.includes(fact), `${style}: ${fact}`);
  }
  assert.throws(() => buildImagePrompt(brief, 'nope'), /알 수 없는 이미지 스타일/);
});

test('generateImage: 키는 헤더로(URL에 없음), 9:16·이미지 전용 요청, 응답 이미지 디코딩', async () => {
  const png = fs.readFileSync(makeImage(path.join(tmp(), 'a.png'), { size: '90x160' }));
  const f = fakeFetch(() => imageResponse(png));
  const out = await generateImage('p', { apiKey: 'test-key', fetchImpl: f, model: 'm1' });
  const [{ url, init, body }] = f.calls;
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/m1:generateContent');
  assert.ok(!url.includes('test-key'));
  assert.equal(init.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } });
  assert.ok(out.buffer.equals(png));
  assert.equal(out.mimeType, 'image/png');
});

test('generateImage: 키 없음·HTTP 오류·안전 차단·이미지 없음은 한국어 오류로', async () => {
  await assert.rejects(generateImage('p', { apiKey: '', fetchImpl: fakeFetch(() => ({})) }), /GEMINI_API_KEY/);
  await assert.rejects(
    generateImage('p', { apiKey: 'k', fetchImpl: fakeFetch(() => ({ status: 429, json: { error: { message: 'Quota exceeded' } } })) }),
    /이미지 생성 실패 \(429\): Quota exceeded/,
  );
  await assert.rejects(generateImage('p', { apiKey: 'k', fetchImpl: fakeFetch(() => ({ json: { promptFeedback: { blockReason: 'SAFETY' } } })) }), /차단.*SAFETY/);
  await assert.rejects(
    generateImage('p', { apiKey: 'k', fetchImpl: fakeFetch(() => ({ json: { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] } })) }),
    /생성되지 않았습니다 \(IMAGE_SAFETY\)/,
  );
});

test('generateCoverImage: 생성 결과를 업로드 사진과 같이 JPEG로 정규화, 임시 파일은 지움', async () => {
  const d = tmp();
  const png = fs.readFileSync(makeImage(path.join(d, 'g.png'), { color: 'navy', size: '768x1376' }));
  const dest = path.join(d, 'out', 'cover.jpg');
  const r = await generateCoverImage(brief, dest, { style: 'abstract', apiKey: 'k', fetchImpl: fakeFetch(() => imageResponse(png)) });
  assert.equal(r.file, dest);
  assert.deepEqual([...fs.readFileSync(dest).subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.match(r.prompt, /abstract background/);
  assert.deepEqual(fs.readdirSync(path.dirname(dest)), ['cover.jpg']);
});

test('generateCoverImage: 이미지가 아닌 응답은 거부', async () => {
  const d = tmp();
  const bad = imageResponse(Buffer.from('not an image at all'), 'image/jpeg');
  await assert.rejects(generateCoverImage(brief, path.join(d, 'c.jpg'), { apiKey: 'k', fetchImpl: fakeFetch(() => bad) }), /JPG 또는 PNG/);
  assert.deepEqual(fs.readdirSync(d), []);
});
