'use strict';
/* 다국어(번역·검수) 브라우저 종단 간 검증. AI 호출은 모의 Gemini 서버로 대체한다(실제 Google 호출 아님). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { startMock, startApp, tmpDir, getToken, apiClient, ROOT } = require('../harness.js');
const { png } = require('../mock-gemini.js');
const X = require('../../src/xlsx.js');

const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', '.tmp', 'e2e-i18n');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let cleanupFn = async () => {};
async function step(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true, detail: d || '' }); console.log(`✔ ${name}${d ? ' — ' + d : ''}`); } catch (e) {
    await cleanupFn().catch(() => {});
    results.push({ name, ok: false, detail: String(e && e.message || e).split('\n')[0] });
    console.log(`✘ ${name}\n    ${String(e && e.message || e).split('\n').slice(0, 3).join('\n    ')}`);
  }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || '불일치'}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || '조건 불충족'); };
function jpegSize(buf) {
  ok(buf[0] === 0xff && buf[1] === 0xd8, 'JPEG 시그니처 아님');
  let i = 2;
  while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); }
  throw new Error('JPEG 크기 읽기 실패');
}

(async () => {
  const mock = await startMock();
  const dataDir = tmpDir('e2ei18n');
  const app = await startApp({ dataDir, mockPort: mock.port });
  const base = `http://127.0.0.1:${app.port}/`;
  const files = path.join(OUT, 'files'); fs.mkdirSync(files, { recursive: true });
  const photo = path.join(files, 'photo.png'); fs.writeFileSync(photo, png(600, 750, [200, 120, 90]));
  const local = path.join(files, 'local-pack.png'); fs.writeFileSync(local, png(500, 500, [20, 160, 220]));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));

  const proj = () => page.evaluate(() => JSON.parse(JSON.stringify(window.DPA.project)));
  const saved = () => page.waitForFunction(() => window.DPA.rt.saveState === 'saved', null, { timeout: 8000 });
  const mlog = async () => (await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json());
  const trCalls = async () => (await mlog()).filter((l) => l.task === 'translate');
  const closeModal = async () => { for (let i = 0; i < 6 && (await page.locator('dialog[open]').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); } };
  cleanupFn = async () => { await closeModal(); await page.evaluate(() => { const d = document.querySelector('#drawer'); if (d && !d.hidden) document.querySelector('#drawer .dr-close').click(); }); };
  const tab = (name) => page.locator(`.ltab:has-text("${name}")`).first();
  const blk = (label) => page.locator(`.blk:has(.blk-name:text-is("${label}"))`);
  const waitToast = (re, t = 12000) => page.waitForFunction((src) => Array.from(document.querySelectorAll('#toasts .toast')).some((e) => new RegExp(src).test(e.innerText)), re.source, { timeout: t }).catch(async () => { throw new Error(`토스트 ${re} 없음: ${JSON.stringify(await page.locator('#toasts .toast').allInnerTexts())}`); });
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((e) => e.remove()));
  const consent = async (okText) => { await page.waitForSelector('dialog[open] #consentChk'); await page.check('#consentChk'); await page.click(`dialog[open] button:text-is("${okText}")`); };
  const dl = async (clickSel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]); return d; };
  const stepTypes = async () => (await proj()).blocks.filter((b) => !b.hidden).map((b) => b.type);

  // ───────── 준비: 한국어 상세페이지(AI 없이 기본 구성) + 모의 키 연결 ─────────
  await page.goto(base); await page.waitForFunction(() => window.__dpaReady);
  await page.fill('#fName', '제주 한라봉 주스 200ml 12입');
  await page.fill('#fDesc', '제주에서 자란 한라봉을 껍질째 착즙했습니다. 설탕을 넣지 않았습니다. 냉장 보관하세요. 200ml 12입 구성입니다.');
  await page.fill('#fTarget', '아침을 거르는 30대 직장인');
  await page.locator('#optional summary').click();
  await page.fill('#fPrice', '29,900원'); await page.fill('#fSpec', '용량: 200ml\n구성: 12입'); await page.fill('#fShipping', '3,000원 / 50,000원 이상 무료배송');
  await page.setInputFiles('#photoGrid input[type=file]', [photo]);
  await page.waitForFunction(() => window.DPA.project.photos.length === 1);
  await page.click('#btnBasic');
  await page.waitForFunction(() => window.DPA.project.blocks.length === 12);
  await page.click('#btnApi'); await page.fill('#apiKey', 'GOOD_KEY_AAAAAAAAAAAAAAAA'); await page.click('dialog[open] button:text-is("연결하기")'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();

  await step('I1 언어 막대: 한국어(원문)와 번역 언어 추가 버튼', async () => {
    ok(await tab('한국어').isVisible() && await page.locator('.ltab.add').isVisible());
    eq(await page.locator('.ltab:not(.add)').count(), 1);
    eq(await page.evaluate(() => window.DPA.lang), 'ko');
  });

  await step('I2 번역 언어 추가(영어·일본어·중국어 간체) → AI 번역 1회 동의로 3개 언어 번역', async () => {
    await page.click('.ltab.add');
    await page.waitForSelector('dialog[open]:has-text("번역 언어")');
    for (const n of ['영어', '일본어', '중국어(간체)']) await page.locator(`dialog[open] label.lang-row:has-text("${n}") input`).check();
    ok(await page.locator('dialog[open] label:has-text("바로 AI로 번역")').isVisible());
    await page.click('dialog[open] button:text-is("적용")');
    await consent('동의하고 번역');
    await page.waitForFunction(() => ['en', 'ja', 'zh-CN'].every((c) => { const d = window.DPA.project.i18n.data[c]; return d && Object.keys(d.blocks).length >= 5; }), null, { timeout: 30000 });
    const calls = await trCalls();
    eq(calls.length, 3, '번역 호출 3회');
    ok(/into English/.test(calls[0].text) && /into Japanese/.test(calls[1].text) && /into Simplified Chinese/.test(calls[2].text), '언어별 지시');
    const p = await proj();
    eq(p.i18n.langs.join(), 'en,ja,zh-CN');
    ok(Object.values(p.i18n.data.en.blocks).every((r) => r.status === 'ai' && r.srcHash), 'AI 초안 상태·원문 해시 기록');
    eq(await page.locator('.ltab:not(.add)').count(), 4);
    await saved();
    return `블록 ${Object.keys(p.i18n.data.en.blocks).length}개/언어`;
  });

  await step('I3 일본어 탭: 번역 상태 표시·진행 패널·글꼴 로드', async () => {
    await tab('日本語').click();
    await page.waitForSelector('#langPanel .lp-chips');
    const t = await page.locator('#langPanel').innerText();
    ok(/AI 초안/.test(t) && /검수 완료 0\//.test(t), '진행 패널: ' + t.slice(0, 120));
    ok(/AI로 다시 번역/.test(t) || /AI로 번역/.test(t));
    ok(await page.locator('.blk .meta .chip.st-ai').count() >= 5, '블록별 상태 칩');
    ok(await page.evaluate(() => document.fonts.check('700 24px "Noto Sans JP Variable"', '日本語')), '일본어 글꼴 로드');
    eq(await page.locator('.blk-ctl button[aria-label$="위로"]').first().isDisabled(), true, '언어 화면에서는 순서 변경 불가');
  });

  await step('I4 번역 편집 서랍: 원문 대조·직접 번역(일본어·중국어 실제 글자)·상태 전환·자동 점검', async () => {
    const intro = blk('상품 소개');
    await intro.locator('button:text-is("번역 수정")').click();
    await page.waitForSelector('#drawer .trseg');
    ok(/상품 소개 · 日本語 번역/.test(await page.locator('#drawer .dr-title').innerText()));
    const koText = await page.locator('#drawer .seg-ko').first().innerText();
    ok(/한라봉|설탕/.test(koText), '원문 표시');
    const tas = page.locator('#drawer textarea.tr-in');
    const n = await tas.count();
    ok(n >= 2, '번역 입력칸');
    await tas.nth(0).fill('済州ハルラボンを丸ごと搾りました');
    await tas.nth(1).fill('済州島で育ったハルラボンを皮ごと搾った100％ジュースです。砂糖は一切使っていません。冷蔵で保管し、開封後はお早めにお召し上がりください。（200ml×12本入り）');
    await page.waitForTimeout(400);
    eq(await page.locator('#drawer .tr-head .chip').first().innerText(), '직접 수정');
    const p = await proj();
    eq(p.i18n.data.ja.blocks.intro.status, 'edited');
    ok(/済州ハルラボン/.test(p.i18n.data.ja.blocks.intro.t.title));
    ok(await page.locator('#drawer .seg-ai a, #drawer .seg-ai button').first().isVisible(), 'AI 초안에서 수정됨 표시');
    // 숫자 점검: 원문 숫자(100, 200, 12)가 있어야 함
    await tas.nth(1).fill('済州島のハルラボンジュースです。');
    await page.waitForTimeout(300);
    ok(/숫자/.test(await page.locator('#drawer .seg-qa').nth(1).innerText()), '숫자 누락 경고: ' + await page.locator('#drawer .seg-qa').nth(1).innerText());
    await tas.nth(1).fill('済州島で育ったハルラボンを皮ごと搾った100％ジュースです。砂糖は一切使っていません。冷蔵で保管し、開封後はお早めにお召し上がりください。（200ml×12本入り）');
    await page.click('#drawer .dr-close');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'ja-intro.png') });
    ok(await page.evaluate(() => document.fonts.check('400 24px "Noto Sans JP Variable"', '済')), '한자 글리프 글꼴 로드');
  });

  await step('I5 중국어(간체) 번역·렌더링: Noto Sans SC 로드와 줄바꿈', async () => {
    await tab('简体中文').click();
    await blk('상품 소개').locator('button:text-is("번역 수정")').click();
    await page.waitForSelector('#drawer textarea.tr-in');
    const tas = page.locator('#drawer textarea.tr-in');
    await tas.nth(0).fill('整颗榨取的济州汉拿峰果汁');
    await tas.nth(1).fill('选用济州岛种植的汉拿峰，带皮整果鲜榨而成，100%纯果汁，不添加任何糖分。请冷藏保存，开封后请尽快饮用。（200ml×12瓶装）');
    await page.click('#drawer .dr-close'); await page.waitForTimeout(600);
    ok(await page.evaluate(() => document.fonts.check('400 24px "Noto Sans SC Variable"', '济')), '간체 글꼴 로드');
    const lines = await page.evaluate(() => { const R = window.DPA_RENDER; R.useLang('zh-CN'); const l = R.wrap('选用济州岛种植的汉拿峰，带皮整果鲜榨而成，100%纯果汁，不添加任何糖分。请冷藏保存，开封后请尽快饮用。（200ml×12瓶装）', 28, 400, 732); R.useLang('ko'); return l; });
    ok(lines.length >= 2, '긴 문장은 줄바꿈: ' + lines.length);
    ok(lines.every((l) => !/^[，。！？）、]/.test(l)), '줄머리 금칙: ' + JSON.stringify(lines));
    ok(lines.every((l) => !/[（(]$/.test(l)), '줄 끝 여는 괄호 금칙');
    ok(lines.some((l) => l.includes('200ml')), '숫자·단위는 한 덩어리 유지');
    await page.screenshot({ path: path.join(OUT, 'zh-intro.png') });
    return `줄 ${lines.length}개`;
  });

  await step('I6 검수 요청 → 검수 완료(검수자 기록) → 수정하면 해제', async () => {
    await tab('日本語').click();
    await blk('상품 소개').locator('button:text-is("번역 수정")').click();
    await page.waitForSelector('#drawer .tr-head');
    await page.click('#drawer button:text-is("검수 요청으로 표시")');
    eq((await proj()).i18n.data.ja.blocks.intro.status, 'review');
    await page.click('#drawer button:text-is("검수 완료")');
    await page.waitForSelector('dialog[open]:has-text("검수 완료로 표시")');
    await page.fill('dialog[open] input[aria-label="검수자 이름"]', '김번역');
    await page.click('dialog[open] button:text-is("검수 완료")');
    await page.waitForFunction(() => window.DPA.project.i18n.data.ja.blocks.intro.status === 'approved');
    const r = (await proj()).i18n.data.ja.blocks.intro;
    eq(r.by, '김번역'); ok(r.at);
    ok(/김번역/.test(await page.locator('#drawer .tr-head').innerText()));
    await clearToasts();
    await page.locator('#drawer textarea.tr-in').first().fill('済州ハルラボンを丸ごと搾りました!');
    await waitToast(/검수.*해제/);
    eq((await proj()).i18n.data.ja.blocks.intro.status, 'edited', '수정하면 해제');
    await page.click('#drawer .dr-close');
  });

  await step('I7 한국어 원문 변경 → 번역에 ‘원문 변경’ 표시 → 해당 블록만 다시 번역', async () => {
    await tab('한국어').click();
    await blk('상품 소개').locator('button:text-is("수정")').click();
    const body = page.locator('#drawer label.f:has(> span:text-is("본문")) textarea');
    await body.fill((await body.inputValue()) + ' 오늘만 한정 수량입니다.');
    await page.click('#drawer .dr-close'); await saved();
    await tab('English').click();
    await page.waitForFunction(() => document.querySelector('.blk .meta .chip.st-stale'));
    const intro = blk('상품 소개');
    ok(/원문 변경/.test(await intro.locator('.meta').innerText()));
    const t = await page.locator('#langPanel').innerText();
    ok(/원문 변경 1/.test(t), '요약 칩: ' + t);
    const before = (await trCalls()).length;
    await page.click('#langPanel button:has-text("AI로 번역")');
    await consent('동의하고 번역');
    await page.waitForFunction(() => { const P = window.DPA.project; const b = P.blocks.find((x) => x.type === 'intro'); return window.DPA.S.trStatus(P, 'en', b) === 'ai'; }, null, { timeout: 15000 });
    const calls = await trCalls();
    eq(calls.length, before + 1);
    const sent = calls[calls.length - 1].text;
    ok(/"type":"intro"/.test(sent) && !/"type":"features"/.test(sent), '원문이 바뀐 블록만 요청');
    ok(!/원문 변경/.test(await blk('상품 소개').locator('.meta').innerText()));
  });

  await step('I8 용어집·시장 정보가 번역 요청에 전달되고 점검에 반영', async () => {
    await page.click('#langPanel button:text-is("용어집")');
    await page.waitForSelector('dialog[open]:has-text("용어집")');
    await page.click('dialog[open] button:text-is("＋ 용어 추가")');
    await page.fill('dialog[open] .gl-row input[aria-label="한국어 용어"]', '한라봉');
    await page.fill('dialog[open] .gl-row input[aria-label="영어 번역어"]', 'Hallabong');
    await page.fill('dialog[open] .gl-row input[aria-label="일본어 번역어"]', 'ハルラボン');
    await closeModal();
    await page.click('#langPanel button:text-is("시장 정보")');
    await page.waitForSelector('dialog[open]:has-text("시장 정보")');
    await page.fill('dialog[open] label:has(> span:text-is("현지 가격")) input', '$24.90');
    await page.fill('dialog[open] label:has(> span:text-is("현지 상품명")) input', 'Jeju Hallabong Juice');
    await closeModal();
    await saved();
    const p = await proj();
    eq(p.i18n.glossary[0].tr.en, 'Hallabong'); eq(p.i18n.data.en.market.price, '$24.90');
    // 전체 다시 번역(덮어쓰기 확인)
    await page.evaluate(() => { window.DPA.translateLang('en', 'all'); });
    const overwrite = await page.waitForSelector('dialog[open]:has-text("덮어씁니다")', { timeout: 1500 }).then(() => true, () => false);
    if (overwrite) await page.click('dialog[open] button:text-is("덮어쓰기")');
    const before8 = (await trCalls()).length;
    await consent('동의하고 번역');
    await page.waitForFunction(() => Object.values(window.DPA.project.i18n.data.en.blocks).every((r) => r.status === 'ai') && Object.values(window.DPA.project.i18n.data.en.blocks).some((r) => Object.values(r.t).some((t) => t.includes('Jeju Hallabong Juice'))), null, { timeout: 15000 });
    eq((await trCalls()).length, before8 + 1, '전체 다시 번역은 1회 호출');
    const last = (await trCalls()).pop();
    ok(/"한라봉" → "Hallabong"/.test(last.text), '용어집 전달'); ok(/Local price: "\$24\.90"/.test(last.text), '현지 가격 전달'); ok(/Jeju Hallabong Juice/.test(last.text), '현지 상품명 전달');
    const en = (await proj()).i18n.data.en.blocks;
    ok(JSON.stringify(en).includes('Hallabong'), '번역문에 용어집 적용');
    await clearToasts();
  });

  let reviewFile;
  await step('I9 검수 패키지(XLSX) 내보내기: 언어 시트·원문/AI/검수본 열·‘검수 요청’ 표시', async () => {
    await page.click('#langPanel button:text-is("검수")');
    await page.waitForSelector('dialog[open]:has-text("전문 번역 검수")');
    await page.click('dialog[open] button:has-text("검수 패키지 내보내기")');
    await page.waitForSelector('dialog[open]:has-text("검수 패키지 내보내기")');
    for (const n of ['일본어', '중국어(간체)']) await page.locator(`dialog[open] label.chk:has-text("${n}") input`).check();
    const d = await dl('dialog[open] button:text-is("파일 만들기")');
    reviewFile = path.join(OUT, 'review.xlsx'); await d.saveAs(reviewFile);
    ok(/_검수_\d{8}\.xlsx$/.test(d.suggestedFilename()), d.suggestedFilename());
    const book = X.parseXlsx(fs.readFileSync(reviewFile));
    eq(Object.keys(book).join(), '안내,EN,JA,ZH-CN,용어집,시장정보', '시트 구성');
    ok(book.EN.length > 8 && book.EN[0].includes('번역 (검수본)'));
    ok(book.용어집.some((r) => r[0] === '한라봉' && r.includes('Hallabong')), '용어집 시트');
    ok(book.시장정보.some((r) => r[2] === '$24.90'), '시장정보 시트');
    await closeModal();
    const p = await proj();
    ok(Object.values(p.i18n.data.en.blocks).every((r) => r.status === 'review'), '내보낸 블록은 검수 요청');
    ok(Object.values(p.i18n.data.ja.blocks).some((r) => r.status === 'review'));
  });

  await step('I10 검수 결과 가져오기: 변경 미리보기 → 선택 적용 → 검수 완료·메모 반영', async () => {
    const book = X.parseXlsx(fs.readFileSync(reviewFile));
    const rows = book.EN;
    const h = rows[0];
    const cId = h.indexOf('ID'), cTr = h.indexOf('번역 (검수본)'), cSt = h.indexOf('검수 상태'), cNote = h.indexOf('검수 메모');
    const heroRow = rows.findIndex((r) => r[0] === 'hero|title');
    ok(heroRow > 0, 'hero|title 행');
    rows[heroRow][cTr] = 'One Bottle Of Pure Jeju Hallabong'; rows[heroRow][cNote] = '표현을 다듬음';
    for (let i = 1; i < rows.length; i++) if (rows[i][cId]) rows[i][cSt] = '검수 완료';
    const edited = path.join(OUT, 'review-back.xlsx');
    fs.writeFileSync(edited, X.buildXlsx(Object.entries(book).map(([name, r]) => ({ name, rows: r.map((row) => row.map((v) => v)) }))));
    await page.click('#langPanel button:text-is("검수")');
    await page.click('dialog[open] button:has-text("검수 결과 가져오기")');
    await page.waitForSelector('dialog[open]:has-text("검수 결과 가져오기")');
    await page.setInputFiles('dialog[open] input[type=file]', edited);
    await page.waitForSelector('dialog[open] .imp-row');
    const t = await page.locator('dialog[open]').innerText();
    ok(/변경 1/.test(t) && /One Bottle Of Pure Jeju Hallabong/.test(t) && /표현을 다듬음/.test(t), '변경 미리보기: ' + t.slice(0, 200));
    await page.fill('dialog[open] input[aria-label="검수자 이름"]', 'Sarah Kim');
    await page.click('dialog[open] button:text-is("선택 항목 적용")');
    await page.waitForFunction(() => window.DPA.project.i18n.data.en.blocks.hero.t.title === 'One Bottle Of Pure Jeju Hallabong');
    const p = await proj();
    const en = p.i18n.data.en.blocks;
    ok(Object.values(en).every((r) => r.status === 'approved' && r.by === 'Sarah Kim'), '모든 영어 블록 검수 완료: ' + JSON.stringify(Object.values(en).map((r) => r.status)));
    ok(/표현을 다듬음/.test(en.hero.note));
    eq(p.i18n.data.ja.blocks.hero.status, 'review', '일본어는 그대로(검수 요청 유지)');
    ok(/적용했습니다/.test((await page.locator('#toasts .toast').allInnerTexts()).join()));
    await clearToasts();
  });

  await step('I11 저장 전 검수 확인: 영어(검수 완료)는 바로 저장, 일본어(미검수)는 확인창, 엄격 모드는 차단', async () => {
    await tab('English').click();
    await page.click('#btnExport');
    await page.waitForSelector('dialog[open]:has-text("저장할 언어")');
    const diag = await page.evaluate(() => { const P = window.DPA.project, S = window.DPA.S; return JSON.stringify({ sum: S.langSummary(P, 'en'), qa: P.blocks.map((b) => [b.type, S.qaCheck(P, 'en', b).map((w) => w.code + ':' + w.path + ':' + w.msg)]).filter((x) => x[1].length) }); });
    console.log('  [진단] en 요약/경고', diag.slice(0, 700));
    const d1 = await dl('dialog[open] button:text-is("상세페이지 JPG 저장")');
    ok(/_상세페이지_en_\d{8}\.jpg$/.test(d1.suggestedFilename()), d1.suggestedFilename());
    const f1 = path.join(OUT, 'en.jpg'); await d1.saveAs(f1);
    eq(jpegSize(fs.readFileSync(f1)).w, 860);
    await closeModal();
    await tab('日本語').click();
    await page.click('#btnExport');
    let got = false; page.once('download', () => { got = true; });
    await page.click('dialog[open] button:text-is("상세페이지 JPG 저장")');
    await page.waitForSelector('dialog:has-text("검수 확인")');
    ok(/검수가 끝나지 않은 블록/.test(await page.locator('dialog:has-text("검수 확인")').innerText()));
    await page.click('dialog:has-text("검수 확인") button:text-is("취소")'); await page.waitForTimeout(600);
    ok(!got, '취소하면 저장하지 않음');
    await closeModal();
    // 엄격 모드
    await page.check('#strictChk'); await page.waitForTimeout(300);
    await page.click('#btnExport');
    await page.click('dialog[open] button:text-is("상세페이지 JPG 저장")');
    await page.waitForSelector('dialog:has-text("검수가 필요합니다")');
    ok(/설정이라 저장할 수 없습니다/.test(await page.locator('dialog:has-text("검수가 필요합니다")').innerText()));
    await page.click('dialog:has-text("검수가 필요합니다") button:text-is("확인")'); await page.waitForTimeout(400);
    ok(!got, '엄격 모드에서는 저장되지 않음');
    await closeModal();
    await page.uncheck('#strictChk');
  });

  await step('I12 언어 전용 이미지·언어별 숨김: 한국어에 영향 없음, ZIP에 반영', async () => {
    await tab('English').click();
    await blk('상품 화보').locator('button:text-is("번역 수정")').click();
    await page.waitForSelector('#drawer .slot');
    await page.locator('#drawer .slot').first().locator('button:text-is("이 언어 전용 사진으로 교체")').click();
    await page.setInputFiles('dialog[open] input[type=file]', local);
    await page.waitForFunction(() => window.DPA.project.i18n.data.en.imgs['gallery:g1']);
    const p = await proj();
    const own = p.i18n.data.en.imgs['gallery:g1'].assetId;
    const koG = p.blocks.find((b) => b.type === 'gallery').images[0].assetId;
    ok(own && own !== koG, '언어 전용 이미지 지정');
    ok(/이 언어 전용/.test(await page.locator('#drawer .slot').first().innerText()));
    await page.locator('#drawer button:has-text("이 언어에서만 블록 숨기기")').click();   // 상품 화보를 영어에서만 숨김
    await page.waitForFunction(() => window.DPA.project.i18n.data.en.hidden.gallery);
    await page.click('#drawer .dr-close');
    ok(await page.locator('.blk.is-hidden:has-text("상품 화보")').count(), '영어에서 숨김');
    await tab('한국어').click();
    ok(!(await page.locator('.blk.is-hidden:has-text("상품 화보")').count()), '한국어에서는 보임');
    // 숨김 해제 후 ZIP 확인
    await tab('English').click();
    await page.locator('.blk.is-hidden:has-text("상품 화보") button:text-is("복원")').click();
    await page.waitForFunction(() => !window.DPA.project.i18n.data.en.hidden.gallery);
    const hash = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
    await page.click('#btnExport');
    const d = await dl('dialog[open] button:text-is("사용 중인 이미지 ZIP 저장")');
    const z = path.join(OUT, 'en-images.zip'); await d.saveAs(z);
    execFileSync('unzip', ['-tq', z]);
    const dir = path.join(OUT, 'zip-en'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir); execFileSync('unzip', ['-q', z, '-d', dir]);
    const hs = new Set(fs.readdirSync(dir).map((n) => hash(fs.readFileSync(path.join(dir, n)))));
    ok(hs.has(hash(fs.readFileSync(local))), '영어 ZIP에는 언어 전용 사진 포함');
    await closeModal();
    await tab('한국어').click();
    await page.click('#btnExport');
    const d2 = await dl('dialog[open] button:text-is("사용 중인 이미지 ZIP 저장")');
    const z2 = path.join(OUT, 'ko-images.zip'); await d2.saveAs(z2);
    const dir2 = path.join(OUT, 'zip-ko'); fs.rmSync(dir2, { recursive: true, force: true }); fs.mkdirSync(dir2); execFileSync('unzip', ['-q', z2, '-d', dir2]);
    const hs2 = new Set(fs.readdirSync(dir2).map((n) => hash(fs.readFileSync(path.join(dir2, n)))));
    ok(!hs2.has(hash(fs.readFileSync(local))), '한국어 ZIP에는 언어 전용 사진 없음');
    await closeModal();
  });

  await step('I13 모든 언어를 한 번에 저장(JPG ZIP 묶음), 일본어·중국어 글자가 들어간 JPG', async () => {
    // 일본어·중국어도 검수 완료 처리해 확인창 없이 저장
    await page.evaluate(() => { const p = window.DPA.project; const S = window.DPA.S; for (const c of ['ja', 'zh-CN']) for (const [type, r] of Object.entries(p.i18n.data[c].blocks)) { r.status = 'approved'; r.srcHash = S.fieldsHash(type, p.blocks.find((b) => b.type === type).fields); } window.DPA.touch('all'); });
    await page.waitForTimeout(300);
    await page.click('#btnExport');
    await page.waitForSelector('dialog[open]:has-text("저장할 언어")');
    for (const n of ['한국어', 'English', '日本語', '简体中文']) { const cb = page.locator(`dialog[open] label.chk.inline:has-text("${n}") input`); if (!(await cb.isChecked())) await cb.check(); }
    const d = await dl('dialog[open] button:text-is("상세페이지 JPG 저장")');
    const z = path.join(OUT, 'all-langs.zip'); await d.saveAs(z);
    ok(/_상세페이지_전체언어_\d{8}\.zip$/.test(d.suggestedFilename()), d.suggestedFilename());
    execFileSync('unzip', ['-tq', z]);
    const zr = X.readZip(fs.readFileSync(z));        // 파일명을 UTF-8 로 직접 해석(시험 환경의 unzip 은 한글 이름을 깨뜨려 표시함)
    const names = zr.names;
    ok(names.some((n) => /_상세페이지_\d{8}\.jpg$/.test(n)) && names.some((n) => /_상세페이지_en_/.test(n)) && names.some((n) => /_상세페이지_ja_/.test(n)) && names.some((n) => /_상세페이지_zh-CN_/.test(n)), names.join());
    for (const n of names) eq(jpegSize(zr.read(n)).w, 860, n);
    await closeModal();
    return `${names.length}개 JPG`;
  });

  await step('I14 새로고침 후 복원(언어·번역·검수 상태·용어집·시장 정보)', async () => {
    await saved();
    const before = await proj();
    await page.reload(); await page.waitForFunction(() => window.__dpaReady);
    const after = await proj();
    eq(JSON.stringify(after.i18n), JSON.stringify(before.i18n), 'i18n 동일');
    eq(await page.locator('.ltab:not(.add)').count(), 4);
    await tab('日本語').click();
    await page.waitForSelector('#langPanel .lp-chips');
    ok(await page.evaluate(() => document.fonts.check('400 24px "Noto Sans JP Variable"', '済')), '재실행 후 글꼴 로드');
  });

  await step('I15 백업(JSON)에 번역·검수 기록 포함, 복원하면 언어 탭과 상태 유지', async () => {
    await page.click('#btnExport');
    const d = await dl('dialog[open] button:text-is("프로젝트 백업(JSON) 저장")');
    const f = path.join(OUT, 'backup.json'); await d.saveAs(f);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    eq(j.schemaVersion, 2); eq(j.project.i18n.langs.join(), 'en,ja,zh-CN');
    ok(!/GOOD_KEY|AIza/.test(fs.readFileSync(f, 'utf8')), '키 없음');
    await page.setInputFiles('dialog[open] input[type=file][accept*=json]', f);
    await page.waitForFunction(() => window.DPA.project.name.endsWith('(복원)'), null, { timeout: 8000 });
    const p = await proj();
    eq(p.i18n.langs.join(), 'en,ja,zh-CN'); eq(p.i18n.data.en.blocks.hero.status, 'approved'); eq(p.i18n.glossary[0].ko, '한라봉');
    eq(await page.locator('.ltab:not(.add)').count(), 4);
    await closeModal();
  });

  await step('I16 번역 오류: 사용량 초과 안내, 기존 번역 보존, 재시도 가능', async () => {
    await page.click('#btnApi'); await page.click('dialog[open] button:text-is("연결 해제")'); await closeModal();
    await page.click('#btnApi'); await page.fill('#apiKey', 'QUOTA_KEY_AAAAAAAAAAAAAAA'); await page.click('dialog[open] button:text-is("연결하기")'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    await tab('English').click();
    const before = JSON.stringify((await proj()).i18n.data.en);
    await clearToasts();
    await page.click('#langPanel button:has-text("AI로 다시 번역")');
    await page.waitForSelector('dialog[open]:has-text("덮어씁니다")'); await page.click('dialog[open] button:text-is("덮어쓰기")');
    await consent('동의하고 번역');
    await waitToast(/사용량/);
    eq(JSON.stringify((await proj()).i18n.data.en), before, '기존 번역 보존');
    ok(!(await page.locator('#langPanel button:has-text("AI로 다시 번역")').isDisabled()), '다시 시도 가능');
  });

  await step('I17 언어 삭제: 확인 후 번역 기록 삭제, 되돌리기로 복구', async () => {
    await page.click('.ltab.add');
    await page.locator('dialog[open] label.lang-row:has-text("중국어(간체)") input').uncheck();
    await page.click('dialog[open] button:text-is("적용")');
    await page.waitForSelector('dialog[open]:has-text("삭제할까요")'); await page.click('dialog[open] button:text-is("삭제")');
    await page.waitForFunction(() => !window.DPA.project.i18n.langs.includes('zh-CN'));
    eq(await page.locator('.ltab:not(.add)').count(), 3);
    await page.click('#btnUndo');
    await page.waitForFunction(() => window.DPA.project.i18n.langs.includes('zh-CN'));
    ok(Object.keys((await proj()).i18n.data['zh-CN'].blocks).length >= 5, '번역 복구');
  });

  await step('I18 모바일(390px): 언어 탭·진행 패널·번역 서랍, 가로 넘침 없음', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(base); await mp.waitForFunction(() => window.__dpaReady);
    await mp.click('.tab[data-tab=preview]');
    await mp.waitForSelector('.ltab');
    await mp.locator('.ltab:has-text("日本語")').click();
    await mp.waitForSelector('#langPanel .lp-chips');
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ov <= 1, '가로 넘침 ' + ov);
    await mp.screenshot({ path: path.join(OUT, 'mobile-lang.png') });
    await mp.locator('.blk:has(.blk-name:text-is("주요 특징")) button:text-is("번역 수정")').click();
    await mp.waitForSelector('#drawer .trseg');
    const w = await mp.evaluate(() => document.querySelector('#drawer').getBoundingClientRect().width);
    ok(w >= 388, '서랍 폭 ' + w);
    await mp.screenshot({ path: path.join(OUT, 'mobile-tr-drawer.png') });
    await m.close();
  });

  await step('I19 콘솔 오류 없음', async () => { ok(errors.length === 0, errors.slice(0, 3).join(' | ')); });

  await browser.close(); await app.stop(); await mock.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const fail = results.filter((r) => !r.ok);
  console.log(`\n=== i18n E2E ${results.length - fail.length}/${results.length} 통과, 실패 ${fail.length} ===`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('치명적 오류', e); process.exit(2); });
