import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMATS, getFormat } from '../core/formats';
import { newProject } from '../core/project';
import { deleteProject, listProjects, projectFromJson } from '../core/storage';
import { templatesFor } from '../core/templates';
import type { FormatId, Project } from '../core/types';
import Thumbnail from './Thumbnail';

export default function Home({ onOpen }: { onOpen: (p: Project) => void }) {
  const [formatId, setFormatId] = useState<FormatId>('insta-square');
  const [saved, setSaved] = useState<Project[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects().then(setSaved).catch(() => setSaved([]));
  }, []);

  const previews = useMemo(() => templatesFor(formatId).map((t) => ({ t, preview: newProject(formatId, t.id) })), [formatId]);
  const fmt = getFormat(formatId);

  const importJson = async (file: File) => {
    try {
      onOpen(projectFromJson(await file.text()));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <h1>SNS 콘텐츠 스튜디오</h1>
        <p>상세페이지 · 인스타 피드 · 릴스/쇼츠 · 유튜브 썸네일을 한 곳에서 만들고 PNG·영상으로 내보냅니다.</p>
      </header>

      <section>
        <h2>1. 포맷 선택</h2>
        <div className="format-grid">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              className={`format-card ${f.id === formatId ? 'active' : ''}`}
              onClick={() => setFormatId(f.id)}
              data-testid={`format-${f.id}`}
            >
              <div className="ratio-box">
                <div style={{ aspectRatio: `${f.width} / ${f.id === 'detail' ? f.height * 2 : f.height}` }} />
              </div>
              <strong>{f.name}</strong>
              <span>
                {f.width}×{f.stackable ? '가변' : f.height}
              </span>
              <small>{f.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>2. 템플릿 선택 — {fmt.name}</h2>
        <div className="tpl-grid">
          <button className="tpl-card blank" onClick={() => onOpen(newProject(formatId))} data-testid="tpl-blank">
            <div className="tpl-blank-box">+</div>
            <strong>빈 캔버스</strong>
          </button>
          {previews.map(({ t, preview }) => {
            return (
              <button key={t.id} className="tpl-card" onClick={() => onOpen(newProject(formatId, t.id))} data-testid={`tpl-${t.id}`}>
                <Thumbnail project={preview} page={preview.pages[0]} maxW={220} maxH={220} />
                <strong>{t.name}</strong>
                <small>
                  {t.description} · {preview.pages.length}장
                </small>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2>
          저장된 작업
          <button className="ghost small" onClick={() => fileRef.current?.click()}>
            JSON 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
        </h2>
        {saved.length === 0 ? (
          <p className="muted">아직 저장된 작업이 없습니다. 편집기에서 작업하면 자동 저장됩니다.</p>
        ) : (
          <div className="tpl-grid">
            {saved.map((p) => (
              <div key={p.id} className="tpl-card">
                <button className="plain" onClick={() => onOpen(p)}>
                  <Thumbnail project={p} page={p.pages[0]} maxW={220} maxH={220} />
                  <strong>{p.name}</strong>
                  <small>
                    {getFormat(p.formatId).name} · {new Date(p.updatedAt).toLocaleString('ko-KR')}
                  </small>
                </button>
                <button
                  className="ghost small danger"
                  onClick={async () => {
                    if (!confirm(`'${p.name}'을(를) 삭제할까요?`)) return;
                    await deleteProject(p.id);
                    setSaved((s) => s.filter((x) => x.id !== p.id));
                  }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
