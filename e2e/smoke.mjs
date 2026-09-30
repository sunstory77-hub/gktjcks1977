// 실행: npm run build && npm run e2e
// 실제 브라우저로 홈 → 템플릿 → 편집 → PNG/상세페이지/영상 내보내기를 검증한다.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('e2e/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
for (let i = 0; ; i++) {
  try {
    await fetch(`http://localhost:${PORT}/`);
    break;
  } catch {
    if (i > 100) throw new Error('preview 서버 시작 실패');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// 설치된 크롬 경로 지정 가능 (CHROMIUM_PATH). 없으면 Playwright 기본 경로 사용
const exe = process.env.CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  // POSIX 로케일에선 크롬이 한글 다운로드 파일명을 'download'로 바꾼다
  env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  executablePath: exe,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ignoreHTTPSErrors: true });
const pageObj = await ctx.newPage();
const errors = [];
pageObj.on('pageerror', (e) => errors.push(String(e)));
// 외부 웹폰트(Google Fonts)는 네트워크 상황에 따라 실패할 수 있어 제외. 폰트 실패 시 기본 글꼴로 대체된다.
const isExternalFont = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u);
pageObj.on('requestfailed', (r) => !isExternalFont(r.url()) && !r.url().startsWith('blob:') && errors.push(`요청 실패 ${r.url()} ${r.failure()?.errorText}`));
pageObj.on('response', (r) => r.status() >= 400 && !isExternalFont(r.url()) && errors.push(`HTTP ${r.status()} ${r.url()}`));
pageObj.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
};
const download = async (trigger, timeout = 60000) => {
  const [d] = await Promise.all([pageObj.waitForEvent('download', { timeout }), trigger()]);
  const file = path.join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  return file;
};
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

try {
  const p = pageObj;
  await p.goto(`http://localhost:${PORT}/`);
  await p.screenshot({ path: path.join(OUT, '01_home.png') });
  check('홈 렌더링', await p.getByText('SNS 콘텐츠 스튜디오').first().isVisible());

  // 1) 상세페이지 풀세트
  await p.getByTestId('format-detail').click();
  await p.getByTestId('tpl-dt-full').click();
  await p.getByTestId('stage-canvas').waitFor();
  await p.waitForTimeout(800);
  check('상세페이지 6섹션 로드', (await p.locator('.page-thumb').count()) === 6);

  // 캔버스에서 제목 텍스트 클릭 → 수정
  const box = await p.getByTestId('stage-canvas').boundingBox();
  const scale = box.width / 860;
  await p.mouse.click(box.x + 430 * scale, box.y + 300 * scale);
  await p.getByTestId('text-input').waitFor({ timeout: 3000 });
  await p.getByTestId('text-input').fill('긍정하쌤\nAI 실무 과정');
  await p.waitForTimeout(300);
  check('텍스트 선택·수정', (await p.getByTestId('text-input').inputValue()).includes('긍정하쌤'));

  // 사진 넣기 (선택된 이미지 자리 대신 새 사진 추가)
  const sample = path.join(OUT, 'sample.png');
  await p.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 400;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 600, 400);
    gr.addColorStop(0, '#f97316'); gr.addColorStop(1, '#0ea5e9');
    g.fillStyle = gr; g.fillRect(0, 0, 600, 400);
    window.__sample = c.toDataURL('image/png');
  });
  const dataUrl = await p.evaluate(() => window.__sample);
  fs.writeFileSync(sample, Buffer.from(dataUrl.split(',')[1], 'base64'));
  // 히어로 섹션의 빈 이미지 자리 클릭 → '사진 넣기' → 파일 선택
  await p.mouse.click(box.x + 430 * scale, box.y + 800 * scale);
  await p.getByTestId('replace-image').waitFor({ timeout: 5000 });
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByTestId('replace-image').click()]);
  await chooser.setFiles(sample);
  await p.waitForTimeout(800);
  const hasImg = await p.evaluate(() => {
    const c = document.querySelector('[data-testid=stage-canvas]');
    const g = c.getContext('2d');
    const r = c.getBoundingClientRect();
    const s = c.width / r.width;
    const px = g.getImageData(Math.round(c.width * 0.2), Math.round(c.height * 0.6), 1, 1).data;
    return [...px];
  });
  check('사진 교체 반영', hasImg[0] > 150 && hasImg[2] < 200, JSON.stringify(hasImg));
  await p.screenshot({ path: path.join(OUT, '02_detail_editor.png') });

  // 실행취소
  await p.keyboard.press('Escape');
  await p.getByTestId('open-export').click();
  const stacked = await download(() => p.getByTestId('export-stacked').click());
  const s1 = pngSize(stacked);
  check('상세페이지 한 장 PNG', s1.w === 860 && s1.h === 1200 + 1000 + 1300 + 1100 + 1000 + 900, `${path.basename(stacked)} ${s1.w}x${s1.h}`);
  const cur = await download(() => p.getByTestId('export-current').click());
  check('현재 페이지 PNG', pngSize(cur).w === 860, path.basename(cur));
  await p.locator('.modal header button').click();

  // 2) 쇼츠 영상
  await p.getByText('← 홈').click();
  await p.getByTestId('format-story').click();
  await p.getByTestId('tpl-st-shorts').click();
  await p.getByTestId('stage-canvas').waitFor();
  await p.waitForTimeout(500);
  await p.getByTestId('open-export').click();
  const video = await download(() => p.getByTestId('export-video').click(), 40000);
  const vsize = fs.statSync(video).size;
  check('쇼츠 영상 내보내기', vsize > 50_000, `${path.basename(video)} ${(vsize / 1024).toFixed(0)}KB`);
  // 브라우저에서 재생해 길이와 장면별 프레임 확인 (템플릿 합계 11초)
  const b64 = fs.readFileSync(video).toString('base64');
  const probe = await p.evaluate(async ({ b64, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type }));
    await new Promise((r, j) => ((v.onloadedmetadata = r), (v.onerror = () => j(new Error('재생 불가')))));
    const strip = document.createElement('canvas');
    strip.width = 270 * 4;
    strip.height = 480;
    const g = strip.getContext('2d');
    const lum = [];
    for (const [i, t] of [1, 4, 7, 10].entries()) {
      v.currentTime = t;
      await new Promise((r) => (v.onseeked = r));
      g.drawImage(v, i * 270, 0, 270, 480);
      const d = g.getImageData(i * 270, 0, 270, 480).data;
      let sum = 0;
      for (let k = 0; k < d.length; k += 4) sum += d[k] + d[k + 1] + d[k + 2];
      lum.push(Math.round(sum / (d.length / 4) / 3));
    }
    return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, lum, strip: strip.toDataURL('image/png') };
  }, { b64, type: video.endsWith('.mp4') ? 'video/mp4' : 'video/webm' });
  fs.writeFileSync(path.join(OUT, '05_video_frames.png'), Buffer.from(probe.strip.split(',')[1], 'base64'));
  check('영상 재생·길이', probe.w === 1080 && probe.h === 1920 && Math.abs(probe.duration - 11) < 1, `${probe.w}x${probe.h} ${probe.duration.toFixed(2)}s`);
  check('영상 장면 내용', probe.lum.every((x) => x > 5), `평균밝기 ${probe.lum.join(',')}`);
  await p.locator('.modal header button').click();

  // 3) 유튜브 썸네일 + 요소 추가
  await p.getByText('← 홈').click();
  await p.getByTestId('format-youtube-thumb').click();
  await p.getByTestId('tpl-yt-bold').click();
  await p.getByTestId('stage-canvas').waitFor();
  await p.getByTestId('add-title').click();
  check('제목 추가', (await p.locator('.layer-row').count()) === 4);
  await p.keyboard.press('Control+z');
  check('실행취소', (await p.locator('.layer-row').count()) === 3);
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, '03_youtube_editor.png') });
  await p.getByTestId('open-export').click();
  const yt = await download(() => p.getByTestId('export-current').click());
  const ys = pngSize(yt);
  check('유튜브 썸네일 1280x720', ys.w === 1280 && ys.h === 720);
  await p.locator('.modal header button').click();

  // 4) 자동 저장 → 홈 목록
  await p.waitForTimeout(1200);
  await p.getByText('← 홈').click();
  await p.waitForTimeout(500);
  check('자동 저장 목록', (await p.getByText('저장된 작업').count()) > 0 && (await p.locator('.tpl-card .plain').count()) >= 3);
  await p.screenshot({ path: path.join(OUT, '04_home_saved.png'), fullPage: true });

  check('콘솔 에러 없음', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('예외 없음', false, String(e));
  await pageObj.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
