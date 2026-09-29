import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSlides, validateBrief } from '../src/content.js';
import { renderCards } from '../src/cards.js';
import { buildSceneHtml, planScenes } from '../src/reel.js';
import { resolveTheme } from '../src/templates.js';
import { fillFacts, checkFactText, offlineDetail, offlineAdCopy, generateAdCopy } from '../src/formats.js';
import { offlineCopy, checkCaption, systemPrompt } from '../src/ai.js';
import { KINDS, factRows } from '../src/kinds.js';

const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));
const product = {
  kind: 'product',
  title: '하루 한 컵\n저당 그래놀라',
  subtitle: '설탕 대신 알룰로스',
  instructor: '긍정팜',
  painPoints: ['아침 거르기 일쑤', '시판 시리얼은 너무 달다', '간편하면서 든든한 게 없다'],
  curriculum: ['통귀리 45%', '개별 소포장 30g', '무설탕 요거트와 궁합'],
  benefits: ['첫 구매 무료배송', '2+1 체험팩'],
  price: '12,900원',
  place: '스마트스토어',
  cta: '프로필 링크에서 구매',
};

test('업종: 상품은 일시·강사 없이도 유효, 교육은 여전히 필수', () => {
  validateBrief(product);
  validateBrief({ ...product, instructor: '', date: '' });
  assert.throws(() => validateBrief({ ...product, kind: 'edu' }), /instructor.*date|date/);
  assert.throws(() => validateBrief({ ...product, cta: '' }), /cta/);
});

test('업종: 슬라이드 제목·사실 라벨이 업종에 맞게 바뀐다', () => {
  const s = buildSlides({ ...product, instructor: '' });
  assert.equal(s[1].heading, KINDS.product.heads.pain);
  assert.equal(s[3].heading, '이런 점이 다릅니다');
  assert.equal(s[0].by, ''); // 브랜드가 없으면 표지에 표시하지 않음
  assert.deepEqual(s[5].rows, [['구매처', '스마트스토어'], ['가격', '12,900원']]);
  assert.deepEqual(factRows({ kind: 'service', date: '매일 10~21시', place: '', price: '' }), [['운영 시간', '매일 10~21시']]);
  const theme = resolveTheme('bold', brand.colors);
  const html = planScenes(s).map((sc) => buildSceneHtml(sc, sc.slide, theme, '@gp', sc.kind === 'cta')).join('');
  assert.ok(html.includes('<dt>구매처</dt>') && !html.includes('<dt>수강료</dt>') && !html.includes('with '));
});

test('업종: 상품 카드뉴스 6장 렌더', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-'));
  const files = await renderCards(buildSlides(product), brand, '@gp', dir, 'bold');
  assert.equal(files.length, 6);
});

test('업종: 상세페이지 신청 블록 라벨도 업종에 맞춘다', async () => {
  const { renderDetailPage } = await import('../src/detailpage.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kind-d-'));
  const files = await renderDetailPage(offlineDetail(product), product, brand, dir);
  assert.equal(files.length, 6);
  const src = fs.readFileSync(new URL('../src/detailpage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /'수강료'|'강사'/); // 라벨은 kinds.js에서만
});

test('업종: 자리표시자는 업종별 이름으로 채우고, 사실 라벨 직접 작성은 오류', () => {
  assert.equal(fillFacts('{{구매처}}에서 {{가격}}으로 만나요', product), '스마트스토어에서 12,900원으로 만나요');
  assert.deepEqual(checkFactText('{{가격}}에 드려요', product, 'x'), []);
  assert.match(checkFactText('가격: 9,900원', product, 'x').join(), /직접 씀/);
  assert.match(checkFactText('{{기간}} 한정', product, 'x').join(), /값이 없는데/);
  assert.match(checkCaption('구매처: 쿠팡 {{사실정보}}', product).join(), /직접 씀/);
});

test('업종: AI 없이 만드는 카피·광고·상세페이지도 업종 문구를 쓴다', () => {
  const d = offlineDetail(product);
  assert.equal(d.faq.length, 3);
  assert.ok(d.faq.some((f) => f.q === '가격은 얼마인가요?' && f.a === '12,900원'));
  assert.ok(d.faq.some((f) => f.q === '어떻게 구매하나요?'));
  assert.ok(d.proof.items.includes('브랜드 긍정팜'));
  assert.equal(d.cta.title, '지금 만나보세요');
  const c = offlineCopy(product);
  assert.ok(c.caption.includes('📍 스마트스토어') && !c.caption.includes('🗓') && c.caption.includes('🙋 브랜드 긍정팜'));
  assert.ok(offlineAdCopy(product).ads[0].primaryText.includes('스마트스토어'));
  assert.match(systemPrompt({}, product), /상품 판매·커머스/);
  assert.match(systemPrompt({}, product), /instructor=브랜드/);
});

test('업종: AI 광고 프롬프트는 그 업종의 자리표시자를 안내한다', async () => {
  const ads = [0, 1, 2].map(() => ({ angle: 'a', primaryText: '{{구매처}}에서 만나요', headline: '저당 그래놀라', description: '{{가격}}', overlay: '아침 한 컵', overlaySub: '{{구매}}' }));
  const calls = [];
  const client = { beta: { messages: { create: async (p) => (calls.push(p), { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ads }) }] }) } } };
  const out = await generateAdCopy(product, { client });
  assert.match(calls[0].system, /\{\{구매처\}\} \{\{가격\}\}/);
  assert.equal(out.ads[0].primaryText, '스마트스토어에서 만나요');
  assert.equal(out.ads[0].overlaySub, '프로필 링크에서 구매');
});
