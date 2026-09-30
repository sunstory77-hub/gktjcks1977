import { useEffect, useRef } from 'react';
import { pageHeight } from '../core/export';
import { getFormat } from '../core/formats';
import { ensureFonts, loadImages, renderPage } from '../core/render';
import type { Page, Project } from '../core/types';

/** 페이지 축소 미리보기 */
export default function Thumbnail({ project, page, maxW, maxH }: { project: Project; page: Page; maxW: number; maxH: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = getFormat(project.formatId).width;
  const H = pageHeight(project, page);
  const scale = Math.min(maxW / W, maxH / H);

  useEffect(() => {
    let alive = true;
    const draw = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx || !alive) return;
      ctx.setTransform(scale * devicePixelRatio, 0, 0, scale * devicePixelRatio, 0, 0);
      renderPage(ctx, page, W, H);
    };
    draw();
    Promise.all([ensureFonts([page]), loadImages([page])]).then(draw);
    return () => {
      alive = false;
    };
  }, [page, W, H, scale]);

  return (
    <canvas
      ref={ref}
      className="thumb"
      width={Math.round(W * scale * devicePixelRatio)}
      height={Math.round(H * scale * devicePixelRatio)}
      style={{ width: W * scale, height: H * scale }}
    />
  );
}
