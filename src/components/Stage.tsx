import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hitTest } from '../core/project';
import { ensureFonts, loadImages, renderPage } from '../core/render';
import type { Layer, Page } from '../core/types';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { mode: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'resize'; id: string; corner: Corner; sx: number; sy: number; o: Pick<Layer, 'x' | 'y' | 'w' | 'h'>; ratio: number };

interface Props {
  page: Page;
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDragStart: () => void;
  onDragLayer: (id: string, patch: Partial<Layer>) => void;
  onDropFile: (file: File, x: number, y: number) => void;
  onDoubleClick: (layer: Layer) => void;
}

const SNAP = 10;

export default function Stage({ page, width, height, selectedId, onSelect, onDragStart, onDragLayer, onDropFile, onDoubleClick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const drag = useRef<Drag | null>(null);
  const [loadTick, setLoadTick] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.max(0.05, Math.min((box.w - 48) / width, (box.h - 48) / height));
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    let alive = true;
    Promise.all([ensureFonts([page]), loadImages([page])]).then(() => alive && setLoadTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [page]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    renderPage(ctx, page, width, height);
  }, [page, scale, dpr, width, height, loadTick]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const selected = page.layers.find((l) => l.id === selectedId) ?? null;

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toPage(e);
    const corner = (e.target as HTMLElement).dataset.corner as Corner | undefined;
    if (corner && selected) {
      drag.current = { mode: 'resize', id: selected.id, corner, sx: x, sy: y, o: { x: selected.x, y: selected.y, w: selected.w, h: selected.h }, ratio: selected.w / selected.h };
    } else {
      const hit = hitTest(page, x, y);
      onSelect(hit?.id ?? null);
      if (!hit) return;
      drag.current = { mode: 'move', id: hit.id, sx: x, sy: y, ox: hit.x, oy: hit.y };
    }
    onDragStart();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toPage(e);
    const dx = x - d.sx;
    const dy = y - d.sy;
    const layer = page.layers.find((l) => l.id === d.id);
    if (!layer) return;
    if (d.mode === 'move') {
      let nx = Math.round(d.ox + dx);
      let ny = Math.round(d.oy + dy);
      const snapV = Math.abs(nx + layer.w / 2 - width / 2) < SNAP / scale;
      const snapH = Math.abs(ny + layer.h / 2 - height / 2) < SNAP / scale;
      if (snapV && !e.altKey) nx = Math.round(width / 2 - layer.w / 2);
      if (snapH && !e.altKey) ny = Math.round(height / 2 - layer.h / 2);
      setGuides({ v: snapV && !e.altKey, h: snapH && !e.altKey });
      onDragLayer(d.id, { x: nx, y: ny });
    } else {
      const { o, corner } = d;
      let { x: nx, y: ny, w: nw, h: nh } = o;
      if (corner.includes('e')) nw = o.w + dx;
      if (corner.includes('w')) {
        nw = o.w - dx;
        nx = o.x + dx;
      }
      if (corner.includes('s')) nh = o.h + dy;
      if (corner.includes('n')) {
        nh = o.h - dy;
        ny = o.y + dy;
      }
      // 사진·도형은 Shift로 비율 유지, 텍스트는 높이 자동이라 너비만
      if (e.shiftKey && layer.type !== 'text') {
        nh = nw / d.ratio;
        if (corner.includes('n')) ny = o.y + o.h - nh;
      }
      nw = Math.max(20, nw);
      nh = Math.max(20, nh);
      const patch: Partial<Layer> = { x: Math.round(nx), w: Math.round(nw) };
      if (layer.type !== 'text') Object.assign(patch, { y: Math.round(ny), h: Math.round(nh) });
      onDragLayer(d.id, patch);
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    setGuides({ v: false, h: false });
  };

  return (
    <div
      className="stage-wrap"
      ref={wrapRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('image/')) {
          const { x, y } = toPage(e);
          onDropFile(f, x, y);
        }
      }}
    >
      <div className="stage" style={{ width: width * scale, height: height * scale }}>
        <canvas
          ref={canvasRef}
          data-testid="stage-canvas"
          width={Math.round(width * scale * dpr)}
          height={Math.round(height * scale * dpr)}
          style={{ width: width * scale, height: height * scale }}
        />
        <div
          className="overlay"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            const { x, y } = toPage(e);
            const hit = hitTest(page, x, y);
            if (hit) onDoubleClick(hit);
          }}
        >
          {guides.v && <div className="guide v" />}
          {guides.h && <div className="guide h" />}
          {selected && !selected.hidden && (
            <div
              className="sel"
              style={{
                left: selected.x * scale,
                top: selected.y * scale,
                width: selected.w * scale,
                height: selected.h * scale,
                transform: `rotate(${selected.rotation}deg)`,
              }}
            >
              {(['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
                <span key={c} className={`handle ${c}`} data-corner={c} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="stage-info">
        {width}×{height}px · {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
