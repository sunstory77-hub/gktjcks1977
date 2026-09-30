import fixWebmDuration from 'fix-webm-duration';
import { getFormat } from './formats';
import { ensureFonts, loadImages, renderPage } from './render';
import { frameAt, motionTransform, totalDuration } from './timeline';
import type { Page, Project } from './types';

export function pageHeight(project: Project, page: Page): number {
  return page.height ?? getFormat(project.formatId).height;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
  return { canvas: c, ctx };
}

export async function renderPageCanvas(project: Project, page: Page): Promise<HTMLCanvasElement> {
  await Promise.all([ensureFonts([page]), loadImages([page])]);
  const w = getFormat(project.formatId).width;
  const h = pageHeight(project, page);
  const { canvas, ctx } = makeCanvas(w, h);
  renderPage(ctx, page, w, h, { placeholders: false });
  return canvas;
}

/** 모든 페이지를 세로로 이어붙인 한 장 (상세페이지용) */
export async function renderStackedCanvas(project: Project): Promise<HTMLCanvasElement> {
  const parts = await Promise.all(project.pages.map((p) => renderPageCanvas(project, p)));
  const w = getFormat(project.formatId).width;
  const h = parts.reduce((s, c) => s + c.height, 0);
  const { canvas, ctx } = makeCanvas(w, h);
  let y = 0;
  for (const part of parts) {
    ctx.drawImage(part, 0, y);
    y += part.height;
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), type, quality),
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function dateStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || '콘텐츠';
}

// ───────── 영상 ─────────

/**
 * 녹화 형식 선택. SNS 업로드 호환성을 위해 H.264 MP4를 최우선으로 쓰고,
 * 지원하지 않으면 WebM으로 저장한다. (코덱 미지정 'video/mp4'는 VP9-in-MP4가 되어 아이폰 등에서 재생 불가라 제외)
 */
export function pickVideoMime(withAudio = false): { mime: string; ext: string } {
  const candidates = [
    ...(withAudio
      ? [
          { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
          { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
        ]
      : []),
    { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: withAudio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) return c;
  throw new Error('이 브라우저는 영상 녹화를 지원하지 않습니다 (크롬 권장)');
}

export interface VideoOptions {
  fps?: number;
  audio?: File | null;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
  /** 녹화 중인 캔버스를 화면에 보여주고 싶을 때 */
  onCanvas?: (c: HTMLCanvasElement) => void;
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  W: number,
  H: number,
  motion: { scale: number; dx: number; dy: number },
) {
  const base = Math.max(W / src.width, H / src.height);
  const s = base * motion.scale;
  const dw = src.width * s;
  const dh = src.height * s;
  ctx.drawImage(src, (W - dw) / 2 + motion.dx * W, (H - dh) / 2 + motion.dy * H, dw, dh);
}

/** 페이지들을 슬라이드 영상으로 녹화 (실시간 녹화이므로 영상 길이만큼 걸린다) */
export async function exportVideo(project: Project, opts: VideoOptions = {}): Promise<{ blob: Blob; ext: string }> {
  const fps = opts.fps ?? 30;
  const fmt = getFormat(project.formatId);
  const W = fmt.width;
  const H = fmt.height;
  const pages = project.pages;
  if (pages.length === 0) throw new Error('페이지가 없습니다');
  const stills = await Promise.all(pages.map((p) => renderPageCanvas(project, p)));
  const { mime, ext } = pickVideoMime(!!opts.audio);
  const { canvas, ctx } = makeCanvas(W, H);
  opts.onCanvas?.(canvas);

  const draw = (t: number) => {
    const f = frameAt(pages, t);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const cur = pages[f.index];
    if (f.transition !== null) {
      const prev = pages[f.index - 1];
      drawFitted(ctx, stills[f.index - 1], W, H, motionTransform(prev.motion, 1));
      ctx.save();
      if (cur.transition === 'fade') ctx.globalAlpha = f.transition;
      if (cur.transition === 'slide') ctx.translate((1 - easeOut(f.transition)) * W, 0);
      drawFitted(ctx, stills[f.index], W, H, motionTransform(cur.motion, f.progress));
      ctx.restore();
    } else {
      drawFitted(ctx, stills[f.index], W, H, motionTransform(cur.motion, f.progress));
    }
  };

  const stream = canvas.captureStream(fps);
  let audioCtx: AudioContext | null = null;
  let audioSrc: AudioBufferSourceNode | null = null;
  const total = totalDuration(pages);
  if (opts.audio) {
    audioCtx = new AudioContext();
    const buf = await audioCtx.decodeAudioData(await opts.audio.arrayBuffer());
    const dest = audioCtx.createMediaStreamDestination();
    const gain = audioCtx.createGain();
    audioSrc = audioCtx.createBufferSource();
    audioSrc.buffer = buf;
    audioSrc.loop = true;
    audioSrc.connect(gain).connect(dest);
    gain.gain.setValueAtTime(1, audioCtx.currentTime + Math.max(0, total - 1));
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + total);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
  }

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  draw(0);
  recorder.start(250);
  audioSrc?.start();
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) return reject(new DOMException('취소됨', 'AbortError'));
      const t = (performance.now() - start) / 1000;
      draw(Math.min(t, total));
      opts.onProgress?.(Math.min(1, t / total));
      if (t >= total) return resolve();
      setTimeout(tick, 1000 / fps);
    };
    tick();
  }).finally(() => {
    recorder.stop();
    audioSrc?.stop();
    void audioCtx?.close();
  });
  await done;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  // 크롬 WebM 녹화본엔 길이 정보가 없어 플레이어 탐색바가 동작하지 않는다 → 길이 기록
  if (ext === 'webm') return { blob: await fixWebmDuration(blob, total * 1000, { logger: false }), ext };
  return { blob, ext };
}

function easeOut(x: number) {
  return 1 - Math.pow(1 - x, 3);
}
