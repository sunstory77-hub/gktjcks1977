import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';
import { fillFacts, checkFactText, generateAdCopy, offlineAdCopy, validateAds, generateDetail, offlineDetail, validateDetail } from '../src/formats.js';
import { reviewTexts } from '../src/review.js';
import { labelPng, readPngLabel, labelMp4, AI_SOURCE_TYPE } from '../src/ailabel.js';
import { pptxText, docxText, importFacts } from '../src/importer.js';
import { renderAdImages, AD_SIZES } from '../src/adimage.js';
import { renderDetailPage, DETAIL_W, para } from '../src/detailpage.js';
import satori from 'satori';
import { loadFonts } from '../src/cards.js';
import { makeImage } from './helpers.js';

const require = createRequire(import.meta.url);
const facts = JSON.parse(fs.readFileSync(new URL('../brief.sample.json', import.meta.url)));
const brand = JSON.parse(fs.readFileSync(new URL('../brand.json', import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-'));

// 구조화 출력 응답을 순서대로 돌려주는 가짜 클라이언트
function mockClient(...payloads) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (p) => (calls.push(p), { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payloads[Math.min(calls.length - 1, payloads.length - 1)]) }] }) } },
  };
}

test('사실 자리표시자: 값으로 채우고, 받침에 맞게 조사를 고치며, 서술어는 건드리지 않음', () => {
  const f = { instructor: '긍정하쌤', place: '인천시민대학', price: '무료', date: '9월 7일(월)' };
  assert.equal(fillFacts('{{강사}}와 함께 {{장소}}로', f), '긍정하쌤과 함께 인천시민대학으로');
  assert.equal(fillFacts('{{강사}}가 알려요', { instructor: '하태양' }), '하태양이 알려요');
  assert.equal(fillFacts('{{장소}}으로', { place: '서울' }), '서울로'); // ㄹ 받침
  assert.equal(fillFacts('{{일시}}에', f), '9월 7일(월)에'); // 한글이 아니면 그대로
  assert.equal(fillFacts('{{수강료}}이에요', f), '무료이에요'); // 서술어
});

test('사실 검사: 빈 사실 자리표시자, 모르는 자리표시자, 라벨 직접 작성, 팩트에 없는 숫자', () => {
  const f = { date: '10월 1일', place: '줌', price: '', cta: '신청' };
  assert.deepEqual(checkFactText('{{일시}} {{장소}}에서', f, 'x'), []);
  const errs = checkFactText('{{수강료}} {{할인}} 일시: 내일 · 수강생 500명', f, 'x');
  assert.ok(errs.some((e) => /수강료 값이 없는데/.test(e)));
  assert.ok(errs.some((e) => /알 수 없는 자리표시자 \{\{할인\}\}/.test(e)));
  assert.ok(errs.some((e) => /직접 씀/.test(e)));
  assert.ok(errs.some((e) => /"500"/.test(e)));
  assert.deepEqual(checkFactText('일시: {{일시}}', f, 'x'), []);
  // 한 자리 순서·개수는 허용, 단위가 붙은 주장은 검사
  assert.deepEqual(checkFactText('3가지 방법, 2단계', f, 'x'), []);
  assert.ok(checkFactText('3배 빠르게', f, 'x').some((e) => /"3"/.test(e)));
  assert.ok(checkFactText('수강생 9명', f, 'x').some((e) => /"9"/.test(e)));
});

const goodAd = (i) => ({ angle: `각도${i}`, primaryText: `고민되시죠?\n{{일시}} {{장소}}에서 만나요`, headline: '하루 만에 AI 업무', description: '실전반', overlay: '퇴근이 빨라진다', overlaySub: '{{강사}}와 함께' });

test('광고 문구: 채운 뒤 길이로 검사, 실패하면 오류를 알려 한 번 재시도, 결과는 사실이 채워짐', async () => {
  const bad = { ads: [0, 1, 2].map((i) => ({ ...goodAd(i), overlaySub: '{{일시}} · {{장소}} · {{수강료}}' })) };
  assert.ok(validateAds(bad, facts).some((e) => /overlaySub \d+자/.test(e)));
  const client = mockClient(bad, { ads: [0, 1, 2].map(goodAd) });
  const r = await generateAdCopy(facts, { client });
  assert.equal(r.attempts, 2);
  assert.match(client.calls[1].messages[0].content, /이전 결과가 다음 규칙을 어겼습니다/);
  assert.equal(r.ads[0].overlaySub, `${facts.instructor}과 함께`);
  assert.ok(r.ads[0].primaryText.includes(facts.date));
  assert.equal(client.calls[0].model, 'claude-opus-5-5');
  await assert.rejects(generateAdCopy(facts, { client: mockClient(bad) }), /광고 문구 검사 실패/);
  const off = offlineAdCopy(facts);
  assert.deepEqual(validateAds({ ads: [off.ads[0], off.ads[0], off.ads[0]] }, facts), []);
});

const goodDetail = () => ({
  hook: { title: '이런 고민 있으세요?', body: '반복 업무가 많아요.' },
  value: { title: '하루면 충분해요', body: '{{강사}}가 알려 드려요' },
  features: [1, 2, 3].map((i) => ({ title: `특징 ${i}`, body: '설명' })),
  proof: { title: '이렇게 준비했어요', items: facts.curriculum.slice(0, 3) },
  faq: [{ q: '언제 하나요?', a: '{{일시}}에 진행해요' }, { q: '어디서?', a: '{{장소}}' }, { q: '비용은?', a: '{{수강료}}입니다' }],
  cta: { title: '지금 신청', body: '{{신청}}' },
});

test('상세페이지: 6블록 구조 검사, 근거·FAQ 개수, 사실 채움, 오프라인은 사실로만 구성', async () => {
  const d = await generateDetail(facts, { client: mockClient(goodDetail()) });
  assert.equal(d.faq[0].a, `${facts.date}에 진행해요`);
  assert.equal(d.value.body, `${facts.instructor}이 알려 드려요`);
  const bad = { ...goodDetail(), features: [], faq: [{ q: '만족도?', a: '98% 만족' }] };
  const errs = validateDetail(bad, facts);
  assert.ok(errs.includes('특징은 3개여야 함'));
  assert.ok(errs.includes('FAQ는 3개여야 함'));
  assert.ok(errs.some((e) => /"98"/.test(e)));
  const off = offlineDetail(facts);
  assert.equal(off.faq.length, 3);
  assert.ok(off.faq.some((f) => f.a.includes(facts.date)));
  assert.deepEqual(validateDetail(off, facts).filter((e) => !/자 \(최대/.test(e)), []);
});

test('광고 표현 검수: 최상급·보장·수치 효과·금지어, 같은 묶음은 구체적인 것 하나만', () => {
  const hits = reviewTexts([['제목', '업계 1위 강의'], ['본문', '합격 보장! 3배 빠르게'], ['정상', '블로그 1편 완성'], ['캡션', '무료 특강']], { forbidden: ['무료'] });
  assert.deepEqual(hits.map((h) => h.word).sort(), ['1위', '3배 빠르', '무료', '합격 보장'].sort());
  assert.ok(!hits.some((h) => h.word === '보장'));
  assert.equal(hits[0].level, 'high');
});

test('AI 생성 표시: PNG에 XMP(IPTC 소스 유형), 두 번 넣어도 1개, 이미지는 그대로 열림 / MP4 메타데이터', async () => {
  const d = tmp();
  const png = makeImage(path.join(d, 'a.png'), { size: '64x64' });
  labelPng(png);
  labelPng(png);
  assert.equal(readPngLabel(png).sourceType, AI_SOURCE_TYPE);
  assert.equal(fs.readFileSync(png).toString('latin1').split('XML:com.adobe.xmp').length - 1, 1);
  const ffmpeg = require('ffmpeg-static');
  execFileSync(ffmpeg, ['-v', 'error', '-i', png, '-f', 'null', '-']);
  const mp4 = path.join(d, 'v.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-pix_fmt', 'yuv420p', mp4]);
  await labelMp4(mp4);
  const probe = execFileSync(require('ffprobe-static').path, ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'csv=p=0', mp4]).toString();
  assert.match(probe, /생성형 AI를 활용해 제작/);
});

test('자료 가져오기: PPTX·DOCX 글자 추출(순서·노트), 빈 항목은 missing으로, 잘못된 파일 거부', async () => {
  const pptx = Buffer.from(
    zipSync({
      'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>둘째 &amp; 슬라이드</a:t></a:r></a:p></p:sld>'),
      'ppt/slides/slide1.xml': strToU8('<p:sld><a:p><a:r><a:t>AI </a:t></a:r><a:r><a:t>특강</a:t></a:r></a:p><a:p><a:r><a:t>10월 1일</a:t></a:r></a:p></p:sld>'),
      'ppt/notesSlides/notesSlide1.xml': strToU8('<a:t>강사 메모</a:t>'),
    }),
  );
  assert.equal(pptxText(pptx), '[슬라이드 1]\nAI 특강\n10월 1일\n(노트) 강사 메모\n\n[슬라이드 2]\n둘째 & 슬라이드');
  const docx = Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:p><w:r><w:t xml:space="preserve">제목 </w:t></w:r><w:r><w:t>입니다</w:t></w:r></w:p><w:p><w:r><w:t>본문</w:t></w:r></w:p>') }));
  assert.equal(docxText(docx), '제목 입니다\n본문');

  const draft = { tag: '', title: 'AI 특강', subtitle: '', instructor: '', target: '', painPoints: [], promise: '', curriculum: ['a'], benefits: [], date: '10월 1일', place: '', price: '', cta: '' };
  const client = mockClient({ facts: draft, missing: ['instructor'], notes: ['강사명 확인 필요'] });
  const r = await importFacts(pptx, 'pptx', { client });
  assert.match(client.calls[0].messages[0].content, /<자료>\n\[슬라이드 1\]/);
  assert.ok(['instructor', 'place', 'price', 'cta', 'painPoints', 'benefits'].every((k) => r.missing.includes(k)));
  assert.deepEqual(r.notes, ['강사명 확인 필요']);

  const pdfClient = mockClient({ facts: draft, missing: [], notes: [] });
  await importFacts(Buffer.from('%PDF-1.4 test'), 'pdf', { client: pdfClient });
  const block = pdfClient.calls[0].messages[0].content[0];
  assert.equal(block.type, 'document');
  assert.equal(block.source.media_type, 'application/pdf');
  await assert.rejects(importFacts(Buffer.from('not pdf'), 'pdf', { client }), /PDF 파일이 아닙니다/);
  await assert.rejects(importFacts(Buffer.from('not zip'), 'pptx', { client }), /PPTX 파일을 읽을 수 없습니다/);
  await assert.rejects(importFacts(Buffer.from('x'), 'hwp', { client }), /PDF, PPTX, DOCX만/);
});

test('렌더: 광고 3비율 크기, 상세페이지 6블록 가로 860px', async () => {
  const d = tmp();
  const ads = await renderAdImages(offlineAdCopy(facts).ads[0], facts, brand, path.join(d, 'ads'), 'pop', { aiBadge: true });
  for (const [size, file] of Object.entries(ads)) {
    const png = fs.readFileSync(file);
    assert.equal(png.readUInt32BE(16), AD_SIZES[size].w);
    assert.equal(png.readUInt32BE(20), AD_SIZES[size].h);
  }
  const files = await renderDetailPage(offlineDetail(facts), facts, brand, path.join(d, 'detail'), { aiBadge: true });
  assert.deepEqual(files.map((f) => path.basename(f)), ['01_hook', '02_value', '03_features', '04_proof', '05_faq', '06_cta'].map((n) => `detail_${n}.png`));
  for (const f of files) assert.equal(fs.readFileSync(f).readUInt32BE(16), DETAIL_W);
});

test('상세페이지 문단: 단어 단위로만 줄바꿈 — 시간·날짜 같은 사실 값이 쪼개지지 않음', async () => {
  const text = '짧은 홍보문 하나를 넓혀 확장합니다. 9월 7일(월) 10:00~12:00 인천시민대학에서 함께 쓰고, 2026.09.07 초안을 손에 들고 돌아갑니다.';
  const svg = await satori({ type: 'div', props: { style: { display: 'flex', width: 360, fontFamily: 'Pretendard' }, children: para(text, '#000') } }, { width: 360, fonts: loadFonts(), embedFont: false });
  // 같은 줄(y)의 조각을 x순으로 놓고, 붙어 있으면 한 단어·틈이 있으면 단어 경계로 복원
  const rows = new Map();
  for (const [, x, y, w, t] of svg.matchAll(/<text x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)"[^>]*>([^<]*)<\/text>/g)) {
    (rows.get(y) ?? rows.set(y, []).get(y)).push({ x: +x, w: +w, t });
  }
  const lines = [...rows.values()].map((segs) => {
    segs.sort((a, b) => a.x - b.x);
    let out = '';
    segs.forEach((s, i) => (out += (i && s.x - (segs[i - 1].x + segs[i - 1].w) > 2 ? ' ' : '') + s.t));
    return out.trim().split(/\s+/);
  });
  assert.ok(lines.length >= 3, `줄 수 ${lines.length}`);
  const words = text.split(' ');
  for (const w of lines.flat()) assert.ok(words.includes(w), `잘린 단어: "${w}"`);
});
