import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp, sanitizeBrief } from '../src/server.js';
import { makeImage } from './helpers.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
let server, base, rendered, generated;

before(async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  rendered = [];
  generated = [];
  server = createApp({
    // 실제 Gemini 호출 대신 단색 이미지를 만든다. 'fail' 제목이면 API 오류를 흉내 낸다.
    imageGenerator: async (b, dest, opts) => {
      generated.push({ brief: b, opts });
      if (b.title === 'fail') throw new Error('이미지 생성 실패 (429): Quota exceeded');
      makeImage(dest, { color: 'teal', size: '768x1376' });
      return { file: dest, prompt: 'p', model: 'fake' };
    },
    workDir,
    copyGenerator: async () => {
      throw new Error('Could not resolve authentication method');
    },
    // 실제 HyperFrames 렌더 대신 가짜 MP4를 쓴다(렌더 자체는 reel 테스트·수동 검증에서 확인).
    reelRenderer: async (slides, brand, handle, outFile, opts) => {
      rendered.push(opts);
      fs.writeFileSync(outFile, Buffer.from('fake-mp4'));
      return outFile;
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (p, body, headers = { 'content-type': 'application/json' }) =>
  fetch(base + p, { method: 'POST', headers, body: typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body) });

async function makeJob(template = 'pop') {
  const { copy } = await (await post('/api/copy', { brief, ai: false })).json();
  const res = await post('/api/preview', { brief, copy, variant: 0, template });
  assert.equal(res.status, 200);
  return res.json();
}

test('정적 화면과 폰트를 제공한다', async () => {
  const html = await fetch(base + '/').then((r) => r.text());
  assert.match(html, /홍보공장/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/fonts/Pretendard-Bold.otf')).headers.get('content-type'), 'font/otf');
});

test('메타: 템플릿 3종과 예시 브리프', async () => {
  const meta = await fetch(base + '/api/meta').then((r) => r.json());
  assert.deepEqual(meta.templates.map((t) => t.name), ['bold', 'clean', 'pop']);
  assert.equal(meta.sampleBrief.date, brief.date);
});

test('카피: AI 실패 시 입력 문구로 대체하고 경고를 준다', async () => {
  const data = await (await post('/api/copy', { brief, ai: true })).json();
  assert.equal(data.copy.source, 'offline');
  assert.match(data.warning, /인증 정보/);
});

test('필수 항목 누락은 400과 누락 항목명', async () => {
  const res = await post('/api/copy', { brief: { ...brief, date: '' }, ai: false });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /date/);
  assert.equal((await post('/api/copy', '{not json')).status, 400);
});

test('입력 정리: 길이·개수 제한, 모르는 필드 제거', () => {
  const b = sanitizeBrief({ ...brief, painPoints: 'a\nb\nc\nd\ne', title: '1\n2\n3', evil: '<script>' });
  assert.equal(b.painPoints.length, 3);
  assert.equal(b.title, '1\n2');
  assert.equal(b.evil, undefined);
});

test('미리보기: 카드뉴스 6장 PNG를 만들고 작업 ID로 제공한다', async () => {
  const job = await makeJob('clean');
  assert.equal(job.cards.length, 6);
  assert.equal(job.template, 'clean');
  const png = await fetch(base + job.cards[0]);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await png.arrayBuffer()).readUInt32BE(16), 1080);
  assert.equal(job.reel.status, 'idle');
});

test('파일 경로 조작·없는 작업은 404', async () => {
  const job = await makeJob();
  for (const p of [`/files/${job.jobId}/..%2Fbrief.json`, `/files/${job.jobId}/brief.json`, '/files/00000000-0000-0000-0000-000000000000/copy.md', '/files/abc/copy.md', '/../package.json']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('릴스: 배경음악 업로드 → 렌더 → 완료 후 ZIP에 포함', async () => {
  const job = await makeJob('pop');
  assert.equal((await post('/api/bgm', Buffer.from('x'), { 'x-file-ext': '.exe' })).status, 400);
  const { bgmId } = await (await post('/api/bgm', Buffer.from('RIFFfake'), { 'x-file-ext': '.wav' })).json();
  assert.match(bgmId, /^[0-9a-f-]{36}\.wav$/);
  assert.equal((await post(`/api/jobs/${job.jobId}/reel`, { bgmId: '../../etc/passwd' })).status, 400);

  const start = await post(`/api/jobs/${job.jobId}/reel`, { bgmId });
  assert.equal(start.status, 202);
  let view;
  for (let i = 0; i < 50; i++) {
    view = await fetch(`${base}/api/jobs/${job.jobId}`).then((r) => r.json());
    if (view.reel.status === 'done') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(view.reel.status, 'done');
  const opts = rendered.at(-1);
  assert.equal(opts.template, 'pop');
  assert.match(opts.bgm, /\.wav$/);
  assert.ok(opts.projectDir.includes(job.jobId), '작업별 프로젝트 폴더에서 렌더');

  const zipRes = await fetch(base + job.zip);
  assert.equal(zipRes.headers.get('content-type'), 'application/zip');
  assert.match(zipRes.headers.get('content-disposition'), /filename\*=UTF-8''/);
  const files = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  const names = Object.keys(files).sort();
  assert.equal(names.filter((n) => n.startsWith('카드뉴스/')).length, 6);
  assert.ok(names.includes('릴스_15초.mp4'));
  assert.match(strFromU8(files['홍보카피.md']), /## 1안/);
  assert.equal(JSON.parse(strFromU8(files['brief.json'])).date, brief.date);
});

test('영상 파일은 Range 요청(부분 전송)을 지원한다', async () => {
  const job = await makeJob();
  await post(`/api/jobs/${job.jobId}/reel`, {});
  for (let i = 0; i < 50; i++) {
    if ((await fetch(`${base}/api/jobs/${job.jobId}`).then((r) => r.json())).reel.status === 'done') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const res = await fetch(`${base}/files/${job.jobId}/reel.mp4`, { headers: { range: 'bytes=0-3' } });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), 'fake');
});

test('표지 사진: 업로드 → JPEG 정규화 → 미리보기·릴스에 반영, 잘못된 입력은 400', async () => {
  assert.equal((await post('/api/image', Buffer.from('GIF89a'), { 'x-file-ext': '.gif' })).status, 400);
  const fake = await post('/api/image', Buffer.from('not an image'), { 'x-file-ext': '.jpg' });
  assert.equal(fake.status, 400);
  assert.match((await fake.json()).error, /JPG 또는 PNG/);

  const png = fs.readFileSync(makeImage(path.join(os.tmpdir(), `cover-${Date.now()}.png`), { color: 'red' }));
  const up = await post('/api/image', png, { 'x-file-ext': '.png' });
  assert.equal(up.status, 200);
  const { imageId } = await up.json();
  assert.match(imageId, /^[0-9a-f-]{36}\.jpg$/);

  const { copy } = await (await post('/api/copy', { brief, ai: false })).json();
  assert.equal((await post('/api/preview', { brief, copy, template: 'bold', imageId: '../x.jpg' })).status, 400);
  const job = await (await post('/api/preview', { brief, copy, template: 'bold', imageId })).json();
  assert.equal(job.cards.length, 6);
  await post(`/api/jobs/${job.jobId}/reel`, {});
  for (let i = 0; i < 50; i++) {
    if ((await fetch(`${base}/api/jobs/${job.jobId}`).then((r) => r.json())).reel.status === 'done') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(rendered.at(-1).coverImage, new RegExp(`${imageId.replace('.', '\\.')}$`));
});

test('AI 배경: 생성 → imageId로 미리보기, 썸네일 제공, 스타일 검증, API 오류는 502', async () => {
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.deepEqual(meta.imageStyles.map((s) => s.name), ['classroom', 'workspace', 'abstract']);

  const res = await post('/api/image/generate', { brief, style: 'workspace' });
  assert.equal(res.status, 200);
  const { imageId, style } = await res.json();
  assert.equal(style, 'workspace');
  assert.equal(generated.at(-1).opts.style, 'workspace');
  const thumb = await fetch(`${base}/api/image/${imageId}`);
  assert.equal(thumb.headers.get('content-type'), 'image/jpeg');

  // 알 수 없는 스타일은 기본값으로
  assert.equal((await (await post('/api/image/generate', { brief, style: '__proto__' })).json()).style, 'classroom');

  const { copy } = await (await post('/api/copy', { brief, ai: false })).json();
  const job = await (await post('/api/preview', { brief, copy, variant: 0, template: 'bold', imageId })).json();
  assert.equal(job.cards.length, 6);

  const fail = await post('/api/image/generate', { brief: { ...brief, title: 'fail' } });
  assert.equal(fail.status, 502);
  assert.match((await fail.json()).error, /Quota exceeded/);
  assert.equal((await fetch(`${base}/api/image/..%2Fx.jpg`)).status, 400);
});
