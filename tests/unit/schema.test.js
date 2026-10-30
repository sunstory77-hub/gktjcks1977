'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../public/js/schema.js');

test('상품마다 다른 팔레트(카테고리 키워드)', () => {
  const a = S.pickPalette({ name: '수분 크림', description: '촉촉한 화장품' });
  const b = S.pickPalette({ name: '무선 이어폰', description: '충전 케이스' });
  const c = S.pickPalette({ name: '한라봉 주스', description: '음료' });
  assert.equal(a.id, 'rose'); assert.equal(b.id, 'tech'); assert.equal(c.id, 'warm');
  assert.notEqual(a.accent, b.accent);
});
test('모든 기본 팔레트는 본문 대비 4.5 이상', () => {
  for (const p of S.PALETTES) assert.ok(S.contrast(p.ink, p.bg) >= 4.5, p.id);
});
test('buildBlocks: 12개 블록, 입력 없는 프로모션·CTA·사용방법은 숨김, 사진은 슬롯에 시드', () => {
  const r = S.buildBlocks({ name: '상품', description: '첫 문장입니다. 둘째 문장입니다. 셋째 문장입니다.', spec: '용량: 200ml\n구성: 12입' }, [{ assetId: 'a_aaaaaaaaaaaaaaaa' }, { assetId: 'a_bbbbbbbbbbbbbbbb' }]);
  assert.deepEqual(r.blocks.map((b) => b.type), S.BLOCK_TYPES.map((b) => b.type));
  assert.equal(r.blocks.find((b) => b.type === 'promo').hidden, true);
  assert.equal(r.blocks.find((b) => b.type === 'cta').hidden, true);
  assert.equal(r.blocks.find((b) => b.type === 'usage').hidden, true);
  const hero = r.blocks.find((b) => b.type === 'hero');
  assert.equal(hero.images[0].assetId, 'a_aaaaaaaaaaaaaaaa');
  assert.equal(hero.images[0].source, 'photo');
  assert.equal(r.blocks.find((b) => b.type === 'faq').fields.specs[0].label, '용량');
});
test('구매 제안에 제작자용 문구가 기본으로 들어가지 않는다', () => {
  const r = S.buildBlocks({ name: '상품', description: '설명' }, []);
  const all = JSON.stringify(r.blocks);
  for (const bad of ['구매 버튼 시안', '판매 전 정보를 확인하세요']) assert.ok(!all.includes(bad));
});
test('프로모션 입력이 있으면 프로모션 블록 표시', () => {
  const r = S.buildBlocks({ name: '상품', description: '설명', promo: '오픈 기념 10% 할인' }, []);
  const p = r.blocks.find((b) => b.type === 'promo');
  assert.equal(p.hidden, false);
  assert.equal(p.fields.title, '오픈 기념 10% 할인');
});
test('sanitizeProject: 알 수 없는 블록·잘못된 id·과다 항목 정리, 키 같은 필드는 버림', () => {
  const p = S.sanitizeProject({ apiKey: 'AIzaSECRETSECRETSECRET1234', product: { name: 'x'.repeat(999) }, photos: Array(9).fill({ assetId: 'a_0123456789abcdef' }), blocks: [{ type: 'evil', fields: {} }, { type: 'hero', id: '../../x', fields: { title: 't', junk: 1 }, images: [{ id: 'bad id', assetId: '../x' }] }] });
  assert.equal(p.product.name.length, 200);
  assert.equal(p.photos.length, 5);
  assert.equal(p.blocks.length, 1);
  assert.ok(S.ID_RE.test(p.blocks[0].id));
  assert.equal(p.blocks[0].images[0].assetId, null);
  assert.ok(!JSON.stringify(p).includes('AIza'));
  assert.equal(p.blocks[0].fields.junk, undefined);
});
test('이미지 슬롯 id는 블록 안에서 고유하며 삭제해도 다른 슬롯과 엮이지 않는다', () => {
  const r = S.buildBlocks({ name: '상품', description: '설명' }, []);
  const ids = r.blocks.flatMap((b) => b.images.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
});
test('블록 내용 판정', () => {
  const b = { fields: S.emptyFields('intro'), images: [] };
  assert.equal(S.blockHasContent(b), false);
  b.fields.body = '내용';
  assert.equal(S.blockHasContent(b), true);
  const g = { fields: S.emptyFields('gallery'), images: [{ assetId: 'a_0123456789abcdef', deleted: true }] };
  assert.equal(S.blockHasContent(g), false);
  g.images[0].deleted = false;
  assert.equal(S.blockHasContent(g), true);
});
