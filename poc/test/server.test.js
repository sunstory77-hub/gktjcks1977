import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp, sanitizeBrief } from '../src/server.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
let server, base, rendered;

before(async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  rendered = [];
  server = createApp({
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
