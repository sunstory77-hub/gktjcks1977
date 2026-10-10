'use strict';
/* 브라우저(Chromium) 종단 간 검증. AI 호출은 모의 Gemini 서버로 대체한다(실제 Google 호출 아님). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { startMock, startApp, tmpDir, getToken, apiClient, ROOT } = require('../harness.js');
const { png } = require('../mock-gemini.js');

const OUT = process.env.E2E_OUT || path.join(ROOT, 'tests', '.tmp', 'e2e');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let cleanupFn = async () => {};
const GOOD = 'GOOD_KEY_AAAAAAAAAAAAAAAA';
const L = Object.fromEntries(require('../../public/js/schema.js').BLOCK_TYPES.map((b) => [b.type, b.label]));

async function step(name, fn) {
  const t0 = Date.now();
  if (process.env.E2E_SKIP_AI && /^B\d/.test(name)) { results.push({ name, ok: true, skipped: true, detail: '건너뜀(E2E_SKIP_AI)' }); console.log(`- ${name} (건너뜀)`); return; }
  try { const detail = await fn(); results.push({ name, ok: true, detail: detail || '' }); console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`); }
  catch (e) { await cleanupFn().catch(() => {}); results.push({ name, ok: false, detail: String(e && e.message || e).split('\n')[0] }); console.log(`✘ ${name}\n    ${String(e && e.message || e).split('\n').slice(0, 3).join('\n    ')}`); }
  void t0;
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || '불일치'}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg || '조건 불충족'); };

function jpegSize(buf) {
  ok(buf[0] === 0xff && buf[1] === 0xd8, 'JPEG 시그니처 아님');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('JPEG 크기를 읽지 못함');
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  // E2E_EXTERNAL_URL 이 있으면 이미 실행 중인 앱(예: wine 으로 실행한 설치본)을 대상으로 시험한다.
  const EXT = process.env.E2E_EXTERNAL_URL;
  const mock = await startMock(Number(process.env.E2E_MOCK_PORT) || 0);
  const dataDir = EXT ? process.env.E2E_DATA_DIR : tmpDir('e2e');
  const app = EXT ? { port: Number(new URL(EXT).port), stop: async () => {} } : await startApp({ dataDir, mockPort: mock.port });
  const token = await getToken(app.port);
  const api = apiClient(app.port, token);
  const base = `http://127.0.0.1:${app.port}/`;
  const files = path.join(OUT, 'files'); fs.mkdirSync(files, { recursive: true });
  const photos = [[600, 750, [200, 120, 90]], [700, 700, [90, 150, 200]], [640, 800, [120, 190, 130]], [500, 500, [190, 150, 210]], [900, 600, [220, 190, 90]]].map(([w, h, c], i) => {
    const f = path.join(files, `photo${i + 1}.png`); fs.writeFileSync(f, png(w, h, c)); return f;
  });
  const extra = path.join(files, 'extra.png'); fs.writeFileSync(extra, png(300, 300, [10, 200, 10]));
  const big = path.join(files, 'big.png'); fs.writeFileSync(big, Buffer.concat([png(10, 10, [1, 1, 1]), Buffer.alloc(11 * 1024 * 1024, 7)]));
  const txt = path.join(files, 'note.txt'); fs.writeFileSync(txt, '이미지가 아님');

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));

  const ready = async () => { await page.goto(base); await page.waitForFunction(() => window.__dpaReady, null, { timeout: 10000 }); await page.waitForFunction(() => document.fonts.check('700 20px "Pretendard Variable"')); };
  const saved = () => page.waitForFunction(() => window.DPA.rt.saveState === 'saved', null, { timeout: 8000 });
  const proj = () => page.evaluate(() => JSON.parse(JSON.stringify(window.DPA.project)));
  const server = async () => (await api.get('/api/projects/current')).json.project;
  const blk = (type) => page.locator(`.blk:has(.blk-name:text-is("${L[type]}"))`);
  const toastText = () => page.locator('#toasts .toast').allInnerTexts();
  const waitToast = (re, t = 8000) => page.waitForFunction((src) => Array.from(document.querySelectorAll('#toasts .toast')).some((e) => new RegExp(src).test(e.innerText)), re.source, { timeout: t }).catch(async (e) => { throw new Error(`토스트 ${re} 없음. 현재 토스트: ${JSON.stringify(await toastText())} / ${e.message.split('\n')[0]}`); });
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((e) => e.remove()));
  const maybeConsent = async (okText = '동의하고 진행') => { const shown = await page.waitForSelector('dialog[open]:has-text("외부 전송")', { timeout: 1500 }).then(() => true, () => false); if (shown) { await page.check('#consentChk'); await page.click(`dialog[open] button:text-is("${okText}")`); } return shown; };
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const drawerField = (label) => page.locator(`#drawer label.f:has(> span:text-is("${label}")) :is(input,textarea)`);
  const closeModal = async () => { for (let i = 0; i < 6 && (await page.locator('dialog[open]').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); } };
  cleanupFn = async () => { await closeModal(); await page.evaluate(() => { const d = document.querySelector('#drawer'); if (d && !d.hidden) document.querySelector('#drawer .dr-close').click(); }); };
  const canvasH = (type) => page.evaluate((lab) => { const c = Array.from(document.querySelectorAll('.blk')).find((e) => (e.querySelector('.blk-name') || {}).textContent === lab); const cv = c && c.querySelector('canvas'); return cv ? cv.height : 0; }, L[type]);

  // ───────── A. API 없이 ─────────
  await step('A1 실행·화면 구성(브랜드 표기, 오류 없음)', async () => {
    await ready();
    const t = await page.locator('.brand').innerText();
    ok(/DETAIL PAGE AI/.test(t) && /by BAPI/.test(t), '브랜드 표기 없음: ' + t);
    eq(await page.title(), '새 상세페이지 · DETAIL PAGE AI', '문서 제목');
    ok(await page.locator('#btnHelp').innerText() === '확인 요청', '확인 요청 메뉴');
    ok(!errors.length, '콘솔 오류: ' + errors.join(' | '));
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    ok(/Pretendard/.test(font), '글꼴: ' + font);
  });

  await step('A2 상품 정보 입력·자동 저장', async () => {
    await page.fill('#fName', '제주 한라봉 주스 200ml 12입');
    await page.fill('#fDesc', '제주에서 자란 한라봉을 착즙했습니다. 설탕을 넣지 않은 100% 착즙 주스입니다. 냉장 보관하세요. 200ml 12입 구성입니다.');
    await page.fill('#fTarget', '아침을 거르는 30대 직장인');
    await page.locator('#optional summary').click();
    await page.fill('#fPrice', '29,900원');
    await page.fill('#fSpec', '용량: 200ml\n구성: 12입');
    await page.fill('#fShipping', '3,000원 / 50,000원 이상 무료배송');
    await saved();
    const s = await server();
    eq(s.product.name, '제주 한라봉 주스 200ml 12입'); eq(s.product.price, '29,900원'); eq(s.name, '제주 한라봉 주스 200ml 12입');
  });

  await step('A3 사진 업로드: 5장 한도, 10MB 초과·형식 오류 안내', async () => {
    const inp = '#photoGrid input[type=file]';
    await page.setInputFiles(inp, [big]);
    await waitToast(/10MB/);
    await clearToasts();
    await page.setInputFiles(inp, [txt]);
    await waitToast(/JPG, PNG, WEBP/);
    await clearToasts();
    await page.setInputFiles(inp, photos.slice(0, 3));
    await page.waitForFunction(() => window.DPA.project.photos.length === 3);
    await page.setInputFiles(inp, [photos[3], photos[4], extra]);
    await page.waitForFunction(() => window.DPA.project.photos.length === 5);
    await waitToast(/최대 5장/);
    eq((await page.locator('#photoCount').innerText()), '5/5');
    eq(await page.locator('#photoGrid .ph img').count(), 5);
    await saved();
    eq((await server()).photos.length, 5);
  });

  await step('A4 AI 없이 기본 구성 생성(12블록, 입력 없는 블록은 숨김)', async () => {
    await page.click('#btnBasic');
    await page.waitForFunction(() => window.DPA.project.blocks.length === 12);
    const p = await proj();
    eq(p.blocks.filter((b) => b.hidden).map((b) => b.type).sort().join(','), 'cta,promo,usage', '숨겨진 블록');
    eq(await page.locator('.blk').count(), 12);
    await page.waitForFunction(() => document.querySelectorAll('.blk canvas').length >= 8);
    await shot('01-basic');
  });

  await step('A5 결과물 색이 앱 어두운 테마와 분리됨(밝은 팔레트 픽셀 확인)', async () => {
    const px = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.blk')).find((e) => (e.querySelector('.blk-name') || {}).textContent === '상품 소개').querySelector('canvas'); const d = c.getContext('2d').getImageData(4, 4, 1, 1).data; return [d[0], d[1], d[2]]; });
    ok(px[0] > 230 && px[1] > 230 && px[2] > 230, '상품 소개 배경이 앱 네이비가 아니라 상품 팔레트(흰색 계열)여야 함: ' + px);
    const pal = (await proj()).brief.palette;
    ok(pal.accent !== '#B6A6FF' && pal.accent !== '#7BE8C8', '앱 포인트색이 결과물에 강제되지 않음');
  });

  await step('A5b 색상 변경(결과물 팔레트만 바뀜, 앱 화면 색은 그대로)', async () => {
    const before = (await proj()).brief.palette.accent;
    const appBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('#btnPalette');
    await page.waitForSelector('dialog[open] .sw');
    await page.locator('dialog[open] .sw').nth(3).click();   // 가전/전자 계열(파랑)
    await page.waitForTimeout(300);
    const after = (await proj()).brief.palette.accent;
    ok(before !== after, '강조색 변경: ' + before + ' → ' + after);
    eq(after, '#2D62F0');
    await closeModal();
    eq(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), appBg, '앱 배경색 불변');
    await page.click('#btnUndo');
    eq((await proj()).brief.palette.accent, before, '되돌리기');
  });

  await step('A6 문구 직접 수정 → 미리보기 갱신 → 저장', async () => {
    const before = await page.evaluate(() => Array.from(document.querySelectorAll('.blk')).find((e) => (e.querySelector('.blk-name') || {}).textContent === '대표 이미지').querySelector('canvas').toDataURL().length);
    await blk('hero').locator('button:text-is("수정")').click();
    await drawerField('대표 문구').fill('아침이 달라지는 한라봉 주스');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => Array.from(document.querySelectorAll('.blk')).find((e) => (e.querySelector('.blk-name') || {}).textContent === '대표 이미지').querySelector('canvas').toDataURL().length);
    ok(before !== after, '미리보기가 갱신되지 않음');
    await saved();
    eq((await server()).blocks.find((b) => b.type === 'hero').fields.title, '아침이 달라지는 한라봉 주스');
    await page.click('#drawer .dr-close');
  });

  await step('A7 블록 순서 이동(위로/아래로)', async () => {
    const order = async () => (await proj()).blocks.map((b) => b.type);
    const o1 = await order();
    await blk('intro').locator('button[aria-label$="위로"]').click();
    const o2 = await order();
    const i = o1.indexOf('intro');
    eq(o2[i - 1], 'intro', '위로 이동'); eq(o2[i], o1[i - 1]);
    const domOrder = await page.locator('.blk .blk-name, .blk .blk-hidden span').allInnerTexts();
    ok(domOrder.indexOf('상품 소개') === i - 1, 'DOM 순서 반영');
    await blk('intro').locator('button[aria-label$="아래로"]').click();
    eq((await order()).join(), o1.join(), '원위치');
    await saved();
  });

  await step('A8 블록 숨김·복원(숨김 상태 저장)', async () => {
    await blk('faq').locator('button:text-is("숨기기")').click();
    await page.waitForSelector('.blk.is-hidden:has-text("FAQ·규격")');
    eq((await proj()).blocks.find((b) => b.type === 'faq').hidden, true);
    await saved();
    eq((await server()).blocks.find((b) => b.type === 'faq').hidden, true);
    await page.locator('.blk.is-hidden:has-text("FAQ·규격") button:text-is("복원")').click();
    await page.waitForFunction(() => !window.DPA.project.blocks.find((b) => b.type === 'faq').hidden);
    await saved();
  });

  await step('A9 이미지 교체(내 사진) · 삭제 · 복원, 다른 슬롯과 엮이지 않음', async () => {
    const p0 = await proj();
    const gal = p0.blocks.find((b) => b.type === 'gallery');
    const det = p0.blocks.find((b) => b.type === 'detail');
    const detBefore = JSON.stringify(det.images);
    await blk('gallery').locator('button:text-is("수정")').click();
    await page.locator('#drawer .slot').nth(1).locator('button:text-is("사진으로 교체")').click();
    await page.setInputFiles('dialog[open] input[type=file]', [extra]);
    await page.waitForFunction((sid) => { const s = window.DPA.project.blocks.find((b) => b.type === 'gallery').images[1]; return s.source === 'user' && s.assetId; }, null);
    const p1 = await proj();
    const g1 = p1.blocks.find((b) => b.type === 'gallery');
    eq(g1.images[1].source, 'user'); ok(g1.images[1].assetId !== gal.images[1].assetId, '이미지가 바뀜');
    eq(g1.images[0].assetId, gal.images[0].assetId, '다른 슬롯 영향 없음'); eq(g1.images[2].assetId, gal.images[2].assetId);
    eq(JSON.stringify(p1.blocks.find((b) => b.type === 'detail').images), detBefore, '다른 블록 영향 없음');
    // 삭제
    const h0 = await canvasH('gallery');
    await page.locator('#drawer .slot').nth(0).locator('button:text-is("삭제")').click();
    await page.waitForTimeout(300);
    const h1 = await canvasH('gallery');
    ok(h1 < h0, `삭제 후 높이 감소 필요 ${h0}→${h1}`);
    const p2 = await proj();
    eq(p2.blocks.find((b) => b.type === 'gallery').images[0].deleted, true);
    eq(p2.blocks.find((b) => b.type === 'gallery').images[1].deleted, false);
    await saved();
    // 복원
    await page.locator('#drawer .slot').nth(0).locator('button:text-is("복원")').click();
    await page.waitForTimeout(300);
    eq(await canvasH('gallery'), h0, '복원 후 높이 원복');
    await page.click('#drawer .dr-close');
    return `높이 ${h0}→${h1}→${h0}`;
  });

  await step('A10 되돌리기·다시 실행', async () => {
    const t0 = (await proj()).blocks.find((b) => b.type === 'hero').fields.title;
    await blk('hero').locator('button:text-is("수정")').click();
    await drawerField('대표 문구').fill('임시 문구');
    await page.waitForTimeout(200);
    await page.click('#drawer .dr-close');
    eq((await proj()).blocks.find((b) => b.type === 'hero').fields.title, '임시 문구');
    await page.click('#btnUndo');
    eq((await proj()).blocks.find((b) => b.type === 'hero').fields.title, t0, '되돌리기');
    await page.click('#btnRedo');
    eq((await proj()).blocks.find((b) => b.type === 'hero').fields.title, '임시 문구', '다시 실행');
    await page.click('#btnUndo');
    await saved();
  });

  // 이후 내보내기 검증용 상태: 숨김(프로모션 기본 숨김) + 삭제 이미지(detail d1)
  await step('A11 새로고침 후 복원(입력·블록·순서·숨김·삭제 이미지)', async () => {
    await blk('detail').locator('button:text-is("수정")').click();
    await page.locator('#drawer .slot').nth(0).locator('button:text-is("삭제")').click();
    await page.click('#drawer .dr-close');
    await blk('usage').locator('button:text-is("복원")').click().catch(() => {});
    await saved();
    const before = await proj();
    await page.reload();
    await page.waitForFunction(() => window.__dpaReady);
    const after = await proj();
    eq(JSON.stringify(after.blocks), JSON.stringify(before.blocks), '블록 상태');
    eq(await page.inputValue('#fName'), before.product.name); eq(await page.inputValue('#fPrice'), '29,900원');
    eq(await page.locator('#photoGrid .ph img').count(), 5);
    await page.waitForFunction(() => document.querySelectorAll('.blk canvas').length >= 7);
  });

  await step('A12 JPG 저장: 크기·숨김/삭제 제외·편집 UI 미포함', async () => {
    const p = await proj();
    const vis = await page.evaluate(() => window.DPA.visibleBlocks().map((b) => b.type));
    ok(!vis.includes('promo') && !vis.includes('cta'), '숨긴 블록 제외');
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("전체 상세페이지 JPG 저장")')]);
    const f = path.join(OUT, 'page.jpg'); await dl.saveAs(f);
    ok(/_상세페이지_\d{8}\.jpg$/.test(dl.suggestedFilename()), '파일명: ' + dl.suggestedFilename());
    const buf = fs.readFileSync(f); const sz = jpegSize(buf);
    eq(sz.w, 860, '가로');
    const expected = await page.evaluate(() => { const R = window.DPA_RENDER; return window.DPA.visibleBlocks().reduce((n, b) => n + R.renderBlock(b, { brief: window.DPA.project.brief, getImage: window.DPA.getImage, scale: 1, preview: false, pending: new Set() }).height, 0); });
    eq(sz.h, expected, '세로(보이는 블록 합)');
    // 삭제 이미지 제외: detail 높이 비교(삭제 전 슬롯 이미지가 있으면 더 커야 함)
    const withDel = await page.evaluate(() => { const R = window.DPA_RENDER; const b = JSON.parse(JSON.stringify(window.DPA.project.blocks.find((x) => x.type === 'detail'))); const mk = (bb) => R.renderBlock(bb, { brief: window.DPA.project.brief, getImage: window.DPA.getImage, scale: 1, preview: false, pending: new Set() }).height; const del = mk(b); b.images.forEach((s) => { s.deleted = false; }); return [del, mk(b)]; });
    ok(withDel[0] < withDel[1], `삭제 이미지가 출력에서 빠짐 ${withDel}`);
    await closeModal();
    fs.writeFileSync(path.join(OUT, 'page-info.txt'), `${sz.w}x${sz.h} bytes=${buf.length}`);
    void p;
    return `${sz.w}x${sz.h}px ${(buf.length / 1024).toFixed(0)}KB`;
  });

  await step('A13 고해상도 JPG(가로 1720)', async () => {
    await page.click('#btnExport');
    await page.check('#optHi');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("전체 상세페이지 JPG 저장")')]);
    const f = path.join(OUT, 'page-hi.jpg'); await dl.saveAs(f);
    eq(jpegSize(fs.readFileSync(f)).w, 1720);
    await closeModal();
  });

  await step('A14 이미지 ZIP: 사용 중인 이미지만, 삭제 이미지 제외, 정상 압축 해제', async () => {
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("사용 중인 이미지 ZIP 저장")')]);
    const f = path.join(OUT, 'images.zip'); await dl.saveAs(f);
    execFileSync('unzip', ['-tq', f]);
    const names = execFileSync('unzip', ['-Z1', f]).toString().trim().split('\n');
    const p = await proj();
    const visIdx = await page.evaluate(() => window.DPA.visibleBlocks().reduce((n, b) => n + b.images.filter((s) => s.assetId && !s.deleted).length, 0));
    eq(names.length, visIdx, 'ZIP 파일 수 = 사용 이미지 수');
    ok(names.every((n) => /^\d\d_.+_\d\.(png|jpg|webp)$/.test(n)), '파일명 형식: ' + names.join());
    const dir = path.join(OUT, 'zip'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
    execFileSync('unzip', ['-q', f, '-d', dir]);
    const zipHashes = new Set(fs.readdirSync(dir).map((n) => sha(fs.readFileSync(path.join(dir, n)))));
    const det = p.blocks.find((b) => b.type === 'detail').images[0];
    ok(det.deleted, '검증 대상 이미지가 삭제 상태');
    const delBytes = Buffer.from(await (await fetch(`${base}api/projects/${p.id}/assets/${det.assetId}`)).arrayBuffer());
    ok(!zipHashes.has(sha(delBytes)), '삭제한 이미지가 ZIP에 없어야 함');
    const used = p.blocks.find((b) => b.type === 'hero').images[0];
    const usedBytes = Buffer.from(await (await fetch(`${base}api/projects/${p.id}/assets/${used.assetId}`)).arrayBuffer());
    ok(zipHashes.has(sha(usedBytes)), '사용 이미지는 ZIP에 포함');
    await closeModal();
    return `${names.length}장`;
  });

  let backupFile;
  await step('A15 프로젝트 JSON 백업 → 복원(새 프로젝트)', async () => {
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("프로젝트 백업(JSON) 저장")')]);
    backupFile = path.join(OUT, 'backup.json'); await dl.saveAs(backupFile);
    const j = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    eq(j.format, 'detail-page-ai-backup'); ok(Object.keys(j.assets).length >= 5, '이미지 포함');
    ok(!/AIza|apiKey|GOOD_KEY/i.test(fs.readFileSync(backupFile, 'utf8')), '키 문자열 없음');
    await page.setInputFiles('dialog[open] input[type=file][accept*=json]', backupFile);
    await page.waitForFunction(() => window.DPA.project.name.endsWith('(복원)'), null, { timeout: 8000 });
    const p = await proj();
    eq(p.product.name, '제주 한라봉 주스 200ml 12입'); eq(p.photos.length, 5);
    await page.waitForFunction(() => document.querySelectorAll('.blk canvas').length >= 7);
    const r = await fetch(`${base}api/projects/${p.id}/assets/${p.photos[0].assetId}`);
    eq(r.status, 200, '복원된 이미지 접근');
    await closeModal();
  });

  await step('A16 프로젝트 목록·전환', async () => {
    await page.click('#btnProjects');
    await page.waitForSelector('dialog[open] .prow');
    ok((await page.locator('dialog[open] .prow').count()) >= 2, '프로젝트 2개 이상');
    const orig = page.locator('dialog[open] .prow:not(.cur) button:text-is("열기")').first();
    await orig.click();
    await page.waitForFunction(() => !window.DPA.project.name.endsWith('(복원)'));
    await closeModal();
  });

  await step('A17 확인 요청(사용 안내) 메뉴 열기', async () => {
    await page.click('#btnHelp');
    await page.waitForSelector('dialog[open] .guide h1');
    ok(/사용 안내/.test(await page.locator('dialog[open] .guide h1').innerText()));
    const t = await page.locator('dialog[open] .guide').innerText();
    ok(/API 키/.test(t) && /JPG/.test(t) && /별도 요금|사용료/.test(t), '안내 내용');
    await closeModal();
  });

  await step('A18 AI 미연결 상태에서 AI 버튼은 연결 창을 열고, 직접 편집 기능은 영향 없음', async () => {
    await page.click('#btnOrganize');
    await page.waitForSelector('dialog[open]:has-text("Gemini API 연결")');
    await closeModal();
    eq(await page.locator('#btnApi span').innerText(), 'API 연결 안 됨');
  });

  // ───────── B. AI(모의 Gemini) ─────────
  const connect = async (key) => {
    await page.click('#btnApi');
    await page.waitForSelector('dialog[open] #apiKey');
    await page.fill('#apiKey', key);
    await page.click('dialog[open] button:text-is("연결하기")');
  };
  const disconnect = async () => { await page.click('#btnApi'); await page.waitForSelector('dialog[open]'); await page.click('dialog[open] button:text-is("연결 해제")'); await closeModal(); await page.waitForFunction(() => !window.DPA.rt.connected); };

  await step('B1 API 연결: 잘못된 키 안내 → 올바른 키 연결', async () => {
    await connect('BAD_KEY_AAAAAAAAAAAAAAAAA');
    await page.waitForSelector('dialog[open] .form-msg:has-text("API 키")');
    eq(await page.locator('#btnApi span').innerText(), 'API 연결 안 됨');
    await page.fill('#apiKey', GOOD);
    await page.click('dialog[open] button:text-is("연결하기")');
    await page.waitForSelector('dialog[open] .okbox');
    const t = await page.locator('dialog[open]').innerText();
    ok(/gemini-3-flash-preview/.test(t) && /gemini-2\.5-flash-image/.test(t), '모델 표시: ' + t.slice(0, 200));
    await closeModal();
    eq(await page.locator('#btnApi span').innerText(), 'API 연결됨');
    const html = await page.content();
    ok(!html.includes(GOOD), '화면(DOM)에 키가 남지 않음');
    const st = await (await fetch(`${base}api/state`, { headers: { 'x-dpa-token': token } })).text();
    ok(!st.includes(GOOD), '상태 응답에 키 없음');
  });

  await step('B2 AI로 정리: 동의 → 미리보기(편집) → 적용 → 원문 수치 보존 → 되돌리기', async () => {
    const origDesc = await page.inputValue('#fDesc');
    await page.click('#btnOrganize');
    await page.waitForSelector('dialog[open]:has-text("외부 전송")');
    ok(/별도 사용료/.test(await page.locator('dialog[open]').innerText()), '사용료 안내');
    ok(await page.locator('dialog[open] button:text-is("동의하고 진행")').isDisabled(), '체크 전에는 진행 불가');
    await page.check('#consentChk');
    await page.click('dialog[open] button:text-is("동의하고 진행")');
    await page.waitForSelector('dialog[open]:has-text("AI 정리 결과")');
    const txt = await page.locator('dialog[open] textarea').inputValue();
    ok(/1\. 상품 한눈에 보기/.test(txt) && /6\. 확인할 사항/.test(txt), '6개 구조');
    ok(/200ml/.test(txt) && /12입/.test(txt), '원문 수치(200ml, 12입) 보존: ' + txt.slice(-160));
    ok(/원문의 수치/.test(await page.locator('dialog[open]').innerText()), '복원 안내');
    await page.locator('dialog[open] textarea').fill(txt + '\n(직접 추가한 문장)');
    await page.click('dialog[open] button:text-is("적용")');
    await page.waitForFunction((o) => window.DPA.project.product.description !== o, origDesc);
    ok((await page.inputValue('#fDesc')).includes('직접 추가한 문장'));
    eq(await page.inputValue('#fTarget'), '아침을 거르는 30대 직장인', '기존 타겟 고객 보존(기본 선택)');
    eq(await page.inputValue('#fPrice'), '29,900원', '가격 보존');
    await page.click('#descHint button:text-is("되돌리기")');
    await page.waitForFunction((o) => window.DPA.project.product.description === o, origDesc);
    eq(await page.inputValue('#fDesc'), origDesc, '되돌리기');
  });

  await step('B3 AI로 정리: 취소 시 변경 없음', async () => {
    const o = await page.inputValue('#fDesc');
    await page.click('#btnOrganize');
    await page.waitForSelector('dialog[open]:has-text("AI 정리 결과")');
    await page.click('dialog[open] button:text-is("취소")');
    eq(await page.inputValue('#fDesc'), o);
  });

  await step('B4 응답 형식 다양성: 객체·배열·누락·코드펜스·끝쉼표 고객층', async () => {
    await disconnect();
    await connect('WEIRD_KEY_AAAAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      await page.click('#btnOrganize');
      if (i === 0) await maybeConsent();
      await page.waitForSelector('dialog[open]:has-text("AI 정리 결과")', { timeout: 8000 });
      const dlg = await page.locator('dialog[open]').innerText();
      const tgt = await page.locator('dialog[open] input:not([type=checkbox])').count() ? await page.locator('dialog[open] input:not([type=checkbox])').inputValue() : '(제안 없음)';
      ok(!/\[object Object\]/.test(dlg + tgt), '객체가 그대로 노출됨');
      seen.push(tgt.replace(/\n/g, '/').slice(0, 40));
      await page.click('dialog[open] button:text-is("취소")');
      await page.waitForTimeout(120);
    }
    ok(seen.some((s) => /연령/.test(s)), '객체 고객층 읽기: ' + seen.join(' | '));
    ok(seen.some((s) => /직장인\/·|· 직장인/.test(s)), '배열 고객층 읽기: ' + seen.join(' | '));
    ok(seen.some((s) => s === '(제안 없음)'), '누락 시 기존 입력 유지: ' + seen.join(' | '));
    eq(await page.inputValue('#fTarget'), '아침을 거르는 30대 직장인', '기존 고객층 보존');
    return seen.join(' | ');
  });

  await step('B5 처리 중 입력이 바뀌면 이전 요청 결과를 자동 적용하지 않음', async () => {
    await disconnect();
    await connect('SLOW_KEY_AAAAAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    const o = await page.inputValue('#fDesc');
    await page.click('#btnOrganize');
    await maybeConsent();
    await page.waitForTimeout(300);
    await page.fill('#fDesc', o + ' (처리 중 수정)');
    await page.waitForSelector('dialog[open]:has-text("AI 정리 결과")', { timeout: 500 }).then(() => { throw new Error('결과 창이 열리면 안 됨'); }, () => {});
    await waitToast(/적용하지 않았습니다/, 9000);
    eq(await page.inputValue('#fDesc'), o + ' (처리 중 수정)', '입력 유지');
    await page.fill('#fDesc', o);
  });

  await step('B6 정리 요청 취소(버튼 재클릭)', async () => {
    await page.click('#btnOrganize');
    await page.waitForTimeout(250);
    await page.click('#btnOrganize');
    await waitToast(/취소했습니다/);
    ok(!(await page.locator('dialog[open]').count()), '결과 창 없음');
  });

  await step('B7 오류 안내: 사용량 초과·권한·잘못된 응답', async () => {
    await disconnect();
    await connect('QUOTA_KEY_AAAAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    await clearToasts();
    await page.click('#btnOrganize');
    await maybeConsent();
    await waitToast(/사용량/);
    await disconnect();
    await connect('GARBAGE_KEY_AAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    await clearToasts();
    await page.click('#btnOrganize');
    await maybeConsent();
    await waitToast(/읽지 못했습니다|응답/);
    eq(await page.inputValue('#fName'), '제주 한라봉 주스 200ml 12입', '입력 보존');
  });

  await step('B8 정보 검색(출처 표시)·사진 분석', async () => {
    await disconnect();
    await connect(GOOD); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    await page.click('#btnSearch');
    await maybeConsent();
    await page.waitForSelector('dialog[open]:has-text("상품 정보 검색 결과")');
    const t = await page.locator('dialog[open]').innerText();
    ok(/검색 결과 요약/.test(t) && /example\.com/.test(t), '요약·출처');
    const href = await page.locator('dialog[open] a[href^="https://example.com"]').getAttribute('rel');
    ok(/noopener/.test(href), '외부 링크 rel');
    await page.click('dialog[open] button:text-is("상품 설명 끝에 추가")');
    ok((await page.inputValue('#fDesc')).includes('[참고 자료 — 웹 검색]'));
    await page.click('#btnUndo');
    await page.click('#btnPhoto');
    await page.waitForSelector('dialog[open]:has-text("사진 분석 결과")');
    await closeModal();
  });

  await step('B9 AI 상세페이지 생성: 동의·진행 표시·12블록·이미지·색감·제작자 문구 없음', async () => {
    const reqBefore = (await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json()).length;
    await page.click('#btnGenerate');
    await page.waitForSelector('dialog:has-text("현재 편집 중인")'); await page.click('dialog[open] button:text-is("계속")');
    await page.waitForSelector('dialog[open]:has-text("생성 전 확인")');
    const t = await page.locator('dialog[open]').innerText();
    ok(/이미지 최대 9회/.test(t) && /gemini-3-flash-preview/.test(t) && /별도 사용료/.test(t), '생성 전 안내: ' + t.slice(0, 300));
    await page.check('#consentChk');
    await page.click('dialog[open] button:text-is("동의하고 생성")');
    await page.waitForSelector('#genStatus .gen');
    await page.waitForFunction(() => document.querySelector('#genStatus .gen.ok, #genStatus .gen.warn'), null, { timeout: 30000 });
    const p = await proj();
    eq(p.blocks.length, 12);
    eq(p.brief.palette.accent, '#D4701F', 'AI 제안 색감 적용');
    const ai = p.blocks.flatMap((b) => b.images).filter((s) => s.source === 'ai');
    eq(ai.length, 9, 'AI 이미지 9장');
    ok(p.blocks.find((b) => b.type === 'promo').hidden, '프로모션 입력이 없으면 숨김');
    const cta = p.blocks.find((b) => b.type === 'cta');
    eq(cta.fields.title, '지금 만나보세요'); ok(!cta.hidden);
    const all = JSON.stringify(p.blocks);
    for (const bad of ['구매 버튼 시안', '판매 전 정보를 확인하세요']) ok(!all.includes(bad), '제작자용 문구: ' + bad);
    const log = (await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json()).slice(reqBefore);
    const plan = log.find((l) => l.task === 'plan'); ok(plan && plan.inlineImages >= 1, '문구 요청에 상품 사진 첨부');
    const imgs = log.filter((l) => l.image);
    eq(imgs.length, 9, '이미지 요청 수');
    ok(imgs.every((l) => l.inlineImages >= 1), '모든 이미지 요청에 실제 상품 사진 첨부');
    ok(imgs.every((l) => /Keep the product exactly identical/.test(l.text) && /Never redraw/.test(l.text) && /No overlaid text/.test(l.text)), '형태·로고 보존 프롬프트');
    ok(imgs.every((l) => /^\d+:\d+$/.test(l.aspect || '')), '화면비 전달');
    await page.waitForFunction(() => document.querySelectorAll('.blk canvas').length >= 8);
    await shot('02-generated');
    return `이미지 요청 ${imgs.length}회`;
  });

  await step('B10 생성 결과 JPG 저장 + 시각 확인용 파일', async () => {
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("전체 상세페이지 JPG 저장")')]);
    const f = path.join(OUT, 'generated.jpg'); await dl.saveAs(f);
    const sz = jpegSize(fs.readFileSync(f));
    eq(sz.w, 860); ok(sz.h > 6000, '충분히 긴 상세페이지: ' + sz.h);
    await closeModal();
    return `${sz.w}x${sz.h}`;
  });

  await step('B11 블록 AI 문구 수정 · 이미지 AI 수정/다시 생성 · 되돌리기', async () => {
    await blk('intro').locator('button:text-is("수정")').click();
    const t0 = (await proj()).blocks.find((b) => b.type === 'intro').fields.title;
    await page.fill('#drawer input[aria-label="AI 문구 수정 요청"]', '더 짧게');
    await page.click('#drawer button:text-is("AI로 고치기")');
    await page.waitForFunction((t) => window.DPA.project.blocks.find((b) => b.type === 'intro').fields.title === '수정된 ' + t, t0, { timeout: 8000 });
    await page.click('#btnUndo');
    eq((await proj()).blocks.find((b) => b.type === 'intro').fields.title, t0);
    await page.click('#drawer .dr-close');
    // 이미지 AI 수정
    await blk('hero').locator('button:text-is("수정")').click();
    const a0 = (await proj()).blocks.find((b) => b.type === 'hero').images[0].assetId;
    await page.locator('#drawer .slot').nth(0).locator('button:text-is("AI 수정")').click();
    await page.fill('dialog[open] textarea', '배경을 밝은 나무 테이블로 바꿔줘');
    await page.click('dialog[open] button:text-is("시작")');
    await page.waitForFunction((a) => window.DPA.project.blocks.find((b) => b.type === 'hero').images[0].assetId !== a, a0, { timeout: 15000 });
    const log = await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json();
    const last = log.filter((l) => l.image).pop();
    ok(/Edit the first attached image/.test(last.text) && /나무 테이블/.test(last.text), '수정 요청 프롬프트');
    ok(last.inlineImages >= 2, '기준 이미지+상품 사진 첨부');
    await page.click('#btnUndo');
    eq((await proj()).blocks.find((b) => b.type === 'hero').images[0].assetId, a0, '이미지 수정 되돌리기');
    // 다시 생성
    const n0 = log.filter((l) => l.image).length;
    await page.locator('#drawer .slot').nth(0).locator('button:text-is("다시 생성")').click();
    await page.waitForFunction((a) => window.DPA.project.blocks.find((b) => b.type === 'hero').images[0].assetId !== a, a0, { timeout: 15000 });
    const n1 = (await (await fetch(`http://127.0.0.1:${mock.port}/__log`)).json()).filter((l) => l.image).length;
    eq(n1, n0 + 1, '다시 생성 1회 호출');
    await page.click('#drawer .dr-close');
  });

  await step('B12 일부 이미지 실패: 완료분 보존, 원본 사진 유지, 다시 시도', async () => {
    await disconnect();
    await connect('PARTIAL_KEY_AAAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    await page.click('#btnGenerate');
    await page.waitForSelector('dialog:has-text("현재 편집 중인")'); await page.click('dialog[open] button:text-is("계속")');
    await page.waitForSelector('dialog[open]:has-text("생성 전 확인")'); await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 생성")');
    await page.waitForFunction(() => document.querySelector('#genStatus .gen.warn'), null, { timeout: 40000 });
    const p = await proj();
    const imgs = p.blocks.flatMap((b) => b.images);
    eq(imgs.filter((s) => s.source === 'ai').length, 8, '성공 8장 보존');
    const failed = p.blocks.find((b) => b.type === 'gallery').images[1];
    ok(failed.source !== 'ai', '실패한 슬롯은 AI 결과가 아님');
    ok(/1장 실패/.test(await page.locator('#genStatus').innerText()), '실패 안내');
    ok(await page.locator('#genStatus button:text-is("실패한 이미지 다시 시도")').count(), '재시도 버튼');
    await shot('03-partial');
    await page.click('#genStatus button:text-is("실패한 이미지 다시 시도")');
    await page.waitForSelector('dialog[open]:has-text("다시 시도 전 확인")'); await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 진행")');
    await waitToast(/아직 실패|만들었습니다/, 20000);
    eq((await proj()).blocks.flatMap((b) => b.images).filter((s) => s.source === 'ai').length, 8, '재시도 후에도 기존 결과 유지');
    await page.click('#btnExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] button:text-is("전체 상세페이지 JPG 저장")')]);
    await dl.saveAs(path.join(OUT, 'partial.jpg')); await closeModal();
  });

  await step('B13 생성 실패(사용량 초과): 입력·기존 결과 보존', async () => {
    await disconnect();
    await connect('QUOTA_KEY_AAAAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    const before = JSON.stringify((await proj()).blocks);
    await page.click('#btnGenerate');
    await page.waitForSelector('dialog:has-text("현재 편집 중인")'); await page.click('dialog[open] button:text-is("계속")');
    await page.waitForSelector('dialog[open]:has-text("생성 전 확인")'); await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 생성")');
    await page.waitForSelector('#genStatus .gen.err', { timeout: 15000 });
    ok(/사용량/.test(await page.locator('#genStatus').innerText()));
    eq(JSON.stringify((await proj()).blocks), before, '기존 결과 보존');
    eq(await page.inputValue('#fName'), '제주 한라봉 주스 200ml 12입');
    ok(!(await page.locator('#btnGenerate').isDisabled()), '다시 시도 가능');
  });

  await step('B14 생성 취소', async () => {
    await disconnect();
    await connect('SLOW_KEY_AAAAAAAAAAAAAAAA'); await page.waitForSelector('dialog[open] .okbox'); await closeModal();
    const before = JSON.stringify((await proj()).blocks);
    await page.click('#btnGenerate');
    await page.waitForSelector('dialog:has-text("현재 편집 중인")'); await page.click('dialog[open] button:text-is("계속")');
    await page.waitForSelector('dialog[open]:has-text("생성 전 확인")'); await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 생성")');
    await page.waitForSelector('#genStatus .gen button:text-is("취소")');
    await page.click('#genStatus .gen button:text-is("취소")');
    await page.waitForSelector('#genStatus:has-text("취소했습니다")', { timeout: 15000 });
    eq(JSON.stringify((await proj()).blocks), before, '취소 시 기존 결과 유지');
  });

  await step('B13b 생성 중 상품 정보가 바뀌면 결과를 적용하지 않음', async () => {
    const before = JSON.stringify((await proj()).blocks);
    const name0 = await page.inputValue('#fName');
    await page.click('#btnGenerate');
    await page.waitForSelector('dialog:has-text("현재 편집 중인")'); await page.click('dialog[open] button:text-is("계속")');
    await page.waitForSelector('dialog[open]:has-text("생성 전 확인")'); await page.check('#consentChk'); await page.click('dialog[open] button:text-is("동의하고 생성")');
    await page.waitForSelector('#genStatus .gen button:text-is("취소")');
    await page.fill('#fName', name0 + ' 수정');
    await waitToast(/결과를 적용하지 않았습니다/, 12000);
    eq(JSON.stringify((await proj()).blocks), before, '결과 미적용');
    await page.fill('#fName', name0);
    await page.waitForFunction(() => !document.querySelector('#btnGenerate').disabled, null, { timeout: 12000 });
  });

  await step('B15 저장 파일·로그·백업에 API 키 없음(전체 데이터 폴더 검사)', async () => {
    const all = [];
    const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); n.isDirectory() ? walk(f) : all.push(f); } };
    walk(dataDir);
    ok(all.length > 5, '검사 파일 수');
    for (const f of all) { const b = fs.readFileSync(f); for (const k of [GOOD, 'WEIRD_KEY', 'PARTIAL_KEY', 'QUOTA_KEY', 'SLOW_KEY', 'GARBAGE_KEY']) ok(!b.includes(k), `${path.basename(f)} 에 키(${k})가 있음`); }
    ok(fs.existsSync(path.join(dataDir, 'logs', 'app.log')), '로그 파일');
    return `${all.length}개 파일 검사`;
  });

  // ───────── C. 모바일 ─────────
  await step('C1 모바일(390px): 주요 조작·내용 확인, 가로 넘침 없음', async () => {
    if (await page.evaluate(() => window.DPA.rt.connected)) await disconnect();
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    await mp.goto(base); await mp.waitForFunction(() => window.__dpaReady);
    ok(await mp.locator('.tabs').isVisible(), '탭 표시');
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ov <= 1, '가로 넘침 ' + ov);
    await mp.screenshot({ path: path.join(OUT, '04-mobile-input.png') });
    await mp.click('.tab[data-tab=preview]');
    await mp.waitForFunction(() => document.querySelectorAll('.blk canvas').length >= 5);
    const ov2 = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ov2 <= 1, '미리보기 가로 넘침 ' + ov2);
    await mp.screenshot({ path: path.join(OUT, '05-mobile-preview.png') });
    await mp.locator('.blk:has(.blk-name:text-is("대표 이미지")) button:text-is("수정")').click();
    await mp.waitForSelector('#drawer:not([hidden])');
    const w = await mp.evaluate(() => document.querySelector('#drawer').getBoundingClientRect().width);
    ok(w >= 388, '편집 서랍이 화면 폭 사용: ' + w);
    await mp.screenshot({ path: path.join(OUT, '06-mobile-drawer.png') });
    const btn = await mp.locator('#drawer .btn').first().boundingBox();
    ok(btn.height >= 34, '버튼 터치 크기 ' + btn.height);
    await m.close();
  });

  await step('D1 콘솔 오류 없음(전체 시나리오)', async () => { ok(errors.length === 0, errors.slice(0, 3).join(' | ')); });

  await browser.close();
  await app.stop(); await mock.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const fail = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n=== E2E ${results.length - fail.length - skipped}/${results.length - skipped} 통과, 실패 ${fail.length}${skipped ? `, 건너뜀 ${skipped}` : ''} ===`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('치명적 오류', e); process.exit(2); });
