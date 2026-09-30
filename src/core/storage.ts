import type { Project } from './types';

/**
 * 프로젝트 저장소 (IndexedDB). 사진이 dataURL로 들어가서 localStorage 용량(5MB)으로는 부족하다.
 */
const DB_NAME = 'sns-content-studio';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export async function saveProject(p: Project): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...p, updatedAt: Date.now() }));
}

export async function listProjects(): Promise<Project[]> {
  const all = await tx<Project[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** 프로젝트를 JSON 파일로 백업/복원 */
export function projectToJson(p: Project): string {
  return JSON.stringify(p);
}

export function projectFromJson(json: string): Project {
  const p = JSON.parse(json) as Project;
  if (!p || typeof p !== 'object' || !Array.isArray(p.pages) || !p.formatId) {
    throw new Error('올바른 프로젝트 파일이 아닙니다');
  }
  return p;
}
