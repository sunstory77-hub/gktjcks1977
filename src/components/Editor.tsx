import { useCallback, useEffect, useRef, useState } from 'react';
import { pageHeight } from '../core/export';
import { getFormat } from '../core/formats';
import { clonePage, imageLayer, page as newPage, shapeLayer, solid, textLayer } from '../core/layers';
import { moveLayer, updateLayer, updatePage } from '../core/project';
import { ensureFonts, layoutText } from '../core/render';
import { saveProject } from '../core/storage';
import type { Layer, Page, Project } from '../core/types';
import ExportModal from './ExportModal';
import { fileToDataUrl, pickFile } from './images';
import PropsPanel from './PropsPanel';
import Stage from './Stage';
import Thumbnail from './Thumbnail';
import { useHistory } from './useHistory';

const measureCtx = document.createElement('canvas').getContext('2d')!;

/** 텍스트 레이어는 내용에 맞춰 높이를 자동 계산 */
function fitText(l: Layer): Layer {
  return l.type === 'text' ? { ...l, h: Math.ceil(layoutText(measureCtx, l).height) } : l;
}

function fitAllText(p: Project): Project {
  return { ...p, pages: p.pages.map((pg) => ({ ...pg, layers: pg.layers.map(fitText) })) };
}

export default function Editor({ initial, onExit }: { initial: Project; onExit: () => void }) {
  const h = useHistory<Project>(initial);
  const project = h.present;
  const fmt = getFormat(project.formatId);
  const [pageId, setPageId] = useState(initial.pages[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
  const selected = page.layers.find((l) => l.id === selectedId) ?? null;
  const W = fmt.width;
  const H = pageHeight(project, page);

  // 웹폰트 로드 후 텍스트 높이 재계산 (기록 없이)
  useEffect(() => {
    ensureFonts(initial.pages).then(() => h.replace((p) => fitAllText(p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자동 저장
  useEffect(() => {
    setSaveState('saving');
    const t = setTimeout(() => {
      saveProject(project)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 700);
    return () => clearTimeout(t);
  }, [project]);

  const setPage = (patch: Partial<Page>) => h.set((p) => updatePage(p, page.id, (pg) => ({ ...pg, ...patch })));

  const patchLayer = useCallback(
    (id: string, patch: Partial<Layer>, record = true) => {
      const apply = (p: Project) => {
        const next = updateLayer(p, page.id, id, patch);
        return updatePage(next, page.id, (pg) => ({ ...pg, layers: pg.layers.map((l) => (l.id === id ? fitText(l) : l)) }));
      };
      if (record) h.set(apply);
      else h.replace(apply);
    },
    [h, page.id],
  );

  const addLayer = (l: Layer) => {
    h.set((p) => updatePage(p, page.id, (pg) => ({ ...pg, layers: [...pg.layers, fitText(l)] })));
    setSelectedId(l.id);
  };

  const addText = (kind: 'title' | 'body') =>
    addLayer(
      textLayer(
        kind === 'title'
          ? { text: '제목을 입력하세요', x: W * 0.08, y: H * 0.4, w: W * 0.84, fontSize: Math.round(W / 12), fontWeight: 900, align: 'center' }
          : { text: '본문 내용을 입력하세요', x: W * 0.08, y: H * 0.55, w: W * 0.84, fontSize: Math.round(W / 28), fontWeight: 400, align: 'center', lineHeight: 1.6 },
      ),
    );

  const addImageFromFile = async (file: File, cx?: number, cy?: number) => {
    const { src, width, height } = await fileToDataUrl(file);
    const s = Math.min((W * 0.7) / width, (H * 0.7) / height);
    const w = Math.round(width * s);
    const hh = Math.round(height * s);
    addLayer(imageLayer({ src, w, h: hh, x: Math.round((cx ?? W / 2) - w / 2), y: Math.round((cy ?? H / 2) - hh / 2) }));
  };

  const addImage = async () => {
    const f = await pickFile('image/*');
    if (f) await addImageFromFile(f);
  };

  const replaceImage = async (id: string) => {
    const f = await pickFile('image/*');
    if (!f) return;
    const { src } = await fileToDataUrl(f);
    patchLayer(id, { src } as Partial<Layer>);
  };

  const onDropFile = async (file: File, x: number, y: number) => {
    const target = [...page.layers].reverse().find((l) => l.type === 'image' && x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h);
    if (target) {
      const { src } = await fileToDataUrl(file);
      patchLayer(target.id, { src } as Partial<Layer>);
      setSelectedId(target.id);
    } else {
      await addImageFromFile(file, x, y);
    }
  };

  const deleteLayer = (id: string) => {
    h.set((p) => updatePage(p, page.id, (pg) => ({ ...pg, layers: pg.layers.filter((l) => l.id !== id) })));
    setSelectedId(null);
  };

  const duplicateLayer = (id: string) => {
    const src = page.layers.find((l) => l.id === id);
    if (!src) return;
    const copy = { ...src, id: `${src.id}_c${Date.now().toString(36)}`, x: src.x + 30, y: src.y + 30 };
    h.set((p) => updatePage(p, page.id, (pg) => ({ ...pg, layers: [...pg.layers, copy] })));
    setSelectedId(copy.id);
  };

  // ── 페이지 조작
  const addPage = () => {
    const np = newPage({ background: page.background, height: page.height, duration: page.duration });
    const idx = project.pages.findIndex((p) => p.id === page.id);
    h.set((p) => ({ ...p, pages: [...p.pages.slice(0, idx + 1), np, ...p.pages.slice(idx + 1)] }));
    setPageId(np.id);
    setSelectedId(null);
  };
  const duplicatePage = () => {
    const np = clonePage(page);
    const idx = project.pages.findIndex((p) => p.id === page.id);
    h.set((p) => ({ ...p, pages: [...p.pages.slice(0, idx + 1), np, ...p.pages.slice(idx + 1)] }));
    setPageId(np.id);
    setSelectedId(null);
  };
  const deletePage = () => {
    if (project.pages.length <= 1) return;
    const idx = project.pages.findIndex((p) => p.id === page.id);
    const rest = project.pages.filter((p) => p.id !== page.id);
    h.set((p) => ({ ...p, pages: p.pages.filter((x) => x.id !== page.id) }));
    setPageId(rest[Math.max(0, idx - 1)].id);
    setSelectedId(null);
  };
  const movePage = (dir: -1 | 1) => {
    const i = project.pages.findIndex((p) => p.id === page.id);
    const j = i + dir;
    if (j < 0 || j >= project.pages.length) return;
    h.set((p) => {
      const pages = [...p.pages];
      [pages[i], pages[j]] = [pages[j], pages[i]];
      return { ...p, pages };
    });
  };

  // ── 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        h.redo();
        return;
      }
      if (typing || !selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteLayer(selected.id);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateLayer(selected.id);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        patchLayer(selected.id, { x: selected.x + dx, y: selected.y + dy });
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="editor">
      <header className="topbar">
        <button className="ghost" onClick={onExit}>
          ← 홈
        </button>
        <input className="title-input" value={project.name} onChange={(e) => h.replace((p) => ({ ...p, name: e.target.value }))} aria-label="프로젝트 이름" />
        <span className="badge">{fmt.name}</span>
        <span className={`save ${saveState}`}>{saveState === 'saved' ? '저장됨' : saveState === 'saving' ? '저장 중…' : '저장 실패'}</span>
        <div className="spacer" />
        <button className="ghost" onClick={h.undo} disabled={!h.canUndo} title="실행취소 (Ctrl+Z)">
          ↶
        </button>
        <button className="ghost" onClick={h.redo} disabled={!h.canRedo} title="다시실행 (Ctrl+Shift+Z)">
          ↷
        </button>
        <button className="primary" onClick={() => setExportOpen(true)} data-testid="open-export">
          내보내기
        </button>
      </header>

      <div className="workspace">
        <aside className="pages">
          <div className="pages-list">
            {project.pages.map((p, i) => (
              <button
                key={p.id}
                className={`page-thumb ${p.id === page.id ? 'active' : ''}`}
                onClick={() => {
                  setPageId(p.id);
                  setSelectedId(null);
                }}
              >
                <span className="num">{i + 1}</span>
                <Thumbnail project={project} page={p} maxW={120} maxH={150} />
              </button>
            ))}
          </div>
          <div className="pages-actions">
            <button onClick={addPage} data-testid="add-page">
              + 페이지
            </button>
            <button onClick={duplicatePage}>복제</button>
            <button className="danger" onClick={deletePage} disabled={project.pages.length <= 1}>
              삭제
            </button>
            <button onClick={() => movePage(-1)} title="위로">
              ▲
            </button>
            <button onClick={() => movePage(1)} title="아래로">
              ▼
            </button>
          </div>
        </aside>

        <main className="center">
          <div className="toolbar">
            <button onClick={() => addText('title')} data-testid="add-title">
              T 제목
            </button>
            <button onClick={() => addText('body')}>T 본문</button>
            <button onClick={addImage} data-testid="add-image">
              사진
            </button>
            <button onClick={() => addLayer(shapeLayer({ x: W / 2 - 150, y: H / 2 - 150, fill: solid('#4f46e5'), radius: 24 }))}>□ 사각형</button>
            <button onClick={() => addLayer(shapeLayer({ shape: 'ellipse', x: W / 2 - 150, y: H / 2 - 150, fill: solid('#f59e0b') }))}>○ 원</button>
            {selected && (
              <>
                <span className="sep" />
                <button onClick={() => h.set((p) => updatePage(p, page.id, (pg) => moveLayer(pg, selected.id, 1)))}>앞으로</button>
                <button onClick={() => h.set((p) => updatePage(p, page.id, (pg) => moveLayer(pg, selected.id, -1)))}>뒤로</button>
                <button onClick={() => patchLayer(selected.id, { x: Math.round(W / 2 - selected.w / 2) })}>가로 중앙</button>
                <button onClick={() => duplicateLayer(selected.id)}>복제</button>
                <button className="danger" onClick={() => deleteLayer(selected.id)}>
                  삭제
                </button>
              </>
            )}
          </div>
          <Stage
            page={page}
            width={W}
            height={H}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDragStart={h.checkpoint}
            onDragLayer={(id, patch) => patchLayer(id, patch, false)}
            onDropFile={onDropFile}
            onDoubleClick={(l) => {
              setSelectedId(l.id);
              if (l.type === 'text') setTimeout(() => textRef.current?.select(), 0);
              if (l.type === 'image') void replaceImage(l.id);
            }}
          />
        </main>

        <aside className="side">
          <PropsPanel
            formatId={project.formatId}
            page={page}
            layer={selected}
            onPage={setPage}
            onLayer={(patch) => selected && patchLayer(selected.id, patch)}
            onReplaceImage={() => selected && replaceImage(selected.id)}
            textRef={textRef}
          />
          <div className="layers">
            <h3>레이어</h3>
            {[...page.layers].reverse().map((l) => (
              <div key={l.id} className={`layer-row ${l.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(l.id)}>
                <span className="kind">{l.type === 'text' ? 'T' : l.type === 'image' ? '▣' : '■'}</span>
                <span className="name">{l.name}</span>
                <button
                  className="icon"
                  title="보이기/숨기기"
                  onClick={(e) => {
                    e.stopPropagation();
                    patchLayer(l.id, { hidden: !l.hidden });
                  }}
                >
                  {l.hidden ? '◌' : '●'}
                </button>
                <button
                  className="icon"
                  title="잠금"
                  onClick={(e) => {
                    e.stopPropagation();
                    patchLayer(l.id, { locked: !l.locked });
                  }}
                >
                  {l.locked ? '🔒' : '🔓'}
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {exportOpen && <ExportModal project={project} current={page} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
