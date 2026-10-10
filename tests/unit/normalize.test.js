'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../../src/normalize.js');
const S = require('../../public/js/schema.js');

const base = { sections: { overview: '요약', features: ['특징 A', '특징 B'], spec: '구성: 본품 1개', usage: '서늘한 곳', purchase: '무료배송', checks: ['인증 확인'] } };
const orig = { name: '주스', description: '맛있는 주스 200ml 12입', target: '직장인', price: '29,900원', spec: '용량 200ml', shipping: '3,000원 / 50,000원 이상 무료', promo: '' };

test('고객층: 문자열', () => {
  const r = N.normalizeOrganize(JSON.stringify({ ...base, target: '30대 직장인' }), orig);
  assert.equal(r.target, '30대 직장인');
  assert.equal(r.targetMissing, false);
});
test('고객층: 배열', () => {
  const r = N.normalizeOrganize(JSON.stringify({ ...base, target: ['직장인', '1인 가구'] }), orig);
  assert.equal(r.target, '· 직장인\n· 1인 가구');
});
test('고객층: 객체(중첩 포함)', () => {
  const r = N.normalizeOrganize(JSON.stringify({ ...base, target: { age: '20~30대', interests: ['캠핑', '요리'], needs: '간편함' } }), orig);
  assert.match(r.target, /연령: 20~30대/);
  assert.match(r.target, /관심사:\n· 캠핑\n· 요리/);
  assert.match(r.target, /필요: 간편함/);
  assert.ok(!r.target.includes('[object Object]'));
});
test('고객층: 누락이면 설명은 유지하고 targetMissing 표시', () => {
  const r = N.normalizeOrganize(JSON.stringify(base), orig);
  assert.equal(r.target, '');
  assert.equal(r.targetMissing, true);
  assert.match(r.text, /1\. 상품 한눈에 보기\n요약/);
});
test('코드펜스·끝 쉼표·앞뒤 설명이 섞여도 파싱', () => {
  assert.deepEqual(N.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(N.parseJsonLoose('설명입니다 {"a":[1,2,],} 끝'), { a: [1, 2] });
  assert.equal(N.parseJsonLoose('JSON 아님'), null);
  assert.equal(N.parseJsonLoose(''), null);
});
test('한글 키·영문 별칭 모두 6개 구조로 정리', () => {
  const r = N.normalizeOrganize(JSON.stringify({ '상품 한눈에 보기': 'A', key_features: ['B'], specification: 'C', how_to_use: 'D', shipping: 'E', notes: 'F' }), { name: 'x', description: 'y' });
  assert.deepEqual(Object.values(r.sections).map((x) => x.replace('· ', '')), ['A', 'B', 'C', 'D', 'E', 'F']);
});
test('빈 응답·배열 응답은 bad_response', () => {
  assert.throws(() => N.normalizeOrganize('[]', orig), (e) => e.code === 'bad_response');
  assert.throws(() => N.normalizeOrganize('{"sections":{}}', orig), (e) => e.code === 'bad_response');
  assert.throws(() => N.normalizeOrganize('죄송합니다', orig), (e) => e.code === 'bad_response');
});
test('원문 가격·수량·배송 수치가 빠지면 원문 그대로 되돌려 표시', () => {
  const r = N.normalizeOrganize(JSON.stringify({ sections: { overview: '요약만 있음' }, target: 'x' }), orig);
  assert.ok(r.restoredFacts.includes('29,900원'));
  assert.ok(r.restoredFacts.includes('200ml'));
  assert.ok(r.restoredFacts.includes('12입') || r.restoredFacts.includes('3,000원'));
  assert.match(r.sections.checks, /29,900원/);
});
test('원문 수치가 이미 있으면 추가하지 않음', () => {
  const r = N.normalizeOrganize(JSON.stringify({ sections: { overview: '200ml', purchase: '29,900원 / 3,000원 / 50,000원', spec: '200ml 12입' }, target: 'x' }), { ...orig, description: '200ml' });
  assert.deepEqual(r.restoredFacts, []);
});
test('plan: 12개 블록을 채우고 프로모션 입력이 없으면 숨김', () => {
  const plan = { brief: { palette: { accent: '#112233' } }, blocks: [{ type: 'promo', fields: { title: 'AI가 지어낸 할인' } }, { type: 'hero', fields: { title: '대표', subtitle: '보조' }, imagePrompts: ['scene'] }, { type: 'cta', fields: { title: '지금 만나보세요', buttonLabel: '자세히' } }] };
  const r = N.normalizePlan(JSON.stringify(plan), { ...orig, promo: '' }, [{ assetId: 'a_0123456789abcdef' }]);
  assert.equal(r.blocks.length, 12);
  const promo = r.blocks.find((b) => b.type === 'promo');
  assert.equal(promo.hidden, true);
  assert.equal(promo.fields.title, '');
  const hero = r.blocks.find((b) => b.type === 'hero');
  assert.equal(hero.fields.title, '대표');
  assert.equal(hero.images[0].prompt, 'scene');
  assert.equal(hero.images[0].assetId, 'a_0123456789abcdef');
  assert.equal(r.blocks.find((b) => b.type === 'cta').hidden, false);
});
test('plan: 잘못된 색은 거르고 읽기 어려운 글자색은 보정', () => {
  const r = N.normalizePlan(JSON.stringify({ brief: { palette: { bg: '#FFFFFF', ink: '#FEFEFE', accent: 'red' } }, blocks: [] }), orig, []);
  assert.ok(S.contrast(r.brief.palette.ink, r.brief.palette.bg) >= 4.5);
  assert.match(r.brief.palette.accent, /^#[0-9A-F]{6}$/i);
});
test('edit-text: 구조를 유지하고 길이를 제한', () => {
  const r = N.normalizeEditText(JSON.stringify({ fields: { title: 'x'.repeat(500), items: [{ title: 'a', desc: 'b' }, 'bad', null] } }), 'features');
  assert.equal(r.fields.title.length, S.LIMITS.short);
  assert.equal(r.fields.items.length, 1);
});
test('toReadableText: 숫자·널·중첩 안전', () => {
  assert.equal(N.toReadableText(null), '');
  assert.equal(N.toReadableText(5), '5');
  assert.equal(N.toReadableText({ a: { b: { c: { d: { e: { f: 1 } } } } } }), '');
});
test('stripMarkdown: 굵게·제목·구분선·목록 기호를 평문으로', () => {
  const r = N.stripMarkdown('### **1. 사진 분석**\n\n---\n* **형태**: 보틀\n* 색상: 주황\n\n\n\n끝');
  assert.equal(r, '1. 사진 분석\n\n· 형태: 보틀\n· 색상: 주황\n\n끝');
});
