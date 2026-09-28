import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, loadMasterKey } from '../src/security.js';
import { sanitizeBrand, findForbidden } from '../src/brand.js';
import { testKey } from '../src/providers.js';
import { TEMPLATE_NAMES, themePairs, contrast } from '../../poc/src/templates.js';

test('비밀번호: scrypt 해시, 맞는 비밀번호만 통과, 같은 비밀번호도 해시는 매번 다름', () => {
  const h = hashPassword('correct horse');
  assert.match(h, /^scrypt\$/);
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong horse', h));
  assert.notEqual(h, hashPassword('correct horse'));
});

test('API 키 암호화: 복호화 가능, 다른 회사·공급자로는 복호화 실패(AAD 결합)', () => {
  const mk = crypto.randomBytes(32);
  const blob = encryptSecret(mk, 'sk-ant-secret-value-1234', 'company-A', 'anthropic');
  assert.ok(!blob.includes('secret'));
  assert.equal(decryptSecret(mk, blob, 'company-A', 'anthropic'), 'sk-ant-secret-value-1234');
  assert.throws(() => decryptSecret(mk, blob, 'company-B', 'anthropic'));
  assert.throws(() => decryptSecret(mk, blob, 'company-A', 'gemini'));
  assert.throws(() => decryptSecret(crypto.randomBytes(32), blob, 'company-A', 'anthropic'));
});

test('마스터 키: 운영 환경에서는 환경변수 필수, 개발은 자동 생성(권한 600)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'));
  assert.throws(() => loadMasterKey(d, { NODE_ENV: 'production' }), /APP_MASTER_KEY/);
  assert.throws(() => loadMasterKey(d, { APP_MASTER_KEY: 'c2hvcnQ=' }), /32바이트/);
  const k = loadMasterKey(d, {});
  assert.equal(k.length, 32);
  assert.equal(fs.statSync(path.join(d, '.master_key')).mode & 0o777, 0o600);
  assert.ok(loadMasterKey(d, {}).equals(k));
});

test('브랜드 색상: 대비가 모자란 색은 자동 보정하고 무엇을 바꿨는지 알려 준다', () => {
  const { brand, adjusted } = sanitizeBrand({ colors: { primary: '#FFB000', accent: '#FFE680', dark: '#555566', light: '#FFFFFF', muted: '#AAAAAA' } });
  assert.deepEqual(adjusted.map((a) => a.role).sort(), ['muted', 'primary']);
  for (const name of TEMPLATE_NAMES) {
    for (const [label, fg, bg] of themePairs(name, brand.colors)) assert.ok(contrast(fg, bg) >= 3, `${name} ${label}`);
  }
  // 잘못된 형식은 기본값으로, 좋은 색은 그대로
  const ok = sanitizeBrand({ colors: { primary: 'red' } });
  assert.equal(ok.brand.colors.primary, '#D95F00');
  assert.deepEqual(ok.adjusted, []);
});

test('금지 표현: 카피 3안·고민·캡션에서 위치와 함께 찾는다', () => {
  const copy = { variants: [{ title: '업계 1위 강의', tag: '', subtitle: '', promise: '', cta: '' }], painPoints: ['무조건 된다'], caption: '1위!' };
  const hits = findForbidden(copy, ['1위', '무조건', '최고']);
  assert.deepEqual(hits, [
    { word: '1위', where: ['1안 title', '캡션'] },
    { word: '무조건', where: ['고민 1'] },
  ]);
});

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => (calls.push({ url, init }), { ok: status < 400, status, json: async () => body });
  fn.calls = calls;
  return fn;
}

test('키 연결 테스트: 형식 검사 → 모델 목록 조회(키는 헤더로) → 사용할 모델 결정', async () => {
  await assert.rejects(testKey('anthropic', 'not-a-key'), /형식/);
  const f = fakeFetch(200, { data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5' }] });
  const r = await testKey('anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', { fetchImpl: f });
  assert.equal(r.textModel, 'claude-opus-5');
  assert.equal(f.calls[0].init.headers['x-api-key'], 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  assert.ok(!f.calls[0].url.includes('sk-ant'));
  await assert.rejects(testKey('anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', { fetchImpl: fakeFetch(401, {}) }), /유효하지 않거나/);

  const g = await testKey('gemini', 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', {
    fetchImpl: fakeFetch(200, { models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/imagen-4.0' }, { name: 'models/gemini-3.1-flash-image' }] }),
  });
  assert.deepEqual(g.models, ['gemini-3.1-flash-image']);
  assert.equal(g.imageModel, 'gemini-3.1-flash-image');
  await assert.rejects(testKey('gemini', 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { fetchImpl: fakeFetch(200, { models: [{ name: 'models/imagen-4.0' }] }) }), /이미지 모델이 없습니다/);
});
