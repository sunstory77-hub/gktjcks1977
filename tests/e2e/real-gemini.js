'use strict';
/* 실제 Gemini 키 점검(수동 실행). 환경변수 GEMINI_API_KEY 가 필요하며 키는 어디에도 기록하지 않는다.
   사용: GEMINI_API_KEY=... PHOTO=/경로/상품사진.png node tests/e2e/real-gemini.js  (비용 발생: 문구 3~4회 + 이미지 최대 9회) */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startApp, tmpDir } = require('../harness.js');

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 환경변수가 필요합니다.'); process.exit(2); }
const OUT = process.env.E2E_OUT || path.join(__dirname, '..', '.tmp', 'real');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

let app, browser;
const cleanup = async () => { try { if (browser) await browser.close(); } catch { /* 무시 */ } try { if (app) await app.stop(); } catch { /* 무시 */ } };
(async () => {
  const dataDir = tmpDir('real');
  app = await startApp({ dataDir });                       // 모의 서버 없이 실제 Google 주소 사용
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));
  const toasts = () => page.locator('#toasts .toast').allInnerTexts();
  const t0 = Date.now();
  const lap = (s) => log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

  await page.goto(`http://127.0.0.1:${app.port}/`);
  await page.waitForFunction(() => window.__dpaReady);
  await page.fill('#fName', '제주 한라봉 주스 200ml 12입');
  await page.fill('#fDesc', '제주에서 자란 한라봉을 껍질째 착즙한 100% 주스입니다. 설탕과 물을 넣지 않았습니다. 냉장 보관하고 개봉 후에는 빨리 드세요.');
  await page.fill('#fTarget', '아침을 거르는 30대 직장인');
  await page.locator('#optional summary').click();
  await page.fill('#fPrice', '29,900원');
  await page.fill('#fSpec', '용량: 200ml\n구성: 12입');
  await page.fill('#fShipping', '3,000원 / 50,000원 이상 무료배송');
  if (process.env.PHOTO) await page.setInputFiles('#photoGrid input[type=file]', [process.env.PHOTO]);
  await page.waitForTimeout(800);

  // 연결
  await page.click('#btnApi');
  await page.fill('#apiKey', KEY);
  await page.click('dialog[open] button:text-is("연결하기")');
  await Promise.race([page.waitForSelector('dialog[open] .okbox'), page.waitForSelector('dialog[open] .form-msg:not(:empty)')]);
  const conn = await page.locator('dialog[open]').innerText();
  lap('연결 결과: ' + conn.replace(/\n+/g, ' / ').slice(0, 260));
  if (!/연결되었습니다/.test(conn)) throw new Error('연결 실패');
  await page.keyboard.press('Escape');

  // AI로 정리
  await page.click('#btnOrganize');
  await page.waitForSelector('dialog[open]:has-text("외부 전송")'); await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 진행")');
  const r1 = await Promise.race([page.waitForSelector('dialog[open]:has-text("AI 정리 결과")', { timeout: 90000 }).then(() => 'ok'), page.waitForFunction(() => document.querySelector('#toasts .toast.err'), null, { timeout: 90000 }).then(() => 'err')]);
  if (r1 === 'ok') {
    const txt = await page.locator('dialog[open] textarea').inputValue();
    lap('정리 성공(' + txt.length + '자)\n' + txt.slice(0, 900));
    const tg = await page.locator('dialog[open] input:not([type=checkbox])').count() ? await page.locator('dialog[open] input:not([type=checkbox])').inputValue() : '(제안 없음)';
    lap('고객층 제안: ' + tg);
    fs.writeFileSync(path.join(OUT, 'organize.txt'), txt);
    await page.click('dialog[open] button:text-is("취소")');
  } else lap('정리 실패: ' + JSON.stringify(await toasts()));
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((e) => e.remove()));

  // 정보 검색
  await page.click('#btnSearch');
  const r2 = await Promise.race([page.waitForSelector('dialog[open]:has-text("상품 정보 검색 결과")', { timeout: 90000 }).then(() => 'ok'), page.waitForFunction(() => document.querySelector('#toasts .toast.err'), null, { timeout: 90000 }).then(() => 'err')]);
  if (r2 === 'ok') { lap('검색 결과:\n' + (await page.locator('dialog[open]').innerText()).slice(0, 900)); await page.keyboard.press('Escape'); } else lap('검색 실패: ' + JSON.stringify(await toasts()));
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((e) => e.remove()));

  // 사진 분석
  if (process.env.PHOTO) {
    await page.click('#btnPhoto');
    const r3 = await Promise.race([page.waitForSelector('dialog[open]:has-text("사진 분석 결과")', { timeout: 90000 }).then(() => 'ok'), page.waitForFunction(() => document.querySelector('#toasts .toast.err'), null, { timeout: 90000 }).then(() => 'err')]);
    if (r3 === 'ok') { lap('사진 분석:\n' + (await page.locator('dialog[open] .resbox').innerText()).slice(0, 500)); await page.keyboard.press('Escape'); } else lap('사진 분석 실패: ' + JSON.stringify(await toasts()));
    await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((e) => e.remove()));
  }

  // 전체 생성
  await page.click('#btnGenerate');
  await page.waitForSelector('dialog[open]:has-text("생성 전 확인")');
  lap('생성 전 안내: ' + (await page.locator('dialog[open] .bul').innerText()).replace(/\n+/g, ' | '));
  await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 생성")');
  await page.waitForFunction(() => document.querySelector('#genStatus .gen.ok, #genStatus .gen.warn, #genStatus .gen.err'), null, { timeout: 600000 });
  lap('생성 종료: ' + (await page.locator('#genStatus').innerText()).replace(/\n+/g, ' / '));
  const p = await page.evaluate(() => JSON.parse(JSON.stringify(window.DPA.project)));
  const slots = p.blocks.flatMap((b) => b.images.map((s) => ({ b: b.type, src: s.source, has: !!s.assetId, hidden: b.hidden })));
  lap('블록 ' + p.blocks.length + '개, AI 이미지 ' + slots.filter((s) => s.src === 'ai').length + '장, 팔레트 ' + JSON.stringify(p.brief.palette));
  lap('카테고리/분위기: ' + p.brief.category + ' / ' + p.brief.mood);
  for (const b of p.blocks) lap(`  [${b.hidden ? '숨김' : '표시'}] ${b.type}: ` + JSON.stringify(b.fields).slice(0, 150));
  fs.writeFileSync(path.join(OUT, 'project.json'), JSON.stringify(p, null, 1));
  await page.screenshot({ path: path.join(OUT, 'generated.png') });

  await page.click('#btnExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("전체 상세페이지 JPG 저장")')]);
  await dl.saveAs(path.join(OUT, 'page.jpg'));
  lap('JPG 저장: ' + fs.statSync(path.join(OUT, 'page.jpg')).size + ' bytes');
  lap('콘솔 오류: ' + JSON.stringify(errors));
  const leaks = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); n.isDirectory() ? walk(f) : leaks.push(f); } };
  walk(dataDir);
  lap('키 노출 검사: ' + (leaks.some((f) => fs.readFileSync(f).includes(KEY)) ? '발견됨(문제)' : '없음') + ` (${leaks.length}개 파일)`);
  await cleanup();
})().catch(async (e) => { console.error('실패:', String(e.message).replace(KEY, '[키]')); await cleanup(); process.exit(1); });
