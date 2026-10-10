'use strict';
/* 프로젝트·이미지 저장소. 사용자 자료는 설치 폴더 밖(데이터 폴더)에 두어 업데이트 때 보존된다. */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const S = require('../public/js/schema.js');

const MAX_ASSET_BYTES = 12 * 1024 * 1024;

function dataDir() {
  if (process.env.DPA_DATA_DIR) return path.resolve(process.env.DPA_DATA_DIR);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'DETAIL PAGE AI');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'detail-page-ai');
}

class StoreError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status || 400; }
}

// Windows 에서는 백신·인덱서가 파일을 잠깐 잡고 있으면 EPERM/EBUSY 가 날 수 있어 짧게 재시도한다.
async function retryFs(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code)) throw e;
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
}

// 임시 파일에 쓰고 fsync 한 뒤 교체한다. 도중에 실패해도 기존 파일은 그대로 남는다.
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } catch (e) {
    await fh.close().catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw e;
  }
  await fh.close();
  try {
    if (fs.existsSync(file)) await retryFs(() => fsp.copyFile(file, file + '.bak')).catch(() => {});
    await retryFs(() => fsp.rename(tmp, file));
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
const EXTS = ['jpg', 'png', 'webp'];
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

class Store {
  constructor(dir) {
    this.dir = dir || dataDir();
    this.locks = new Map();
  }

  get projectsDir() { return path.join(this.dir, 'projects'); }
  get trashDir() { return path.join(this.dir, 'trash'); }
  pdir(id) {
    if (!S.ID_RE.test(String(id))) throw new StoreError('bad_id', '프로젝트 번호가 올바르지 않습니다.', 400);
    return path.join(this.projectsDir, id);
  }
  pfile(id) { return path.join(this.pdir(id), 'project.json'); }

  async init() {
    await fsp.mkdir(this.projectsDir, { recursive: true });
    await fsp.mkdir(path.join(this.dir, 'logs'), { recursive: true });
  }

  async _lock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const chain = prev.then(() => gate);
    this.locks.set(id, chain);
    await prev;
    try { return await fn(); } finally { release(); if (this.locks.get(id) === chain) this.locks.delete(id); }
  }

  async _readJson(file) {
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') {
        // 저장 도중 끊긴 경우를 대비해 직전 백업을 확인한다.
        try { return JSON.parse(await fsp.readFile(file + '.bak', 'utf8')); } catch { return null; }
      }
      try { return JSON.parse(await fsp.readFile(file + '.bak', 'utf8')); } catch { return null; }
    }
  }

  async readProject(id) {
    const j = await this._readJson(this.pfile(id));
    if (!j) throw new StoreError('not_found', '프로젝트를 찾을 수 없습니다.', 404);
    return S.sanitizeProject({ ...j, id });
  }

  async createProject(initial) {
    const p = S.sanitizeProject({ ...(initial || {}), id: S.newId('p'), rev: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (!initial || !initial.name) p.name = '새 상세페이지';
    await atomicWrite(this.pfile(p.id), JSON.stringify(p));
    await this.setCurrent(p.id);
    return p;
  }

  // baseRev 가 현재 저장본과 다르면(다른 창에서 수정) 덮어쓰지 않고 충돌을 알린다.
  async writeProject(id, incoming, baseRev) {
    return this._lock(id, async () => {
      const cur = await this._readJson(this.pfile(id));
      if (!cur) throw new StoreError('not_found', '프로젝트를 찾을 수 없습니다.', 404);
      const curRev = Number.isInteger(cur.rev) ? cur.rev : 0;
      if (baseRev !== curRev) throw new StoreError('conflict', '다른 창에서 이 프로젝트가 변경되었습니다. 새로고침 후 다시 작업해 주세요.', 409);
      const p = S.sanitizeProject({ ...incoming, id, createdAt: cur.createdAt, rev: curRev + 1, updatedAt: new Date().toISOString() });
      await atomicWrite(this.pfile(id), JSON.stringify(p));
      return { rev: p.rev, updatedAt: p.updatedAt };
    });
  }

  async listProjects() {
    await this.init();
    const out = [];
    for (const d of await fsp.readdir(this.projectsDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !S.ID_RE.test(d.name)) continue;
      const j = await this._readJson(path.join(this.projectsDir, d.name, 'project.json'));
      if (!j) continue;
      const p = S.sanitizeProject({ ...j, id: d.name });
      const hero = p.blocks.find((b) => b.type === 'hero');
      const slot = hero && hero.images.find((s) => s.assetId && !s.deleted);
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, blocks: p.blocks.length, thumb: slot ? slot.assetId : (p.photos[0] ? p.photos[0].assetId : null) });
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  }

  // 삭제는 휴지통 폴더로 옮긴다(되살릴 수 있음).
  async deleteProject(id) {
    const src = this.pdir(id);
    if (!fs.existsSync(src)) throw new StoreError('not_found', '프로젝트를 찾을 수 없습니다.', 404);
    await fsp.mkdir(this.trashDir, { recursive: true });
    await fsp.rename(src, path.join(this.trashDir, `${id}_${Date.now()}`));
    const cur = await this.getCurrent();
    if (cur === id) await this.setCurrent(null);
  }

  async getCurrent() {
    const j = await this._readJson(path.join(this.dir, 'state.json'));
    const id = j && j.lastProjectId;
    if (id && S.ID_RE.test(id) && fs.existsSync(this.pfile(id))) return id;
    return null;
  }
  async setCurrent(id) { await atomicWrite(path.join(this.dir, 'state.json'), JSON.stringify({ lastProjectId: id })); }

  // ───────────── 이미지 ─────────────
  assetPath(pid, aid, ext, ref) { return path.join(this.pdir(pid), 'assets', `${aid}${ref ? '.ref' : ''}.${ext}`); }

  async saveAsset(pid, buf) {
    if (!fs.existsSync(this.pdir(pid))) throw new StoreError('not_found', '프로젝트를 찾을 수 없습니다.', 404);
    if (!buf || buf.length === 0) throw new StoreError('empty', '빈 파일입니다.', 400);
    if (buf.length > MAX_ASSET_BYTES) throw new StoreError('too_large', '이미지 용량이 너무 큽니다(최대 10MB).', 413);
    const kind = sniffImage(buf);
    if (!kind) throw new StoreError('bad_type', 'JPG, PNG, WEBP 이미지만 사용할 수 있습니다.', 415);
    const id = S.newId('a');
    await atomicWrite(this.assetPath(pid, id, kind.ext), buf);
    return { id, mime: kind.mime, bytes: buf.length };
  }

  async saveRef(pid, aid, buf) {
    if (!S.ID_RE.test(aid)) throw new StoreError('bad_id', '이미지 번호가 올바르지 않습니다.', 400);
    const kind = sniffImage(buf);
    if (!kind || buf.length > MAX_ASSET_BYTES) throw new StoreError('bad_type', '참고용 이미지 형식이 올바르지 않습니다.', 415);
    if (!(await this.findAsset(pid, aid, false))) throw new StoreError('not_found', '이미지를 찾을 수 없습니다.', 404);
    await atomicWrite(this.assetPath(pid, aid, kind.ext, true), buf);
  }

  async findAsset(pid, aid, ref) {
    if (!S.ID_RE.test(aid)) return null;
    for (const ext of EXTS) {
      const f = this.assetPath(pid, aid, ext, ref);
      if (fs.existsSync(f)) return { file: f, mime: MIME[ext], ext };
    }
    return null;
  }

  async readAsset(pid, aid, ref) {
    const hit = (ref && (await this.findAsset(pid, aid, true))) || (await this.findAsset(pid, aid, false));
    if (!hit) throw new StoreError('not_found', '이미지를 찾을 수 없습니다.', 404);
    return { buf: await fsp.readFile(hit.file), mime: hit.mime, ext: hit.ext };
  }

  // ───────────── 백업·복원 ─────────────
  static referencedAssets(p) {
    const ids = new Set();
    p.photos.forEach((x) => ids.add(x.assetId));
    p.blocks.forEach((b) => b.images.forEach((s) => s.assetId && ids.add(s.assetId)));
    return [...ids];
  }

  async exportBackup(pid, appVersion) {
    const p = await this.readProject(pid);
    const assets = {};
    for (const aid of Store.referencedAssets(p)) {
      try {
        const a = await this.readAsset(pid, aid, false);
        const entry = { mime: a.mime, data: a.buf.toString('base64') };
        const r = await this.findAsset(pid, aid, true);
        if (r) entry.ref = (await fsp.readFile(r.file)).toString('base64');
        assets[aid] = entry;
      } catch { /* 없는 이미지는 건너뛴다 */ }
    }
    // API 키는 프로젝트 구조에 존재하지 않으며, 백업에도 포함하지 않는다.
    return JSON.stringify({ format: 'detail-page-ai-backup', schemaVersion: S.SCHEMA_VERSION, appVersion, exportedAt: new Date().toISOString(), project: p, assets });
  }

  async importBackup(text) {
    let j;
    try { j = JSON.parse(text); } catch { throw new StoreError('bad_backup', '백업 파일을 읽을 수 없습니다(JSON 형식이 아님).', 400); }
    if (!j || j.format !== 'detail-page-ai-backup' || !j.project || typeof j.project !== 'object') {
      throw new StoreError('bad_backup', 'DETAIL PAGE AI 백업 파일이 아닙니다.', 400);
    }
    if (Number(j.schemaVersion) > S.SCHEMA_VERSION) throw new StoreError('bad_backup', '더 새로운 버전에서 만든 백업입니다. 프로그램을 업데이트해 주세요.', 400);
    const p = S.sanitizeProject({ ...j.project, id: S.newId('p'), rev: 0, updatedAt: new Date().toISOString() });
    p.name = p.name + ' (복원)';
    const need = new Set(Store.referencedAssets(p));
    const assets = j.assets && typeof j.assets === 'object' ? j.assets : {};
    await fsp.mkdir(path.join(this.pdir(p.id), 'assets'), { recursive: true });
    const missing = [];
    try {
      for (const aid of need) {
        const a = assets[aid];
        const buf = a && typeof a.data === 'string' ? Buffer.from(a.data, 'base64') : null;
        const kind = buf && sniffImage(buf);
        if (!kind || buf.length > MAX_ASSET_BYTES) { missing.push(aid); continue; }
        await atomicWrite(this.assetPath(p.id, aid, kind.ext), buf);
        if (typeof a.ref === 'string') {
          const rb = Buffer.from(a.ref, 'base64');
          const rk = sniffImage(rb);
          if (rk && rb.length <= MAX_ASSET_BYTES) await atomicWrite(this.assetPath(p.id, aid, rk.ext, true), rb);
        }
      }
      // 이미지가 없는 항목은 참조를 제거한다.
      p.photos = p.photos.filter((x) => !missing.includes(x.assetId));
      p.blocks.forEach((b) => b.images.forEach((s) => { if (missing.includes(s.assetId)) { s.assetId = null; s.source = 'none'; } }));
      await atomicWrite(this.pfile(p.id), JSON.stringify(p));
    } catch (e) {
      await fsp.rm(this.pdir(p.id), { recursive: true, force: true });
      throw e;
    }
    await this.setCurrent(p.id);
    return { project: p, missingAssets: missing.length };
  }
}

module.exports = { Store, StoreError, dataDir, atomicWrite, sniffImage, MAX_ASSET_BYTES };
