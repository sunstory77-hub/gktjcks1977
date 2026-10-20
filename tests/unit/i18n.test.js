'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../../public/js/schema.js');
const N = require('../../src/normalize.js');
const X = require('../../src/xlsx.js');
const XL = require('../../src/xliff.js');
const R = require('../../src/review.js');
const { makeProject } = require('../fixtures/sample-project.js');

const find = (p, type) => p.blocks.find((b) => b.type === type);

// ───────────── 스키마·번역 상태·점검 ─────────────
test('i18n 정리: 지원하지 않는 언어·원문 언어·중복 제거, v1 프로젝트 호환', () => {
  const i = S.sanitizeI18n({ langs: ['en', 'xx', 'ko', 'en', 'ja'], data: { fr: { blocks: {} } } });
  assert.deepEqual(i.langs, ['en', 'ja']);
  assert.deepEqual(Object.keys(i.data), ['en', 'ja']);
  assert.deepEqual(S.sanitizeProject({ schemaVersion: 1, product: { name: 'x' } }).i18n, { langs: [], data: {}, glossary: [], strict: false });
  assert.equal(S.SCHEMA_VERSION, 2);
});
test('번역 레코드는 경로→문장 평면 맵: 구조가 원문과 같고 번역이 없는 경로는 원문을 보여 주며 경고', () => {
  const p = makeProject({ translate: false });
  const f = find(p, 'features');
  p.i18n.data.en.blocks.features = { t: { 'items.0.title': 'First.', 'items.2.title': 'Third.' }, ai: null, status: 'ai', srcHash: S.fieldsHash('features', f.fields), note: '', by: '', at: '', updatedAt: '' };
  const lb = S.localizeBlock(p, 'en', f);
  assert.equal(lb.fields.items[0].title, 'First.');
  assert.equal(lb.fields.items[1].title, f.fields.items[1].title, '빠진 경로는 원문 그대로');
  assert.equal(lb.fields.items.length, f.fields.items.length);
  assert.ok(S.qaCheck(p, 'en', f).some((w) => w.code === 'missing' && w.path === 'items.1.title'));
});
test('상태: 미번역 → AI 초안 → 원문 변경(stale) 자동 감지', () => {
  const p = makeProject();
  const intro = find(p, 'intro');
  assert.equal(S.trStatus(p, 'en', intro), 'ai');
  intro.fields.body += ' 오늘만 한정.';
  assert.equal(S.trStatus(p, 'en', intro), 'stale');
  assert.equal(S.trStatus(makeProject({ translate: false }), 'en', find(p, 'intro')), 'none');
  assert.equal(S.trStatus(p, 'en', find(S.sanitizeProject({ blocks: [{ type: 'usage', fields: {} }] }), 'usage')), 'n/a');
  p.i18n.data.en.blocks.intro.status = 'approved'; intro.fields.body = intro.fields.body.replace(' 오늘만 한정.', '');
  assert.equal(S.trStatus(p, 'en', intro), 'approved');
});
test('자동 점검: 숫자·한글 잔존·번역 금지·용어집·현지 상품명·길이', () => {
  const p = makeProject({ glossary: [{ ko: '한라봉', tr: { en: 'Hallabong' } }, { ko: 'JEJU-PURE', dnt: true, tr: {} }] });
  const info = find(p, 'info');
  const rec = p.i18n.data.en.blocks.info;
  const titlePath = 'title';
  rec.t[titlePath] = 'Juice 200 ml for 13 pcs';                       // 숫자 불일치(12 → 13)
  assert.ok(S.qaCheck(p, 'en', info).some((w) => w.code === 'number' && w.path === titlePath));
  rec.t[titlePath] = 'Juice 200ml 12pcs 한라봉';                       // 한글 잔존
  assert.ok(S.qaCheck(p, 'en', info).some((w) => w.code === 'hangul'));
  rec.t[titlePath] = 'Orange Juice 200ml 12pcs';                       // 용어집 위반(한라봉→Hallabong 필요)
  assert.ok(S.qaCheck(p, 'en', info).some((w) => w.code === 'glossary' && /Hallabong/.test(w.msg)));
  rec.t[titlePath] = 'Hallabong Juice 200ml 12pcs';
  assert.ok(!S.qaCheck(p, 'en', info).some((w) => w.path === titlePath), '정상 번역은 경고 없음');
  p.i18n.data.en.market.name = 'Jeju Hallabong Drink';                  // 현지 상품명 미사용
  assert.ok(S.qaCheck(p, 'en', info).some((w) => w.code === 'name'));
  const intro = find(p, 'intro');
  p.i18n.data.en.blocks.intro.t.body = 'x'.repeat(500);
  assert.ok(S.qaCheck(p, 'en', intro).some((w) => w.code === 'long'));
});
test('가격: 현지 가격이 입력되면 원화 숫자 점검 제외, 만·천 단위 표기도 제외', () => {
  const p = makeProject();
  const info = find(p, 'info');
  const pricePath = S.flatten(info.fields).find((x) => /원/.test(x.text)).path;
  p.i18n.data.en.blocks.info.t[pricePath] = '$24.90';
  assert.ok(S.qaCheck(p, 'en', info).some((w) => w.code === 'number' && w.path === pricePath), '현지 가격 미입력이면 숫자 경고');
  p.i18n.data.en.market.price = '$24.90';
  assert.ok(!S.qaCheck(p, 'en', info).some((w) => w.path === pricePath && w.code === 'number'));
  const x = S.sanitizeProject({ blocks: [{ type: 'intro', fields: { body: '5만원 이상 무료' } }], i18n: { langs: ['en'], data: { en: { blocks: { intro: { t: { body: 'Free over KRW 50,000' }, status: 'ai', srcHash: 'z' } } } } } });
  assert.ok(!S.qaCheck(x, 'en', x.blocks[0]).some((w) => w.code === 'number'));
});
test('언어별 이미지 교체·블록 숨김·구매 링크는 원본에 영향 없이 해당 언어에만 적용', () => {
  const p = makeProject();
  const gal = find(p, 'gallery');
  gal.images[0].assetId = 'a_aaaaaaaaaaaaaaaa';
  p.i18n.data.en.imgs['gallery:g1'] = { assetId: 'a_bbbbbbbbbbbbbbbb', source: 'user' };
  p.i18n.data.en.hidden.faq = true;
  const en = S.localizeBlock(p, 'en', gal), ja = S.localizeBlock(p, 'ja', gal);
  assert.equal(en.images[0].assetId, 'a_bbbbbbbbbbbbbbbb');
  assert.equal(ja.images[0].assetId, 'a_aaaaaaaaaaaaaaaa');
  assert.equal(gal.images[0].assetId, 'a_aaaaaaaaaaaaaaaa', '원본 불변');
  assert.equal(S.localizeBlock(p, 'en', find(p, 'faq')).hidden, true);
  assert.equal(S.localizeBlock(p, 'ja', find(p, 'faq')).hidden, find(p, 'faq').hidden);
  const cta = find(p, 'cta'); cta.fields = { title: '지금 만나보세요', buttonLabel: '보기', buttonUrl: 'https://kr.example/p' }; cta.hidden = false;
  p.i18n.data.en.blocks.cta = { t: { title: 'Meet it now', buttonLabel: 'View' }, ai: null, status: 'ai', srcHash: S.fieldsHash('cta', cta.fields), note: '', by: '', at: '', updatedAt: '' };
  assert.equal(S.localizeBlock(p, 'en', cta).fields.buttonUrl, 'https://kr.example/p');
  p.i18n.data.en.market.buyUrl = 'https://us.example/p';
  assert.equal(S.localizeBlock(p, 'en', cta).fields.buttonUrl, 'https://us.example/p');
});
test('진행 요약: 내보내기 대상 블록만 집계, 전부 검수 완료면 ready', () => {
  const p = makeProject();
  let sum = S.langSummary(p, 'en');
  assert.ok(sum.total >= 5 && sum.ai === sum.total && !sum.ready);
  for (const rec of Object.values(p.i18n.data.en.blocks)) rec.status = 'approved';
  sum = S.langSummary(p, 'en');
  assert.equal(sum.approved, sum.total); assert.ok(sum.ready);
  p.i18n.data.en.hidden.intro = true;
  assert.equal(S.langSummary(p, 'en').total, sum.total - 1);
});

// ───────────── 번역 응답 정규화 ─────────────
test('번역 응답: 객체/배열 형식, 코드펜스, 원문에 없는 경로 무시, 누락 집계', () => {
  const src = [{ type: 'intro', segments: { title: 'a', body: 'b' } }, { type: 'faq', segments: { 'faqs.0.q': 'q', 'faqs.0.a': 'a' } }];
  const a = N.normalizeTranslation('```json\n' + JSON.stringify({ blocks: [{ type: 'intro', segments: { title: 'T', body: 'B', extra: 'X' } }, { type: 'faq', segments: { 'faqs.0.q': 'Q' } }] }) + '\n```', src);
  assert.deepEqual(a.blocks.intro.t, { title: 'T', body: 'B' });
  assert.deepEqual(a.blocks.faq.t, { 'faqs.0.q': 'Q' });
  assert.equal(a.missing, 1);
  const b = N.normalizeTranslation({ blocks: { intro: { segments: [{ path: 'title', text: 'T2' }, { path: 'body', translation: 'B2' }] } } }, src);
  assert.equal(b.blocks.intro.t.body, 'B2');
  assert.throws(() => N.normalizeTranslation('{"blocks":[]}', src), (e) => e.code === 'bad_response');
  assert.throws(() => N.normalizeTranslation('죄송합니다', src), (e) => e.code === 'bad_response');
});

// ───────────── XLSX / XLIFF ─────────────
test('XLSX 생성→읽기 왕복: 줄바꿈·특수문자·한/일/중 문자·공란 보존', () => {
  const buf = X.buildXlsx([{ name: 'EN', rows: [['ID', '값'], ['a|b', 'line1\nline2 & <tag> "q" 한국어 日本語 简体中文 😀'], ['c', '']] }, { name: '용어집', rows: [['x']] }]);
  const out = X.parseXlsx(buf);
  assert.deepEqual(Object.keys(out), ['EN', '용어집']);
  assert.equal(out.EN[1][1], 'line1\nline2 & <tag> "q" 한국어 日本語 简体中文 😀');
  assert.equal(out.EN[2][0], 'c'); assert.equal(out.EN[2][1] || '', '');
});
test('XLSX 읽기: 잘못된 파일·ZIP 폭탄성 입력은 오류', () => {
  assert.throws(() => X.parseXlsx(Buffer.from('not a zip at all, really not')), /ZIP|엑셀/);
  assert.throws(() => X.parseXlsx(X.makeZip([{ name: 'a.txt', data: 'x' }])), /엑셀/);
});
test('XLIFF 왕복: 상태·메모·CDATA·인라인 태그 처리', () => {
  const xml = XL.buildXliff({ original: 'p1', sourceLang: 'ko', targetLang: 'ja', units: [{ id: 'intro|body', resname: '소개', source: '냉장 & 보관 <중요>', target: '冷蔵で保管', state: 'final', notes: [{ from: 'reviewer', text: '확인' }] }] });
  const x = XL.parseXliff(xml);
  assert.equal(x.targetLang, 'ja');
  assert.equal(x.units[0].source, '냉장 & 보관 <중요>');
  assert.equal(x.units[0].state, 'final');
  assert.equal(x.units[0].notes[0].text, '확인');
  const cat = XL.parseXliff('<xliff version="1.2"><file source-language="ko" target-language="en-US"><body><trans-unit id="a|b"><source>x</source><target state="translated"><g id="1">Hello<x id="2" ctype="lb"/>world</g> <![CDATA[A & B]]></target></trans-unit></body></file></xliff>');
  assert.equal(cat.units[0].target, 'Hello\nworld A & B');
  assert.throws(() => XL.parseXliff('<html/>'), /XLIFF/);
});

// ───────────── 검수 패키지 ─────────────
test('검수 패키지 XLSX: 시트 구성·머리글·원문/AI/검수본 열, 변경 없이 되돌리면 변경 0건', () => {
  const p = makeProject();
  const buf = R.buildReviewXlsx(p, ['en', 'ja']);
  const book = X.parseXlsx(buf);
  assert.deepEqual(Object.keys(book), ['안내', 'EN', 'JA', '용어집', '시장정보']);
  assert.deepEqual(book.EN[0], Object.values(R.HDR));
  assert.ok(book.EN.length > 8 && /^[a-z]+\|[A-Za-z0-9_.]+$/.test(book.EN[1][0]));
  const imp = R.parseReviewFile(p, 'x.xlsx', buf);
  assert.deepEqual(imp.langs, ['en', 'ja']);
  assert.equal(imp.summary.changed, 0); assert.equal(imp.summary.unknown, 0); assert.equal(imp.summary.srcChanged, 0);
  assert.equal(imp.summary.total, R.segments(p, 'en').length + R.segments(p, 'ja').length);
});
test('Excel 계열 도구(openpyxl)가 저장한 검수 결과 파일 읽기: 공유 문자열·상태·메모·줄바꿈', () => {
  const p = makeProject();
  const buf = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'review-edited-openpyxl.xlsx'));
  const imp = R.parseReviewFile(p, 'review.xlsx', buf);
  const byId = (lang, id) => imp.items.find((i) => i.lang === lang && i.id === id);
  const body = byId('en', 'intro|body');
  assert.equal(body.after, 'Edited by reviewer: Jeju Hallabong 100% juice.\n(second line)');
  assert.equal(body.changed, true); assert.equal(body.status, 'approved'); assert.equal(body.note, '문장 자연스럽게 다듬음');
  assert.equal(byId('en', 'intro|title').status, 'approved'); assert.equal(byId('en', 'intro|title').changed, false);
  assert.equal(byId('en', 'hero|subtitle').status, 'flag');
  assert.equal(imp.summary.changed, 1); assert.equal(imp.summary.flagged, 1); assert.equal(imp.summary.approved, 2);
  assert.equal(body.label, '상품 소개 › 본문');
});
test('검수 가져오기: 모르는 ID·원문 변경 감지·빈 번역은 적용 대상 아님', () => {
  const p = makeProject();
  const buf = R.buildReviewXlsx(p, ['en']);
  find(p, 'intro').fields.body += ' 추가 문장.';                           // 내보낸 뒤 원문이 바뀜
  const book = X.parseXlsx(buf);
  book.EN.push(['zzz|nope', '', '', '', '', 'x', '', '', '', '']);        // 모르는 ID
  const rows = book.EN;
  const trCol = rows[0].indexOf('번역 (검수본)');
  const iBody = rows.findIndex((r) => r[0] === 'intro|body');
  rows[iBody][trCol] = '';                                              // 빈 번역
  const rebuilt = X.buildXlsx([{ name: 'EN', rows }]);
  const imp = R.parseReviewFile(p, 'x.xlsx', rebuilt);
  assert.equal(imp.summary.unknown, 1);
  assert.ok(imp.items.find((i) => i.id === 'intro|body').srcMatch === false, '원문이 바뀐 행 표시');
  assert.equal(imp.items.find((i) => i.id === 'intro|body').changed, false, '빈 번역은 변경으로 보지 않음');
  assert.throws(() => R.parseReviewFile(p, 'a.docx', Buffer.from('x')), /XLSX 또는 XLIFF/);
});
test('XLIFF 검수 패키지: 상태 매핑(final→검수 완료)과 언어 인식', () => {
  const p = makeProject();
  p.i18n.data.en.blocks.intro.status = 'approved';
  const pkg = R.buildPackage(p, ['en'], 'xliff');
  assert.match(pkg.filename, /_검수_en_\d{8}\.xlf$/);
  const xml = pkg.data.toString('utf8');
  assert.match(xml, /target-language="en"/); assert.match(xml, /state="final"/);
  const imp = R.parseReviewFile(p, 'a.xlf', Buffer.from(xml.replace('state="needs-review-translation">EN: ', 'state="needs-review-translation">CHANGED: '), 'utf8'));
  assert.equal(imp.langs[0], 'en');
  assert.ok(imp.summary.approved >= 2);
  assert.ok(imp.summary.changed >= 1);
  const multi = R.buildPackage(p, ['en', 'ja'], 'xliff');
  assert.match(multi.filename, /\.zip$/);
  assert.equal(R.langFromName('en-US'), 'en'); assert.equal(R.langFromName('zh-Hans-CN'), 'zh-CN'); assert.equal(R.langFromName('JA'), 'ja'); assert.equal(R.langFromName('fr'), null);
  assert.equal(R.statusFromLabel('검수 완료'), 'approved'); assert.equal(R.statusFromLabel('수정 필요'), 'flag'); assert.equal(R.statusFromLabel(''), '');
});
test('진행 요약: 검수 완료된 블록의 점검 경고는 저장 확인(warningsOpen)에 반영하지 않는다', () => {
  const p = makeProject();
  const hero = find(p, 'info');
  p.i18n.data.en.blocks.info.t.title = 'No numbers here';
  let sum = S.langSummary(p, 'en');
  assert.ok(sum.warnings >= 1 && sum.warningsOpen >= 1);
  p.i18n.data.en.blocks.info.status = 'approved';
  sum = S.langSummary(p, 'en');
  assert.ok(sum.warnings >= 1, '패널에는 전체 경고');
  assert.equal(sum.warningsOpen, 0, '검수 완료 블록 경고는 저장을 막지 않음');
  void hero;
});
test('검수 패키지: pending 옵션이면 이미 검수 완료한 블록은 제외', () => {
  const p = makeProject();
  const all = R.segments(p, 'en').length;
  p.i18n.data.en.blocks.intro.status = 'approved';
  const pend = R.segments(p, 'en', { pending: true });
  assert.ok(pend.length < all && !pend.some((r) => r.type === 'intro'));
  const book = X.parseXlsx(R.buildPackage(p, ['en'], 'xlsx', { pending: true }).data);
  assert.equal(book.EN.length - 1, pend.length);
});
