/* DETAIL PAGE AI — 상품 정보 입력, 사진, AI 정리, 정보 검색·자료 분석. by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { S, h, $, toast, modal, api } = DPA;

  const FIELDS = { fName: 'name', fDesc: 'description', fTarget: 'target', fPrice: 'price', fSpec: 'spec', fShipping: 'shipping', fPromo: 'promo' };
  const MAX_BYTES = 10 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  DPA.fillForm = function () {
    const p = DPA.project.product;
    for (const [id, key] of Object.entries(FIELDS)) { const el = $('#' + id); if (el) el.value = p[key] || ''; }
    const opt = $('#optional');
    if (opt && (p.price || p.spec || p.shipping || p.promo)) opt.open = true;
    renderPhotos();
    $('#descHint').textContent = '';
  };

  function bindForm() {
    for (const [id, key] of Object.entries(FIELDS)) {
      $('#' + id).addEventListener('input', (e) => {
        DPA.mutate((pr) => { pr.product[key] = e.target.value; if (key === 'name') pr.name = e.target.value.trim() || '새 상세페이지'; }, 'prod:' + key, 'product');
      });
    }
  }

  // ───────────── 사진 ─────────────
  async function prepareImage(file) {
    if (!TYPES.includes(file.type)) throw new Error(`${file.name}: JPG, PNG, WEBP 파일만 올릴 수 있습니다.`);
    if (file.size > MAX_BYTES) throw new Error(`${file.name}: 10MB를 넘는 파일은 올릴 수 없습니다. (${(file.size / 1048576).toFixed(1)}MB)`);
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name}: 이미지를 열 수 없습니다. 손상된 파일일 수 있습니다.`); }
    const toBlob = (w, h2, q) => new Promise((resolve, reject) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h2;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h2); ctx.drawImage(bmp, 0, 0, w, h2);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 변환하지 못했습니다.'))), 'image/jpeg', q);
    });
    const scaleTo = (max) => { const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); return [Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k))]; };
    const big = Math.max(bmp.width, bmp.height) > 2400 || file.size > 4 * 1024 * 1024;
    let main = file;
    if (big) { const [w, h2] = scaleTo(2400); main = await toBlob(w, h2, 0.9); }
    const [rw, rh] = scaleTo(1280);
    const ref = await toBlob(rw, rh, 0.85);
    bmp.close && bmp.close();
    return { main, ref };
  }

  // 파일 한 장을 올려 asset id 를 돌려준다(사진 입력·이미지 교체 공용).
  DPA.uploadImage = async function (file) {
    const { main, ref } = await prepareImage(file);
    const pid = DPA.project.id;
    const r = await api('POST', `/api/projects/${pid}/assets`, main);
    try { await api('PUT', `/api/projects/${pid}/assets/${r.id}/ref`, ref); } catch { /* 참고용이 없으면 원본을 쓴다 */ }
    return r.id;
  };

  async function addPhotos(files) {
    files = Array.from(files || []);
    const room = S.LIMITS.photos - DPA.project.photos.length;
    if (!files.length) return;
    if (room <= 0) { toast('상품 사진은 최대 5장까지 올릴 수 있습니다.', 'warn'); return; }
    if (files.length > room) toast(`최대 5장까지라 ${room}장만 올립니다.`, 'warn');
    for (const f of files.slice(0, room)) {
      try {
        const aid = await DPA.uploadImage(f);
        DPA.mutate((p) => { p.photos.push({ assetId: aid, name: f.name.slice(0, 120) }); }, null, 'photos');
        renderPhotos();
      } catch (e) { toast(DPA.errMsg(e), 'err'); }
    }
  }

  function renderPhotos() {
    const grid = $('#photoGrid');
    grid.replaceChildren();
    DPA.project.photos.forEach((ph, i) => {
      grid.append(h('div', { class: 'ph' },
        h('img', { src: DPA.assetUrl(ph.assetId, true), alt: `상품 사진 ${i + 1}` }),
        h('button', { class: 'ph-x', 'aria-label': `사진 ${i + 1} 삭제`, text: '×', onclick: async () => {
          const ok = await DPA.confirm('이 사진을 입력 목록에서 뺄까요?\n이미 상세페이지에 들어간 이미지는 그대로 남고, 이후 AI 생성에서만 제외됩니다.', { okText: '빼기' });
          if (!ok) return;
          DPA.mutate((p) => { p.photos.splice(i, 1); }, null, 'photos'); renderPhotos();
        } })));
    });
    if (DPA.project.photos.length < S.LIMITS.photos) {
      const input = h('input', { type: 'file', accept: TYPES.join(','), multiple: true, hidden: true, 'aria-label': '상품 사진 선택', onchange: (e) => { addPhotos(e.target.files); e.target.value = ''; } });
      grid.append(h('button', { class: 'ph add', type: 'button', onclick: () => input.click() }, h('span', { text: '＋' }), h('small', { text: '사진 추가' })), input);
    }
    $('#photoCount').textContent = `${DPA.project.photos.length}/${S.LIMITS.photos}`;
  }

  function bindDrop() {
    const g = $('#photoGrid');
    ['dragenter', 'dragover'].forEach((ev) => g.addEventListener(ev, (e) => { e.preventDefault(); g.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => g.addEventListener(ev, (e) => { e.preventDefault(); g.classList.remove('drag'); }));
    g.addEventListener('drop', (e) => addPhotos(e.dataTransfer.files));
  }

  // ───────────── 버튼 진행 표시 ─────────────
  const running = {};
  async function withBusy(key, btn, label, fn) {
    if (running[key]) { running[key].abort(); return; }
    const ctrl = new AbortController();
    running[key] = ctrl;
    const old = btn.textContent;
    btn.textContent = label + ' (취소)'; btn.classList.add('busy');
    try { return await fn(ctrl.signal); } finally { delete running[key]; btn.textContent = old; btn.classList.remove('busy'); }
  }

  const prodPayload = () => ({ projectId: DPA.project.id, product: DPA.project.product, photoAssetIds: DPA.project.photos.map((x) => x.assetId), mode: DPA.project.mode });

  // ───────────── AI로 정리 ─────────────
  let organizeSeq = 0;
  async function organize() {
    const p = DPA.project.product;
    if (!p.name.trim() && !p.description.trim()) { toast('상품명이나 상품 설명을 먼저 입력해 주세요.', 'warn'); $('#fName').focus(); return; }
    if (!(await DPA.ensureAi())) return;
    const snap = { name: p.name, description: p.description, seq: ++organizeSeq };
    await withBusy('organize', $('#btnOrganize'), '정리 중', async (signal) => {
      let r;
      try { r = await api('POST', '/api/ai/organize', prodPayload(), { signal }); } catch (e) {
        if (e.code === 'cancelled') { toast('정리를 취소했습니다.', 'info'); return; }
        toast(DPA.errMsg(e) + ' ' + DPA.errorHint(e), 'err'); return;
      }
      const cur = DPA.project.product;
      if (snap.seq !== organizeSeq || cur.name !== snap.name || cur.description !== snap.description) {
        toast('정리하는 동안 상품명이나 설명이 바뀌어 결과를 적용하지 않았습니다. 다시 정리해 주세요.', 'warn');
        return;
      }
      showOrganizeResult(r, snap);
    });
  }

  function showOrganizeResult(r, snap) {
    const area = h('textarea', { rows: 16, class: 'mono', 'aria-label': '정리 결과 (직접 고칠 수 있습니다)' });
    area.value = r.text;
    const hadTarget = !!DPA.project.product.target.trim();
    const tgt = h('input', { 'aria-label': '타겟 고객 제안', value: r.target || '' });
    const useTarget = h('input', { type: 'checkbox', id: 'useTarget', checked: !hadTarget && !!r.target, disabled: !r.target });
    const m = modal({
      title: 'AI 정리 결과', wide: true,
      body: h('div', { class: 'stack' },
        h('p', { class: 'hint', text: '내용을 확인하고 필요하면 직접 고친 뒤 [적용]을 누르세요. 적용 후에도 [되돌리기]로 원래대로 돌릴 수 있습니다.' }),
        r.restoredFacts && r.restoredFacts.length ? h('p', { class: 'warn', text: `원문의 수치(${r.restoredFacts.join(', ')})가 정리 결과에서 빠져 ‘확인할 사항’에 원문 그대로 남겼습니다.` }) : null,
        area,
        h('div', { class: 'f' }, h('span', { text: '타겟 고객' }),
          r.target ? h('div', { class: 'stack sm' }, tgt, h('label', { class: 'chk' }, useTarget, h('span', { text: hadTarget ? '기존 타겟 고객을 AI 제안으로 바꿈' : 'AI 제안을 타겟 고객에 입력' }))) : h('p', { class: 'hint', text: 'AI가 고객층을 제안하지 않아 기존 입력을 그대로 둡니다.' }))),
      actions: [
        h('button', { class: 'btn', text: '취소', onclick: () => m.close() }),
        h('button', { class: 'btn primary', text: '적용', onclick: () => {
          const cur = DPA.project.product;
          if (cur.name !== snap.name || cur.description !== snap.description) { toast('그사이 입력이 바뀌어 적용하지 않았습니다.', 'warn'); m.close(); return; }
          const text = area.value.trim();
          if (!text) { toast('적용할 내용이 비어 있습니다.', 'warn'); return; }
          DPA.mutate((pr) => {
            pr.product.description = text;
            if (r.target && useTarget.checked && tgt.value.trim()) pr.product.target = tgt.value.trim().slice(0, 1000);
          }, null, 'product');
          DPA.fillForm();
          $('#descHint').replaceChildren('AI 정리를 적용했습니다. ', h('button', { class: 'link', text: '되돌리기', onclick: () => DPA.undo() }));
          toast('정리 결과를 적용했습니다.', 'ok');
          m.close();
        } }),
      ],
    });
  }

  // ───────────── 정보 검색 / 사진 분석 ─────────────
  async function research(kind) {
    const p = DPA.project.product;
    if (kind === 'web' && !p.name.trim()) { toast('검색할 상품명을 먼저 입력해 주세요.', 'warn'); $('#fName').focus(); return; }
    if (kind === 'photos' && !DPA.project.photos.length) { toast('분석할 상품 사진을 먼저 올려 주세요.', 'warn'); return; }
    if (!(await DPA.ensureAi())) return;
    const btn = kind === 'web' ? $('#btnSearch') : $('#btnPhoto');
    const snapName = p.name;
    await withBusy('research-' + kind, btn, kind === 'web' ? '검색 중' : '분석 중', async (signal) => {
      let r;
      try { r = await api('POST', '/api/ai/research', { ...prodPayload(), kind }, { signal }); } catch (e) {
        if (e.code === 'cancelled') return;
        toast(DPA.errMsg(e) + ' ' + DPA.errorHint(e), 'err'); return;
      }
      if (DPA.project.product.name !== snapName) toast('검색하는 동안 상품명이 바뀌었습니다. 결과가 현재 상품과 다를 수 있습니다.', 'warn');
      showResearch(r);
    });
  }

  function showResearch(r) {
    const srcList = r.sources && r.sources.length
      ? h('ul', { class: 'bul' }, r.sources.map((s) => {
        let ok = false;
        try { ok = new URL(s.uri).protocol === 'https:'; } catch { /* 잘못된 주소 */ }
        return h('li', {}, ok ? h('a', { href: s.uri, target: '_blank', rel: 'noopener noreferrer', text: s.title || s.uri }) : h('span', { text: s.title || s.uri }));
      }))
      : (r.kind === 'web' ? h('p', { class: 'warn', text: '검색 출처를 확인하지 못했습니다.' }) : null);
    const m = modal({
      title: r.kind === 'web' ? '상품 정보 검색 결과' : '사진 분석 결과', wide: true,
      body: h('div', { class: 'stack' },
        h('p', { class: 'hint', text: r.note }),
        h('div', { class: 'resbox pre', text: r.summary }),
        r.kind === 'web' ? h('div', {}, h('h4', { text: '출처' }), srcList) : null),
      actions: [
        h('button', { class: 'btn', text: '닫기', onclick: () => m.close() }),
        h('button', { class: 'btn primary', text: '상품 설명 끝에 추가', onclick: () => {
          const tail = `\n\n[참고 자료 — ${r.kind === 'web' ? '웹 검색' : '사진 분석'}]\n${r.summary}` + (r.sources && r.sources.length ? '\n출처: ' + r.sources.map((s) => s.uri).join(' , ') : '');
          DPA.mutate((pr) => { pr.product.description = (pr.product.description + tail).slice(0, 12000); }, null, 'product');
          DPA.fillForm();
          toast('상품 설명 끝에 추가했습니다. 사실 여부를 확인하고 필요 없는 내용은 지워 주세요.', 'ok');
          m.close();
        } }),
      ],
    });
  }

  DPA.initProduct = function () {
    bindForm(); bindDrop();
    $('#btnOrganize').addEventListener('click', organize);
    $('#btnSearch').addEventListener('click', () => research('web'));
    $('#btnPhoto').addEventListener('click', () => research('photos'));
    DPA.on('restored', () => { DPA.fillForm(); });
  };
  DPA.renderPhotos = renderPhotos;
})();
