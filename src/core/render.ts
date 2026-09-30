import type { Fill, ImageLayer, Layer, Page, ShapeLayer, TextLayer } from './types';
import { wrapText } from './text';

export type ImageMap = Map<string, CanvasImageSource & { width: number; height: number }>;

const imageCache: ImageMap = new Map();

/** 페이지에 쓰인 이미지를 모두 로드해 캐시에 넣는다. */
export async function loadImages(pages: Page[]): Promise<ImageMap> {
  const srcs = new Set<string>();
  for (const p of pages) for (const l of p.layers) if (l.type === 'image' && l.src) srcs.add(l.src);
  await Promise.all(
    [...srcs].map(
      (src) =>
        new Promise<void>((resolve) => {
          if (imageCache.has(src)) return resolve();
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            imageCache.set(src, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
  return imageCache;
}

/** 폰트별로 실제 포함된 굵기. 없는 굵기를 요청하면 브라우저가 가짜 볼드로 뭉개므로 가까운 값으로 맞춘다. */
export const FONT_WEIGHTS: Record<string, number[]> = {
  'Noto Sans KR': [400, 700, 900],
  'Black Han Sans': [400],
  Jua: [400],
  'Nanum Myeongjo': [400, 800],
  'Gowun Dodum': [400],
};

export function snapWeight(family: string, weight: number): number {
  const ws = FONT_WEIGHTS[family];
  if (!ws) return weight;
  return ws.reduce((best, w) => (Math.abs(w - weight) <= Math.abs(best - weight) ? w : best), ws[0]);
}

export function fontString(l: Pick<TextLayer, 'fontWeight' | 'fontSize' | 'fontFamily'>): string {
  return `${snapWeight(l.fontFamily, l.fontWeight)} ${l.fontSize}px "${l.fontFamily}", "Noto Sans KR", sans-serif`;
}

/**
 * 필요한 웹폰트를 캔버스에 쓰기 전에 로드.
 * 한글 웹폰트는 글자 범위(unicode-range)별로 쪼개져 있어 실제로 쓰인 글자를 넘겨야 전부 받아온다.
 */
export async function ensureFonts(pages: Page[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const fonts = new Map<string, string>();
  for (const p of pages)
    for (const l of p.layers)
      if (l.type === 'text') {
        const key = fontString({ ...l, fontSize: 16 });
        fonts.set(key, (fonts.get(key) ?? '') + l.text);
      }
  await Promise.all([...fonts].map(([f, text]) => document.fonts.load(f, text.replace(/\s/g, '') || '가').catch(() => undefined)));
}

export function makeFill(ctx: CanvasRenderingContext2D, fill: Fill, x: number, y: number, w: number, h: number) {
  if (fill.kind === 'solid') return fill.color;
  const rad = ((fill.angle - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const len = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
  const g = ctx.createLinearGradient(
    cx - Math.cos(rad) * len,
    cy - Math.sin(rad) * len,
    cx + Math.cos(rad) * len,
    cy + Math.sin(rad) * len,
  );
  g.addColorStop(0, fill.from);
  g.addColorStop(1, fill.to);
  return g;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** 텍스트 레이어의 줄 목록과 실제 필요한 높이 */
export function layoutText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  ctx.font = fontString(l);
  setLetterSpacing(ctx, l.letterSpacing);
  const pad = l.boxColor ? (l.boxPadding ?? 0) : 0;
  const lines = wrapText(l.text, Math.max(10, l.w - pad * 2), (s) => ctx.measureText(s).width);
  const lineH = l.fontSize * l.lineHeight;
  return { lines, lineH, pad, height: lines.length * lineH + pad * 2 };
}

function drawText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  const { lines, lineH, pad } = layoutText(ctx, l);
  ctx.textBaseline = 'middle';
  ctx.textAlign = l.align;
  const tx = l.align === 'left' ? l.x + pad : l.align === 'right' ? l.x + l.w - pad : l.x + l.w / 2;

  lines.forEach((line, i) => {
    const cy = l.y + pad + i * lineH + lineH / 2;
    if (l.boxColor && line) {
      const lw = ctx.measureText(line).width;
      const bx = l.align === 'left' ? tx - pad : l.align === 'right' ? tx - lw - pad : tx - lw / 2 - pad;
      ctx.save();
      ctx.fillStyle = l.boxColor;
      roundRectPath(ctx, bx, cy - lineH / 2 - pad / 2, lw + pad * 2, lineH + pad, pad / 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    if (l.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = l.fontSize * 0.25;
      ctx.shadowOffsetY = l.fontSize * 0.06;
    }
    if (l.strokeColor && l.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = l.strokeColor;
      ctx.lineWidth = l.strokeWidth * 2;
      ctx.strokeText(line, tx, cy);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = l.color;
    ctx.fillText(line, tx, cy);
    ctx.restore();
  });
}

function drawImage(ctx: CanvasRenderingContext2D, l: ImageLayer, images: ImageMap, placeholder: boolean) {
  const img = images.get(l.src);
  if (!img && !placeholder) return;
  ctx.save();
  roundRectPath(ctx, l.x, l.y, l.w, l.h, l.radius);
  ctx.clip();
  if (!img) {
    ctx.fillStyle = '#d9dce3';
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle = '#7a8090';
    ctx.font = `600 ${Math.max(14, Math.min(l.w, l.h) / 10)}px "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('사진을 넣어주세요', l.x + l.w / 2, l.y + l.h / 2);
    ctx.restore();
    return;
  }
  const scale =
    l.fit === 'cover' ? Math.max(l.w / img.width, l.h / img.height) : Math.min(l.w / img.width, l.h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.filter = [
    `brightness(${l.brightness}%)`,
    `contrast(${l.contrast}%)`,
    `saturate(${l.saturate}%)`,
    `grayscale(${l.grayscale}%)`,
    l.blur ? `blur(${l.blur}px)` : '',
  ]
    .filter(Boolean)
    .join(' ');
  ctx.drawImage(img, l.x + (l.w - dw) / 2, l.y + (l.h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, l: ShapeLayer) {
  if (l.shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(l.x + l.w / 2, l.y + l.h / 2, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, l.x, l.y, l.w, l.h, l.radius);
  }
  ctx.fillStyle = makeFill(ctx, l.fill, l.x, l.y, l.w, l.h);
  ctx.fill();
  if (l.strokeColor && l.strokeWidth) {
    ctx.strokeStyle = l.strokeColor;
    ctx.lineWidth = l.strokeWidth;
    ctx.stroke();
  }
}

export interface RenderOptions {
  images?: ImageMap;
  /** 빈 사진 칸에 안내 문구 표시 (편집 화면용, 내보내기에선 false) */
  placeholders?: boolean;
}

export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, images: ImageMap, placeholders = true) {
  if (l.hidden) return;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  if (l.rotation) {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  if (l.type === 'text') drawText(ctx, l);
  else if (l.type === 'image') drawImage(ctx, l, images, placeholders);
  else drawShape(ctx, l);
  ctx.restore();
}

/** 페이지 전체를 (0,0)-(width,height)에 그린다. */
export function renderPage(
  ctx: CanvasRenderingContext2D,
  page: Page,
  width: number,
  height: number,
  { images = imageCache, placeholders = true }: RenderOptions = {},
) {
  ctx.save();
  ctx.fillStyle = makeFill(ctx, page.background, 0, 0, width, height);
  ctx.fillRect(0, 0, width, height);
  for (const l of page.layers) drawLayer(ctx, l, images, placeholders);
  ctx.restore();
}
