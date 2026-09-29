import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateCopy, offlineCopy, applyCopy, validateCopy, copyToMarkdown, checkCaption, COPY_SCHEMA } from '../src/ai.js';

const brief = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));

const goodCopy = {
  variants: [
    { angle: '시간 절약', tag: '10월 특강', title: '퇴근이 빨라지는\nAI 업무 비법', subtitle: 'ChatGPT·Claude 실전반', promise: '반복 업무를 AI에게 맡기세요', cta: '지금 신청하기' },
    { angle: '불안 해소', tag: '입문자 환영', title: 'AI 처음이어도\n괜찮아요', subtitle: '하루 완성 실전반', promise: '기초부터 차근차근 알려드려요', cta: '자리 확인하기' },
    { angle: '성과', tag: '원데이 클래스', title: '보고서 한 시간\n→ 10분', subtitle: '업무 자동화 실전', promise: '결과물로 증명하는 AI 활용', cta: '신청하러 가기' },
  ],
  painPoints: ['반복 문서 작업이 버겁다', 'AI 결과물이 애매하다', '뭘 배워야 할지 모른다'],
  caption: '반복 업무, 이제 줄여 볼까요?\n\n{{사실정보}}\n\n지금 신청하세요!',
  hashtags: ['AI활용', '업무자동화'],
};

// SDK 클라이언트 흉내: 요청을 기록하고 준비된 응답을 돌려준다.
function mockClient(response) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => (calls.push(params), response) } },
  };
}
const textResponse = (obj, extra = {}) => ({
  model: 'claude-opus-5',
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
  ...extra,
});

test('generateCopy: 구조화 출력·폴백·적응형 사고로 요청하고 결과를 검증해 돌려준다', async () => {
  const client = mockClient(textResponse(goodCopy));
  const copy = await generateCopy(brief, { client, model: 'claude-opus-5' });
  assert.equal(copy.variants.length, 3);
  assert.equal(copy.source, 'ai:claude-opus-5');
  const req = client.calls[0];
  assert.equal(req.model, 'claude-opus-5');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.deepEqual(req.output_config.format, { type: 'json_schema', schema: COPY_SCHEMA });
  assert.doesNotMatch(req.messages[0].content, /_note|handle/);
});

test('generateCopy: 거절(refusal)·잘림·JSON 오류·글자 수 초과는 에러', async () => {
  await assert.rejects(generateCopy(brief, { client: mockClient(textResponse(goodCopy, { stop_reason: 'refusal', stop_details: { category: 'cyber' } })) }), /거절.*cyber/);
  await assert.rejects(generateCopy(brief, { client: mockClient(textResponse(goodCopy, { stop_reason: 'max_tokens' })) }), /max_tokens/);
  await assert.rejects(generateCopy(brief, { client: mockClient({ model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] }) }), /JSON/);
  const long = structuredClone(goodCopy);
  long.variants[0].title = '아주아주아주아주아주 긴 제목입니다';
  await assert.rejects(generateCopy(brief, { client: mockClient(textResponse(long)) }), /title 한 줄/);
});

test('validateCopy: 안 개수·고민 개수 검사', () => {
  assert.deepEqual(validateCopy(goodCopy), []);
  assert.ok(validateCopy({ ...goodCopy, variants: goodCopy.variants.slice(0, 2) }).some((e) => /variants/.test(e)));
  assert.ok(validateCopy({ ...goodCopy, painPoints: ['하나'] }).some((e) => /painPoints/.test(e)));
});

test('applyCopy: 카피만 바꾸고 사실 정보(일시·장소·가격·커리큘럼·혜택)는 보존', () => {
  const b = applyCopy(brief, goodCopy, 1);
  assert.equal(b.title, goodCopy.variants[1].title);
  assert.deepEqual(b.painPoints, goodCopy.painPoints);
  for (const k of ['date', 'place', 'price', 'curriculum', 'benefits', 'instructor']) assert.deepEqual(b[k], brief[k]);
  assert.throws(() => applyCopy(brief, goodCopy, 5), /4안이 없습니다|6안이 없습니다/);
});

test('offlineCopy: API 없이 브리프 문구로 1안 + 캡션(사실 정보 포함)', () => {
  const c = offlineCopy(brief);
  assert.equal(c.source, 'offline');
  assert.equal(c.variants.length, 1);
  assert.equal(applyCopy(brief, c).title, brief.title);
  assert.match(c.caption, new RegExp(brief.date.replace(/[()]/g, '\\$&')));
  assert.ok(c.hashtags.every((t) => !/[\s#@]/.test(t)));
  assert.match(copyToMarkdown(c, brief), /## 1안 · 브리프 원문/);
});

test('offlineCopy: 브리프 hashtags가 있으면 기본 태그 대신 사용', () => {
  const c = offlineCopy({ ...brief, hashtags: ['인천시민대학', '#블로그 글쓰기'] });
  assert.deepEqual(c.hashtags, ['인천시민대학', '블로그글쓰기', brief.instructor.replace(/\s/g, '')]);
  assert.ok(offlineCopy(brief).hashtags.includes('AI활용'));
});

test('캡션 사실 정보: AI는 자리표시자만 쓰고, 일시·장소·가격·강사는 브리프 값으로 채운다', async () => {
  const copy = await generateCopy(brief, { client: mockClient(textResponse(goodCopy)) });
  for (const fact of [brief.date, brief.place, brief.price, brief.instructor]) assert.ok(copy.caption.includes(fact), fact);
  assert.ok(!copy.caption.includes('{{'));
  assert.equal(copy.warnings, undefined);
  assert.match(copy.caption, /^반복 업무, 이제 줄여 볼까요\?/);
});

test('캡션 사실 정보: 자리표시자 누락·사실 직접 작성·없는 숫자는 캡션만 브리프 문구로 대체(3안은 유지)', async () => {
  // 실사용 테스트에서 실제로 나온 형태: "일시 확인 필요" → "일시: 별도 안내 예정"
  const bad = { ...goodCopy, caption: '특강 안내\n🗓 일시: 별도 안내 예정\n수강생 95%가 만족!' };
  const errs = checkCaption(bad.caption, brief);
  assert.ok(errs.some((e) => /자리표시자 0회/.test(e)));
  assert.ok(errs.some((e) => /일시/.test(e)));
  assert.ok(errs.some((e) => /95/.test(e)));
  const copy = await generateCopy(brief, { client: mockClient(textResponse(bad)) });
  assert.equal(copy.source, 'ai:claude-opus-5');
  assert.equal(copy.variants[0].title, goodCopy.variants[0].title);
  assert.equal(copy.caption, offlineCopy(brief).caption);
  assert.match(copy.warnings[0], /브리프 문구로 대체/);
  // 브리프에 있는 숫자(커리큘럼 수 등)는 허용
  assert.deepEqual(checkCaption('4단계로 배워요\n{{사실정보}}', { ...brief, curriculum: ['a', 'b', 'c', 'd'], promise: '4단계' }), []);
});
