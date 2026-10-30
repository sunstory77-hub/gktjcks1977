'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Store, StoreError, atomicWrite, sniffImage } = require('../../src/store.js');
const { png } = require('../mock-gemini.js');
const { tmpDir } = require('../harness.js');

const mk = async () => { const s = new Store(tmpDir('store')); await s.init(); return s; };

test('프로젝트 생성·저장·복원, rev 증가', async () => {
  const s = await mk();
  const p = await s.createProject({ name: '내 상품' });
  assert.equal(p.rev, 0);
  const w = await s.writeProject(p.id, { ...p, product: { ...p.product, name: '주스' } }, 0);
  assert.equal(w.rev, 1);
  const r = await s.readProject(p.id);
  assert.equal(r.product.name, '주스');
  assert.equal(r.rev, 1);
});
test('다른 창이 먼저 저장했으면 덮어쓰지 않고 충돌 오류', async () => {
  const s = await mk();
  const p = await s.createProject({});
  await s.writeProject(p.id, p, 0);
  await assert.rejects(() => s.writeProject(p.id, p, 0), (e) => e instanceof StoreError && e.code === 'conflict' && e.status === 409);
});
test('동시 저장 요청도 순서대로 처리(손상 없음)', async () => {
  const s = await mk();
  const p = await s.createProject({});
  const res = await Promise.allSettled([0, 1, 2, 3].map(() => s.writeProject(p.id, p, 0)));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  const r = await s.readProject(p.id);
  assert.equal(r.rev, 1);
});
test('저장 중간에 실패해도 기존 파일은 손상되지 않고 임시 파일도 남지 않는다', async () => {
  const dir = tmpDir('atomic');
  const f = path.join(dir, 'a.json');
  await atomicWrite(f, '{"ok":1}');
  const orig = fsp.rename;
  fsp.rename = async () => { throw new Error('디스크 오류(모의)'); };
  try { await assert.rejects(() => atomicWrite(f, '{"ok":2}'), /모의/); } finally { fsp.rename = orig; }
  assert.equal(fs.readFileSync(f, 'utf8'), '{"ok":1}');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp-')), []);
});
test('project.json 이 손상되면 직전 백업(.bak)으로 복구해 읽는다', async () => {
  const s = await mk();
  const p = await s.createProject({ name: 'A' });
  await s.writeProject(p.id, { ...p, name: 'B' }, 0);   // .bak = A
  await s.writeProject(p.id, { ...p, name: 'C' }, 1);   // .bak = B
  fs.writeFileSync(s.pfile(p.id), '{깨진 json');
  const r = await s.readProject(p.id);
  assert.equal(r.name, 'B');
});
test('이미지 저장: 형식 검증·크기 제한·경로 조작 차단', async () => {
  const s = await mk();
  const p = await s.createProject({});
  const ok = await s.saveAsset(p.id, png(8, 8, [1, 2, 3]));
  assert.equal(ok.mime, 'image/png');
  await assert.rejects(() => s.saveAsset(p.id, Buffer.from('MZ not an image at all')), (e) => e.code === 'bad_type');
  await assert.rejects(() => s.saveAsset(p.id, Buffer.alloc(13 * 1024 * 1024, 0xff)), (e) => e.code === 'too_large' || e.code === 'bad_type');
  await assert.rejects(() => s.readAsset(p.id, '../../etc/passwd'), (e) => e.status === 404);
  assert.throws(() => s.pdir('../x'), (e) => e.code === 'bad_id');
  assert.deepEqual(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), { mime: 'image/jpeg', ext: 'jpg' });
});
test('백업·복원: 이미지 포함, API 키 문자열 없음, 새 프로젝트로 복원', async () => {
  const s = await mk();
  const p = await s.createProject({ name: '백업 원본', product: { name: '주스' } });
  const a = await s.saveAsset(p.id, png(16, 16, [10, 20, 30]));
  const proj = await s.readProject(p.id);
  proj.photos = [{ assetId: a.id, name: 'x.png' }];
  await s.writeProject(p.id, proj, 0);
  const text = await s.exportBackup(p.id, '1.0.0');
  assert.ok(!/AIza|apiKey|api_key/i.test(text));
  const r = await s.importBackup(text);
  assert.notEqual(r.project.id, p.id);
  assert.equal(r.project.photos.length, 1);
  assert.equal(r.missingAssets, 0);
  const back = await s.readAsset(r.project.id, a.id, false);
  assert.ok(back.buf.length > 20);
});
test('잘못된 백업 파일은 명확히 거절', async () => {
  const s = await mk();
  await assert.rejects(() => s.importBackup('not json'), (e) => e.code === 'bad_backup');
  await assert.rejects(() => s.importBackup('{"format":"other"}'), (e) => e.code === 'bad_backup');
  await assert.rejects(() => s.importBackup(JSON.stringify({ format: 'detail-page-ai-backup', schemaVersion: 99, project: {} })), (e) => /업데이트/.test(e.message));
});
test('백업에 이미지가 빠져 있으면 참조를 제거하고 알림', async () => {
  const s = await mk();
  const p = await s.createProject({});
  const a = await s.saveAsset(p.id, png(8, 8, [1, 1, 1]));
  const proj = await s.readProject(p.id); proj.photos = [{ assetId: a.id, name: 'a' }]; await s.writeProject(p.id, proj, 0);
  const j = JSON.parse(await s.exportBackup(p.id, '1.0.0'));
  j.assets = {};
  const r = await s.importBackup(JSON.stringify(j));
  assert.equal(r.missingAssets, 1);
  assert.equal(r.project.photos.length, 0);
});
test('삭제는 휴지통으로 이동(복구 가능)', async () => {
  const s = await mk();
  const p = await s.createProject({});
  await s.deleteProject(p.id);
  assert.equal((await s.listProjects()).length, 0);
  assert.equal(fs.readdirSync(s.trashDir).length, 1);
});
