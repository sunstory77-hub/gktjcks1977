/* DETAIL PAGE AI — 공통 코어: 유틸, 서버 통신, 상태, 되돌리기, 자동 저장, 모달. by BAPI */
(function () {
  'use strict';
  const S = window.DPA_SCHEMA;
  const DPA = (window.DPA = { S, rt: { connected: false, models: null, available: null, consent: false, pending: new Set(), saveState: 'idle' }, project: null });

  // ───────────── DOM 도우미 ─────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const PROPS = new Set(['value', 'disabled', 'checked', 'hidden', 'selected', 'readOnly', 'htmlFor', 'placeholder', 'rows', 'maxLength', 'min', 'max', 'step', 'accept', 'multiple', 'href', 'download', 'src', 'alt', 'title', 'type', 'name', 'id', 'open']);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c.nodeType ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  DPA.$ = $; DPA.$$ = $$; DPA.h = h;

  // ───────────── 알림 ─────────────
  function toast(msg, kind, action) {
    let box = $('#toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const t = h('div', { class: 'toast ' + (kind || 'info'), role: 'status' }, h('span', { text: msg }));
    if (action) t.append(h('button', { class: 'link', text: action.label, onclick: () => { action.fn(); t.remove(); } }));
    t.append(h('button', { class: 'x', 'aria-label': '닫기', text: '×', onclick: () => t.remove() }));
    box.append(t);
    setTimeout(() => t.remove(), kind === 'err' ? 9000 : 4800);
  }
  DPA.toast = toast;

  // ───────────── 모달 ─────────────
  function modal(opts) {
    const closeBtn = h('button', { class: 'icon-btn', 'aria-label': '닫기', text: '×', onclick: () => dlg.close() });
    const bodyEl = h('div', { class: 'modal-b' }, opts.body);
    const foot = opts.actions && opts.actions.length ? h('div', { class: 'modal-f' }, opts.actions) : null;
    const dlg = h('dialog', { class: 'modal' + (opts.wide ? ' wide' : '') }, h('div', { class: 'modal-h' }, h('h3', { text: opts.title }), closeBtn), bodyEl, foot);
    dlg.addEventListener('click', (e) => { if (e.target === dlg && !opts.persistent) dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); if (opts.onClose) opts.onClose(); });
    dlg.addEventListener('cancel', (e) => { if (opts.persistent) e.preventDefault(); });
    document.body.append(dlg);
    dlg.showModal();
    return { el: dlg, body: bodyEl, close: () => dlg.close(), setFoot(nodes) { if (foot) { foot.replaceChildren(...nodes); } } };
  }
  DPA.modal = modal;

  function confirmBox(message, o) {
    o = o || {};
    return new Promise((resolve) => {
      let result = false;
      const m = modal({
        title: o.title || '확인', body: h('p', { class: 'pre', text: message }),
        onClose: () => resolve(result),
        actions: [
          h('button', { class: 'btn', text: o.cancelText || '취소', onclick: () => m.close() }),
          h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), text: o.okText || '확인', onclick: () => { result = true; m.close(); } }),
        ],
      });
    });
  }
  DPA.confirm = confirmBox;

  // ───────────── 서버 통신 ─────────────
  class ApiError extends Error {
    constructor(code, message, status) { super(message); this.code = code; this.status = status; }
  }
  DPA.ApiError = ApiError;
  const TOKEN = (document.querySelector('meta[name=dpa-token]') || {}).content || '';

  async function api(method, path, body, opts) {
    opts = opts || {};
    const headers = { 'x-dpa-token': TOKEN, ...((opts && opts.headers) || {}) };
    let payload;
    if (body instanceof Blob) { payload = body; headers['content-type'] = body.type || 'application/octet-stream'; }
    else if (typeof body === 'string' && opts.rawText) { payload = body; headers['content-type'] = 'application/json'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    let res;
    try {
      res = await fetch(path, { method, headers, body: payload, signal: opts.signal, keepalive: !!opts.keepalive });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new ApiError('cancelled', '취소되었습니다.', 0);
      throw new ApiError('offline', '프로그램과 연결할 수 없습니다. 프로그램이 종료되었다면 바탕화면 바로가기로 다시 실행해 주세요.', 0);
    }
    if (opts.raw && res.ok) return res;
    if (opts.blob && res.ok) return res.blob();
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
    if (!res.ok) {
      const er = (data && data.error) || {};
      throw new ApiError(er.code || 'http_' + res.status, er.message || `요청에 실패했습니다(${res.status}).`, res.status);
    }
    return data;
  }
  DPA.api = api;
  DPA.assetUrl = (aid, ref) => `/api/projects/${DPA.project.id}/assets/${aid}${ref ? '?ref=1' : ''}`;

  // ───────────── 이미지 캐시(미리보기·내보내기 공용) ─────────────
  const imgCache = new Map();
  const imgWaiters = new Map();
  function getImage(aid) {
    const key = DPA.project.id + '/' + aid;
    const c = imgCache.get(key);
    if (c) return c.ok ? c.img : null;
    const img = new Image();
    const rec = { img, ok: false };
    imgCache.set(key, rec);
    img.onload = () => { rec.ok = true; (imgWaiters.get(key) || []).forEach((f) => f()); imgWaiters.delete(key); DPA.emit('image-loaded', { aid }); };
    img.onerror = () => { imgCache.delete(key); };
    img.src = DPA.assetUrl(aid);
    return null;
  }
  function loadImage(aid) {
    return new Promise((resolve, reject) => {
      const key = DPA.project.id + '/' + aid;
      const c = imgCache.get(key);
      if (c && c.ok) return resolve(c.img);
      const img = new Image();
      img.onload = () => { imgCache.set(key, { img, ok: true }); resolve(img); };
      img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
      img.src = DPA.assetUrl(aid);
    });
  }
  DPA.getImage = getImage; DPA.loadImage = loadImage;

  // ───────────── 이벤트 ─────────────
  const handlers = {};
  DPA.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  DPA.emit = (ev, data) => { (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

  // ───────────── 프로젝트 상태·되돌리기 ─────────────
  const undoStack = [];
  const redoStack = [];
  let lastKey = null, lastAt = 0;
  const snapshot = () => JSON.stringify({ name: DPA.project.name, product: DPA.project.product, photos: DPA.project.photos, mode: DPA.project.mode, brief: DPA.project.brief, blocks: DPA.project.blocks, i18n: DPA.project.i18n });
  const restore = (json) => { Object.assign(DPA.project, JSON.parse(json)); };

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }
  // 상태를 바꾸는 모든 편집은 mutate 를 거친다. 같은 key 의 연속 입력은 하나의 되돌리기 단위로 묶는다.
  function mutate(fn, key, scope) {
    const now = Date.now();
    if (!(key && key === lastKey && now - lastAt < 1500)) pushUndo();
    lastKey = key || null; lastAt = now;
    fn(DPA.project);
    touch(scope || 'all');
  }
  function touch(scope) {
    scheduleSave();
    DPA.emit('changed', { scope: scope || 'all' });
    DPA.emit('undo-state');
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    lastKey = null;
    touch('all'); DPA.emit('restored');
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    lastKey = null;
    touch('all'); DPA.emit('restored');
  }
  DPA.mutate = mutate; DPA.touch = touch; DPA.undo = undo; DPA.redo = redo;
  DPA.canUndo = () => undoStack.length > 0; DPA.canRedo = () => redoStack.length > 0;
  DPA.resetHistory = () => { undoStack.length = 0; redoStack.length = 0; lastKey = null; };

  // ───────────── 자동 저장 ─────────────
  let saveTimer = null, saving = false, again = false, conflict = false, retryTimer = null;
  function setSaveState(s, msg) { DPA.rt.saveState = s; DPA.emit('save-state', { state: s, msg }); }
  function scheduleSave() {
    if (conflict) return;
    setSaveState('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow(opts) {
    clearTimeout(saveTimer);
    if (!DPA.project || conflict) return;
    if (saving) { again = true; return; }
    saving = true;
    setSaveState('saving');
    try {
      const body = { baseRev: DPA.project.rev, project: { ...DPA.project, rev: undefined } };
      const r = await api('PUT', `/api/projects/${DPA.project.id}`, body, { keepalive: !!(opts && opts.keepalive) });
      DPA.project.rev = r.rev; DPA.project.updatedAt = r.updatedAt;
      setSaveState('saved');
    } catch (e) {
      if (e.status === 409) {
        conflict = true;
        setSaveState('conflict', e.message);
      } else {
        setSaveState('error', e.message);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(saveNow, 5000);
      }
    } finally {
      saving = false;
      if (again) { again = false; scheduleSave(); }
    }
  }
  DPA.saveNow = saveNow;
  DPA.flushSave = async () => {
    clearTimeout(saveTimer);
    for (let i = 0; i < 20 && (saving || DPA.rt.saveState === 'dirty'); i++) {
      if (!saving) await saveNow();
      else await new Promise((r) => setTimeout(r, 100));
    }
  };
  window.addEventListener('beforeunload', () => { if (DPA.rt.saveState === 'dirty') saveNow({ keepalive: true }); });
  DPA.clearConflict = () => { conflict = false; };

  // ───────────── 기타 ─────────────
  DPA.fmtTime = (d) => new Date(d || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  DPA.ymd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  DPA.safeName = (s) => (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 60) || '상세페이지');
  DPA.saveBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };
  DPA.errMsg = (e) => (e && e.message) || '알 수 없는 오류가 발생했습니다.';
  // 현재(또는 지정한) 언어로 보이는 블록. 한국어가 아니면 번역문·언어별 이미지·언어별 숨김이 반영된 사본이다.
  DPA.lang = 'ko';
  DPA.localBlocks = (lang) => { const l = lang || DPA.lang || 'ko'; return DPA.project.blocks.map((b) => (l === 'ko' ? b : S.localizeBlock(DPA.project, l, b))); };
  DPA.visibleBlocks = (lang) => DPA.localBlocks(lang).filter((b) => !b.hidden && S.blockHasContent(b));
  DPA.slotVisible = (s) => !!(s.assetId && !s.deleted);
})();
