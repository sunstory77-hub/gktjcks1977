import { getFormat } from './formats';
import { uid } from './id';
import { blankPages, TEMPLATES } from './templates';
import type { FormatId, Layer, Page, Project } from './types';

export function newProject(formatId: FormatId, templateId?: string): Project {
  const tpl = templateId ? TEMPLATES.find((t) => t.id === templateId) : undefined;
  return {
    id: uid('prj'),
    name: tpl ? tpl.name : `${getFormat(formatId).name} 새 작업`,
    formatId,
    pages: tpl ? tpl.build() : blankPages(formatId),
    updatedAt: Date.now(),
  };
}

export function updatePage(project: Project, pageId: string, fn: (p: Page) => Page): Project {
  return { ...project, pages: project.pages.map((p) => (p.id === pageId ? fn(p) : p)) };
}

export function updateLayer(project: Project, pageId: string, layerId: string, patch: Partial<Layer>): Project {
  return updatePage(project, pageId, (p) => ({
    ...p,
    layers: p.layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l)),
  }));
}

/** 레이어 순서 이동 (dir: +1 앞으로, -1 뒤로) */
export function moveLayer(page: Page, layerId: string, dir: 1 | -1): Page {
  const i = page.layers.findIndex((l) => l.id === layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= page.layers.length) return page;
  const layers = [...page.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...page, layers };
}

/** 좌표에서 가장 위에 있는 레이어 (회전은 무시한 박스 기준) */
export function hitTest(page: Page, x: number, y: number): Layer | undefined {
  for (let i = page.layers.length - 1; i >= 0; i--) {
    const l = page.layers[i];
    if (l.hidden || l.locked) continue;
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l;
  }
  return undefined;
}
