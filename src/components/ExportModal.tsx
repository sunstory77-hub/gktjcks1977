import { useRef, useState } from 'react';
import {
  canvasToBlob,
  dateStamp,
  downloadBlob,
  exportVideo,
  pickVideoMime,
  renderPageCanvas,
  renderStackedCanvas,
  safeName,
} from '../core/export';
import { getFormat } from '../core/formats';
import { projectToJson } from '../core/storage';
import { totalDuration } from '../core/timeline';
import type { Page, Project } from '../core/types';

interface Props {
  project: Project;
  current: Page;
  onClose: () => void;
}

type ImgType = 'png' | 'jpg';

export default function ExportModal({ project, current, onClose }: Props) {
  const fmt = getFormat(project.formatId);
  const base = `${safeName(project.name)}_${dateStamp()}`;
  const [imgType, setImgType] = useState<ImgType>('png');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState<File | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const mime = imgType === 'png' ? 'image/png' : 'image/jpeg';
  const videoFormat = (() => {
    try {
      return pickVideoMime(!!audio).ext === 'mp4'
        ? 'MP4 (H.264) — 인스타·유튜브 바로 업로드 가능'
        : 'WebM — 이 브라우저는 MP4 녹화 미지원. 최신 크롬 사용 또는 MP4 변환 후 업로드';
    } catch {
      return '이 브라우저는 영상 녹화 미지원';
    }
  })();

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') alert(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setProgress(0);
      if (previewRef.current) previewRef.current.innerHTML = '';
    }
  };

  const exportCurrent = () =>
    run('현재 페이지', async () => {
      const idx = project.pages.findIndex((p) => p.id === current.id) + 1;
      const c = await renderPageCanvas(project, current);
      downloadBlob(await canvasToBlob(c, mime), `${base}_${String(idx).padStart(2, '0')}.${imgType}`);
    });

  const exportAll = () =>
    run('전체 페이지', async () => {
      for (let i = 0; i < project.pages.length; i++) {
        const c = await renderPageCanvas(project, project.pages[i]);
        downloadBlob(await canvasToBlob(c, mime), `${base}_${String(i + 1).padStart(2, '0')}.${imgType}`);
        setProgress((i + 1) / project.pages.length);
        await new Promise((r) => setTimeout(r, 300)); // 브라우저 다중 다운로드 차단 회피
      }
    });

  const exportStacked = () =>
    run('상세페이지 한 장', async () => {
      const c = await renderStackedCanvas(project);
      downloadBlob(await canvasToBlob(c, mime), `${base}_상세페이지.${imgType}`);
    });

  const exportVid = () =>
    run('영상', async () => {
      abortRef.current = new AbortController();
      const { blob, ext } = await exportVideo(project, {
        audio,
        signal: abortRef.current.signal,
        onProgress: setProgress,
        onCanvas: (c) => {
          if (!previewRef.current) return;
          previewRef.current.innerHTML = '';
          previewRef.current.appendChild(c);
        },
      });
      downloadBlob(blob, `${base}_영상.${ext}`);
    });

  const exportJson = () => downloadBlob(new Blob([projectToJson(project)], { type: 'application/json' }), `${base}_프로젝트.json`);

  return (
    <div className="modal-back" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="export-modal">
        <header>
          <h2>내보내기</h2>
          <button className="ghost" onClick={onClose} disabled={!!busy}>
            닫기
          </button>
        </header>

        <section>
          <h3>이미지</h3>
          <div className="seg">
            {(['png', 'jpg'] as ImgType[]).map((t) => (
              <button key={t} className={imgType === t ? 'active' : ''} onClick={() => setImgType(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="btns">
            <button className="primary" onClick={exportCurrent} disabled={!!busy} data-testid="export-current">
              현재 페이지 저장
            </button>
            <button onClick={exportAll} disabled={!!busy}>
              전체 {project.pages.length}장 저장
            </button>
            {fmt.stackable && (
              <button onClick={exportStacked} disabled={!!busy} data-testid="export-stacked">
                섹션 이어붙여 한 장으로
              </button>
            )}
          </div>
        </section>

        <section>
          <h3>영상 (슬라이드쇼)</h3>
          <p className="muted small">
            페이지마다 설정한 길이·전환·모션으로 {fmt.width}×{fmt.height} 영상을 만듭니다. 총 {totalDuration(project.pages).toFixed(1)}초 ·
            실시간 녹화라 영상 길이만큼 걸립니다. 크롬 권장.
          </p>
          <p className="muted small" data-testid="video-format">
            저장 형식: {videoFormat}
          </p>
          <label className="row">
            <span>배경음악</span>
            <div className="row-body">
              <input type="file" accept="audio/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
            </div>
          </label>
          <div className="btns">
            <button className="primary" onClick={exportVid} disabled={!!busy} data-testid="export-video">
              영상 만들기
            </button>
            {busy === '영상' && (
              <button className="ghost danger" onClick={() => abortRef.current?.abort()}>
                취소
              </button>
            )}
          </div>
          <div className="video-preview" ref={previewRef} />
        </section>

        <section>
          <h3>프로젝트 백업</h3>
          <button className="ghost" onClick={exportJson}>
            JSON 파일로 저장
          </button>
        </section>

        {busy && (
          <div className="progress" data-testid="export-progress">
            <span>{busy} 내보내는 중… {progress > 0 && `${Math.round(progress * 100)}%`}</span>
            <div className="bar">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
