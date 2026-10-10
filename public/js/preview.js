/* DETAIL PAGE AI — 미리보기, 블록·이미지 편집, AI 생성 진행. by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { S, h, $, toast, modal, api } = DPA;
  const R = window.DPA_RENDER;

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const findBlock = (id) => DPA.project.blocks.find((b) => b.id === id);
  const findSlot = (sid) => { for (const b of DPA.project.blocks) { const s = b.images.find((x) => x.id === sid); if (s) return { block: b, slot: s }; } return null; };
  const SOURCE_LABEL = { ai: 'AI 생성', photo: '원본 사진', user: '내 사진', none: '비어 있음' };

  // ───────────── 렌더 큐 ─────────────
  const dirty = new Set();
  let rafId = 0;
  function queuePaint(id) {
    dirty.add(id);
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; const ids = [...dirty]; dirty.clear(); ids.forEach(paintBlock); updateSummary(); });
  }
  const paintAll = () => DPA.project.blocks.forEach((b) => queuePaint(b.id));

  function renderOpts() {
    return { brief: DPA.project.brief, getImage: DPA.getImage, scale: dpr(), preview: true, pending: DPA.rt.pending };
  }

  function paintBlock(id) {
    const b = findBlock(id);
    const card = $(`[data-bid="${id}"]`, $('#pageList'));
    if (!b || !card) return;
    const cv = $('.cv', card);
    if (b.hidden) { cv.replaceChildren(); return; }
    const { canvas } = R.renderBlock(b, renderOpts());
    if (!canvas) { cv.replaceChildren(h('div', { class: 'blk-empty', text: '내용이 비어 있어 저장본에서는 빠집니다. [수정]에서 내용을 입력하거나 숨겨 두세요.' })); return; }
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${S.LABELS[b.type]} 미리보기`);
    cv.replaceChildren(canvas);
  }

  // ───────────── 블록 목록 ─────────────
  function moveBlock(id, dir) {
    DPA.mutate((p) => {
      const i = p.blocks.findIndex((b) => b.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= p.blocks.length) return;
      [p.blocks[i], p.blocks[j]] = [p.blocks[j], p.blocks[i]];
    }, null, 'blocks');
  }
  function toggleHidden(id) {
    DPA.mutate((p) => { const b = p.blocks.find((x) => x.id === id); if (b) b.hidden = !b.hidden; }, null, 'blocks');
  }

  function cardFor(b, idx, total) {
    const label = S.LABELS[b.type];
    const hiddenRow = h('div', { class: 'blk-hidden' }, h('span', { text: `숨김 · ${label}` }), h('button', { class: 'btn sm', text: '복원', onclick: () => toggleHidden(b.id) }));
    const bar = h('div', { class: 'blk-bar' },
      h('span', { class: 'blk-no', text: String(idx + 1).padStart(2, '0') }),
      h('b', { class: 'blk-name', text: label }),
      h('span', { class: 'blk-ctl' },
        h('button', { class: 'btn sm icon', 'aria-label': `${label} 위로`, text: '▲', disabled: idx === 0, onclick: () => moveBlock(b.id, -1) }),
        h('button', { class: 'btn sm icon', 'aria-label': `${label} 아래로`, text: '▼', disabled: idx === total - 1, onclick: () => moveBlock(b.id, 1) }),
        h('button', { class: 'btn sm', text: '수정', onclick: () => openDrawer(b.id) }),
        h('button', { class: 'btn sm', text: '숨기기', onclick: () => toggleHidden(b.id) })));
    return h('article', { class: 'blk' + (b.hidden ? ' is-hidden' : ''), dataset: { bid: b.id } }, b.hidden ? hiddenRow : bar, h('div', { class: 'cv' }));
  }

  function renderList() {
    const list = $('#pageList');
    const blocks = DPA.project.blocks;
    $('#emptyState').hidden = blocks.length > 0;
    list.replaceChildren(...blocks.map((b, i) => cardFor(b, i, blocks.length)));
    paintAll();
    updateSummary();
  }

  function updateSummary() {
    const vis = DPA.visibleBlocks();
    const imgs = vis.reduce((n, b) => n + b.images.filter(DPA.slotVisible).length, 0);
    const el = $('#pageSummary');
    if (el) el.textContent = DPA.project.blocks.length ? `보이는 블록 ${vis.length}개 · 사용 이미지 ${imgs}장` : '';
  }

  // ───────────── 편집 서랍 ─────────────
  const FORMS = {
    info: [{ k: 'eyebrow', l: '분류(작은 글씨)' }, { k: 'title', l: '상품명' }, { k: 'subtitle', l: '한 줄 소개', area: 3 }, { k: 'rows', l: '핵심 정보', pairs: ['label', 'value'], pl: ['항목', '내용'], max: S.LIMITS.rows }],
    promo: [{ k: 'badge', l: '배지' }, { k: 'title', l: '제목' }, { k: 'desc', l: '설명', area: 3 }],
    hero: [{ k: 'title', l: '대표 문구' }, { k: 'subtitle', l: '보조 문구', area: 3 }],
    headline: [{ k: 'kicker', l: '작은 제목' }, { k: 'title', l: '큰 제목', area: 3 }, { k: 'points', l: '고객 고민', strings: true, max: S.LIMITS.points }],
    mood: [{ k: 'title', l: '제목' }, { k: 'text', l: '문장', area: 5 }],
    intro: [{ k: 'title', l: '제목' }, { k: 'body', l: '본문', area: 9 }],
    features: [{ k: 'title', l: '제목' }, { k: 'items', l: '주요 특징', pairs: ['title', 'desc'], pl: ['특징', '설명'], max: S.LIMITS.items }],
    gallery: [{ k: 'title', l: '제목' }, { k: 'caption', l: '설명', area: 3 }],
    usage: [{ k: 'title', l: '제목' }, { k: 'steps', l: '사용 순서', pairs: ['title', 'desc'], pl: ['단계', '설명'], max: S.LIMITS.steps }],
    detail: [{ k: 'title', l: '제목' }, { k: 'items', l: '디테일 설명', pairs: ['title', 'desc'], pl: ['항목', '설명'], max: 4 }],
    faq: [{ k: 'title', l: 'FAQ 제목' }, { k: 'faqs', l: '자주 묻는 질문', pairs: ['q', 'a'], pl: ['질문', '답변'], max: S.LIMITS.faqs }, { k: 'specTitle', l: '규격 제목' }, { k: 'specs', l: '규격', pairs: ['label', 'value'], pl: ['항목', '내용'], max: S.LIMITS.specs }],
    cta: [{ k: 'title', l: '제목' }, { k: 'desc', l: '설명', area: 2 }, { k: 'buttonLabel', l: '버튼 문구' }, { k: 'buttonUrl', l: '구매 링크(선택)', url: true }],
  };

  let drawerId = null;
  const setField = (id, k, v) => DPA.mutate((p) => { const b = p.blocks.find((x) => x.id === id); if (b) b.fields[k] = v; }, `blk:${id}:${k}`, 'block:' + id);

  function fieldEditor(b, spec) {
    const id = b.id;
    const cur = () => findBlock(id).fields;
    if (spec.pairs || spec.strings) {
      const wrap = h('div', { class: 'f' });
      const draw = () => {
        const arr = cur()[spec.k] || [];
        wrap.replaceChildren(h('span', { text: spec.l }));
        arr.forEach((item, i) => {
          const row = h('div', { class: 'pair' });
          if (spec.strings) {
            row.append(h('textarea', { rows: 2, value: item, 'aria-label': `${spec.l} ${i + 1}`, oninput: (e) => DPA.mutate((p) => { p.blocks.find((x) => x.id === id).fields[spec.k][i] = e.target.value; }, `blk:${id}:${spec.k}:${i}`, 'block:' + id) }));
          } else {
            row.append(
              h('input', { value: item[spec.pairs[0]] || '', placeholder: spec.pl[0], 'aria-label': `${spec.pl[0]} ${i + 1}`, oninput: (e) => DPA.mutate((p) => { p.blocks.find((x) => x.id === id).fields[spec.k][i][spec.pairs[0]] = e.target.value; }, `blk:${id}:${spec.k}:${i}:0`, 'block:' + id) }),
              h('textarea', { rows: 2, value: item[spec.pairs[1]] || '', placeholder: spec.pl[1], 'aria-label': `${spec.pl[1]} ${i + 1}`, oninput: (e) => DPA.mutate((p) => { p.blocks.find((x) => x.id === id).fields[spec.k][i][spec.pairs[1]] = e.target.value; }, `blk:${id}:${spec.k}:${i}:1`, 'block:' + id) }));
          }
          row.append(h('button', { class: 'btn sm icon', 'aria-label': `${i + 1}번 항목 삭제`, text: '×', onclick: () => { DPA.mutate((p) => { p.blocks.find((x) => x.id === id).fields[spec.k].splice(i, 1); }, null, 'block:' + id); draw(); } }));
          wrap.append(row);
        });
        if (arr.length < spec.max) {
          wrap.append(h('button', { class: 'btn sm', text: '＋ 항목 추가', onclick: () => {
            DPA.mutate((p) => { const f = p.blocks.find((x) => x.id === id).fields; f[spec.k] = f[spec.k] || []; f[spec.k].push(spec.strings ? '' : { [spec.pairs[0]]: '', [spec.pairs[1]]: '' }); }, null, 'block:' + id);
            draw();
          } }));
        }
      };
      draw();
      return wrap;
    }
    const val = cur()[spec.k] || '';
    const input = spec.area
      ? h('textarea', { rows: spec.area, value: val, oninput: (e) => setField(id, spec.k, e.target.value) })
      : h('input', { value: val, type: spec.url ? 'url' : 'text', placeholder: spec.url ? 'https://' : '', oninput: (e) => setField(id, spec.k, e.target.value) });
    return h('label', { class: 'f' }, h('span', { text: spec.l }), input);
  }

  function slotRow(b, s, n) {
    const status = s.deleted ? '삭제됨' : (DPA.rt.pending.has(s.id) ? '생성 중…' : SOURCE_LABEL[s.assetId ? s.source : 'none'] || '');
    const thumb = s.assetId ? h('img', { src: DPA.assetUrl(s.assetId, true), alt: `이미지 ${n}` }) : h('div', { class: 'thumb-empty', text: '없음' });
    const busy = DPA.rt.pending.has(s.id);
    const btns = s.deleted
      ? [h('button', { class: 'btn sm', text: '복원', onclick: () => { DPA.mutate((p) => { findSlotIn(p, s.id).deleted = false; }, null, 'block:' + b.id); redrawDrawer(); } })]
      : [
        h('button', { class: 'btn sm', text: '사진으로 교체', disabled: busy, onclick: () => pickImage(b.id, s.id) }),
        s.assetId ? h('button', { class: 'btn sm ai', text: 'AI 수정', disabled: busy, onclick: () => aiImage(b.id, s.id, true) }) : h('button', { class: 'btn sm ai', text: 'AI로 만들기', disabled: busy, onclick: () => aiImage(b.id, s.id, false) }),
        s.assetId ? h('button', { class: 'btn sm', text: '다시 생성', disabled: busy, onclick: () => aiImage(b.id, s.id, false, true) }) : null,
        s.assetId ? h('button', { class: 'btn sm danger-o', text: '삭제', onclick: () => { DPA.mutate((p) => { findSlotIn(p, s.id).deleted = true; }, null, 'block:' + b.id); redrawDrawer(); } }) : null,
      ];
    return h('div', { class: 'slot' + (s.deleted ? ' off' : '') }, h('div', { class: 'thumb' }, thumb),
      h('div', { class: 'slot-i' }, h('b', { text: `이미지 ${n}` }), h('span', { class: 'chip', text: status }), h('div', { class: 'slot-b' }, btns)));
  }
  const findSlotIn = (p, sid) => { for (const b of p.blocks) { const s = b.images.find((x) => x.id === sid); if (s) return s; } return null; };

  function openDrawer(id) {
    const b = findBlock(id);
    if (!b) return;
    drawerId = id;
    const dr = $('#drawer');
    dr.hidden = false;
    document.body.classList.add('drawer-open');
    redrawDrawer();
    dr.querySelector('.dr-body').scrollTop = 0;
    const first = dr.querySelector('input,textarea');
    if (first && window.innerWidth > 900) first.focus();
  }
  function closeDrawer() {
    drawerId = null;
    $('#drawer').hidden = true;
    document.body.classList.remove('drawer-open');
  }
  function redrawDrawer() {
    if (!drawerId) return;
    const b = findBlock(drawerId);
    if (!b) { closeDrawer(); return; }
    const body = $('#drawer .dr-body');
    const top = body.scrollTop;
    $('#drawer .dr-title').textContent = S.LABELS[b.type];
    const aiIn = h('input', { placeholder: '예) 더 짧고 담백하게 / 20대 여성 톤으로', 'aria-label': 'AI 문구 수정 요청' });
    const aiBtn = h('button', { class: 'btn ai', text: 'AI로 고치기', onclick: () => aiText(b.id, aiIn, aiBtn) });
    aiIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') aiBtn.click(); });
    const imgs = b.images;
    body.replaceChildren(
      h('section', { class: 'dr-sec' }, h('h4', { text: '문구' }), ...(FORMS[b.type] || []).map((sp) => fieldEditor(b, sp))),
      h('section', { class: 'dr-sec' }, h('h4', { text: 'AI 문구 수정' }), h('div', { class: 'row' }, aiIn, aiBtn),
        h('p', { class: 'hint', text: 'AI 연결이 필요합니다. 직접 수정·순서 변경·숨김·사진 교체는 연결 없이 쓸 수 있습니다.' })),
      imgs.length ? h('section', { class: 'dr-sec' }, h('h4', { text: '이미지' }), ...imgs.map((s, i) => slotRow(b, s, i + 1))) : null,
      h('section', { class: 'dr-sec row-end' }, h('button', { class: 'btn', text: b.hidden ? '블록 복원' : '이 블록 숨기기', onclick: () => { toggleHidden(b.id); redrawDrawer(); } })));
    body.scrollTop = top;
  }

  // ───────────── 이미지 교체 ─────────────
  function pickImage(bid, sid) {
    const photos = DPA.project.photos;
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const aid = await DPA.uploadImage(f);
        applyReplace(bid, sid, aid, 'user'); m.close();
      } catch (er) { toast(DPA.errMsg(er), 'err'); }
    } });
    const m = modal({
      title: '이미지 교체',
      body: h('div', { class: 'stack' },
        h('button', { class: 'btn primary wide', text: '내 컴퓨터에서 사진 선택', onclick: () => file.click() }), file,
        h('p', { class: 'hint', text: 'JPG, PNG, WEBP · 10MB 이하' }),
        photos.length ? h('div', {}, h('h4', { text: '입력해 둔 상품 사진에서 고르기' }),
          h('div', { class: 'photos pick' }, photos.map((ph, i) => h('button', { class: 'ph', type: 'button', 'aria-label': `상품 사진 ${i + 1} 사용`, onclick: () => { applyReplace(bid, sid, ph.assetId, 'photo'); m.close(); } }, h('img', { src: DPA.assetUrl(ph.assetId, true), alt: '' }))))) : null),
    });
  }
  function applyReplace(bid, sid, aid, source) {
    DPA.mutate((p) => { const s = findSlotIn(p, sid); if (s) { s.assetId = aid; s.source = source; s.deleted = false; } }, null, 'block:' + bid);
    redrawDrawer();
    toast('이미지를 교체했습니다.', 'ok');
  }

  // ───────────── AI: 문구·이미지 수정 ─────────────
  async function aiText(bid, input, btn) {
    const ins = input.value.trim();
    if (!ins) { toast('어떻게 고칠지 입력해 주세요.', 'warn'); input.focus(); return; }
    if (!(await DPA.ensureAi())) return;
    const b = findBlock(bid);
    const before = JSON.stringify(b.fields);
    btn.disabled = true; const old = btn.textContent; btn.textContent = '고치는 중…';
    try {
      const r = await api('POST', '/api/ai/edit-text', { type: b.type, fields: b.fields, instruction: ins, product: DPA.project.product, brief: DPA.project.brief, mode: DPA.project.mode });
      const nb = findBlock(bid);
      if (!nb) return;
      if (JSON.stringify(nb.fields) !== before) { toast('고치는 동안 문구를 직접 수정하셔서 AI 결과를 적용하지 않았습니다.', 'warn'); return; }
      DPA.mutate((p) => { p.blocks.find((x) => x.id === bid).fields = r.fields; }, null, 'block:' + bid);
      input.value = '';
      redrawDrawer();
      toast('문구를 고쳤습니다. 마음에 들지 않으면 되돌리기를 누르세요.', 'ok');
    } catch (e) { toast(DPA.errMsg(e) + ' ' + DPA.errorHint(e), 'err'); } finally { btn.disabled = false; btn.textContent = old; }
  }

  function aiImage(bid, sid, edit, regen) {
    const b = findBlock(bid), s = b && b.images.find((x) => x.id === sid);
    if (!s) return;
    const start = async (instruction) => {
      if (!(await DPA.ensureAi())) return;
      const guard = s.assetId;
      DPA.rt.pending.add(sid); queuePaint(bid); redrawDrawer();
      try {
        const r = await api('POST', '/api/ai/images', {
          projectId: DPA.project.id, product: DPA.project.product, brief: DPA.project.brief, photoAssetIds: DPA.project.photos.map((x) => x.assetId), mode: DPA.project.mode,
          items: [{ slotId: sid, prompt: s.prompt, aspect: s.aspect, baseAssetId: edit ? s.assetId : null, instruction }],
        });
        const v = await DPA.pollJob(r.jobId, () => {});
        const res = v.images[sid];
        if (res && res.status === 'done') {
          const cur = findSlot(sid);
          if (!cur || cur.slot.deleted || cur.slot.assetId !== guard) toast('만드는 동안 이미지가 바뀌어 결과를 적용하지 않았습니다.', 'warn');
          else { DPA.mutate((p) => { const x = findSlotIn(p, sid); x.assetId = res.assetId; x.source = 'ai'; }, null, 'block:' + bid); toast('이미지를 새로 만들었습니다. 마음에 들지 않으면 되돌리기를 누르세요.', 'ok'); }
        } else {
          const er = (res && res.error) || v.error || {};
          toast((er.message || '이미지를 만들지 못했습니다.') + ' ' + DPA.errorHint(er) + ' 기존 이미지는 그대로입니다.', 'err');
        }
      } catch (e) { toast(DPA.errMsg(e) + ' ' + DPA.errorHint(e), 'err'); } finally { DPA.rt.pending.delete(sid); queuePaint(bid); redrawDrawer(); }
    };
    if (regen) { start(''); return; }
    const ta = h('textarea', { rows: 3, placeholder: edit ? '예) 배경을 밝은 나무 테이블로 바꿔줘' : '예) 아침 햇살이 드는 주방에서 사용하는 장면', 'aria-label': '이미지 요청' });
    if (!edit && s.prompt) ta.value = '';
    const m = modal({
      title: edit ? 'AI로 이미지 수정' : 'AI로 이미지 만들기',
      body: h('div', { class: 'stack' }, h('p', { class: 'hint', text: edit ? '현재 이미지를 바탕으로 요청한 부분만 바꿉니다. 상품의 형태·포장·로고는 유지하도록 요청합니다.' : '상품 사진을 참고해 장면을 만듭니다.' }), ta),
      actions: [h('button', { class: 'btn', text: '취소', onclick: () => m.close() }), h('button', { class: 'btn primary', text: '시작', onclick: () => { const v = ta.value.trim(); if (edit && !v) { toast('수정할 내용을 입력해 주세요.', 'warn'); return; } m.close(); start(v); } })],
    });
    setTimeout(() => ta.focus(), 50);
  }

  // ───────────── AI 상세페이지 생성 ─────────────
  let genJob = null;
  const genUI = () => $('#genStatus');

  function countImages() {
    return S.buildBlocks(DPA.project.product, []).blocks.filter((x) => !(x.type === 'promo' && !DPA.project.product.promo)).reduce((n, b) => n + b.images.length, 0);
  }

  async function startGenerate() {
    const pr = DPA.project;
    if (genJob) { toast('이미 생성 중입니다.', 'warn'); return; }
    if (!pr.product.name.trim()) { toast('상품명을 입력해 주세요.', 'warn'); $('#fName').focus(); return; }
    const hasWork = pr.blocks.length > 0;
    const withImages = $('#optImages').checked;
    if (!DPA.rt.connected && !(await DPA.openConnect())) return;
    const m = DPA.rt.models || {};
    const mode = pr.mode;
    const n = withImages ? countImages() : 0;
    const extra = [
      `문구 구성 1회${withImages ? ` + 이미지 최대 ${n}회` : ' (이미지는 만들지 않음)'} 호출합니다.`,
      `사용 모델 — 문구: ${(m.text && m.text[mode]) || '-'}${withImages ? ` / 이미지: ${(m.image && m.image[mode]) || '없음'}` : ''}${mode === 'high' ? ' (고품질)' : ''}`,
      pr.photos.length ? `상품 사진 ${pr.photos.length}장이 참고 자료로 전송됩니다.` : '상품 사진이 없어 상품의 실제 모습을 그대로 반영하기 어렵습니다.',
    ];
    if (withImages && !(m.image && m.image[mode])) { toast('이 키로는 이미지 모델을 찾지 못했습니다. [이미지도 함께 만들기]를 끄고 진행해 주세요.', 'warn'); return; }
    if (hasWork && !(await DPA.confirm('현재 편집 중인 상세페이지가 AI 결과로 교체됩니다.\n[되돌리기]로 이전 상태를 복구할 수 있습니다.', { okText: '계속' }))) return;
    if (!(await DPA.ensureAi({ alwaysConfirm: true, title: '생성 전 확인', okText: '동의하고 생성', extra }))) return;

    const guardName = pr.product.name;
    genJob = { cancelled: false, applied: new Set(), planApplied: false, jobId: null, total: 0, failed: [], snap: { name: pr.product.name, description: pr.product.description } };
    DPA.emit('gen-state');
    showGenStatus({ phase: 'plan', done: 0, total: 0 });
    $('.tab[data-tab=preview]').click();
    try {
      const r = await api('POST', '/api/ai/generate', { projectId: pr.id, product: pr.product, photoAssetIds: pr.photos.map((x) => x.assetId), mode, withImages });
      genJob.jobId = r.jobId;
      const v = await DPA.pollJob(r.jobId, (view) => applyGenView(view), genJob);
      applyGenView(v);
      finishGen(v, guardName);
    } catch (e) {
      toast(DPA.errMsg(e) + ' ' + DPA.errorHint(e), 'err');
      showGenStatus({ error: DPA.errMsg(e) });
    } finally { genJob = null; DPA.rt.pending.clear(); DPA.emit('gen-state'); paintAll(); }
  }

  function applyGenView(v) {
    if (!genJob) return;
    if (v.plan && !genJob.planApplied) {
      const cur = DPA.project.product;
      if (cur.name !== genJob.snap.name || cur.description !== genJob.snap.description) {
        // 생성하는 동안 상품 정보가 바뀌었으면 이전 요청의 결과를 적용하지 않는다.
        genJob.planApplied = true; genJob.stale = true; genJob.cancelled = true;
        if (genJob.jobId) api('DELETE', `/api/jobs/${genJob.jobId}`).catch(() => {});
        toast('생성하는 동안 상품명이나 설명이 바뀌어 결과를 적용하지 않았습니다. 다시 생성해 주세요.', 'warn');
        showGenStatus({ finished: true, failed: [], status: 'cancelled' });
        return;
      }
      genJob.planApplied = true;
      DPA.mutate((p) => {
        // 입력한 사진은 유지하고, 구성·색감만 AI 결과로 바꾼다.
        p.blocks = v.plan.blocks.map((b) => S.sanitizeBlock(b)).filter(Boolean);
        p.brief = S.sanitizeBrief(v.plan.brief, p.product);
      }, null, 'all');
      renderList();
      if (drawerId) closeDrawer();
    }
    if (genJob.stale) return;
    const pend = new Set();
    let done = 0, total = 0;
    for (const [sid, r] of Object.entries(v.images || {})) {
      total += 1;
      if (r.status === 'queued' || r.status === 'running') pend.add(sid);
      if (r.status === 'done') {
        done += 1;
        if (!genJob.applied.has(sid)) {
          genJob.applied.add(sid);
          const hit = findSlot(sid);
          if (hit && !hit.slot.deleted) { hit.slot.assetId = r.assetId; hit.slot.source = 'ai'; DPA.touch('block:' + hit.block.id); queuePaint(hit.block.id); }
        }
      }
    }
    DPA.rt.pending.clear(); pend.forEach((x) => DPA.rt.pending.add(x));
    genJob.total = total;
    paintAll();
    showGenStatus({ phase: v.phase, done, total, status: v.status });
  }

  function finishGen(v) {
    if (v.status === 'error') {
      const er = v.error || {};
      showGenStatus({ error: (er.message || '생성에 실패했습니다.') + ' ' + DPA.errorHint(er), retryAll: true });
      toast((er.message || '생성에 실패했습니다.') + ' 입력한 내용은 그대로 보존되어 있습니다.', 'err');
      return;
    }
    const failed = Object.entries(v.images || {}).filter(([, r]) => r.status === 'error' || r.status === 'skipped' || r.status === 'cancelled');
    DPA.rt.lastFailed = failed.map(([sid, r]) => ({ sid, message: (r.error && r.error.message) || (r.status === 'cancelled' ? '취소됨' : '') }));
    if (genJob && genJob.stale) return;
    if (v.status === 'cancelled') toast('생성을 취소했습니다. 완료된 부분은 보존했습니다.', 'info');
    else if (failed.length) toast(`이미지 ${failed.length}장을 만들지 못했습니다. 아래에서 다시 시도할 수 있습니다.`, 'warn');
    else toast('상세페이지를 만들었습니다. 블록별로 확인하고 수정해 보세요.', 'ok');
    showGenStatus({ finished: true, failed: DPA.rt.lastFailed, status: v.status });
  }

  function showGenStatus(s) {
    const box = genUI();
    if (!box) return;
    box.hidden = false;
    box.replaceChildren();
    if (s.error) {
      box.append(h('div', { class: 'gen err' }, h('b', { text: '생성하지 못했습니다' }), h('p', { text: s.error }), h('button', { class: 'btn sm', text: '닫기', onclick: () => { box.hidden = true; } })));
      return;
    }
    if (s.finished) {
      const f = s.failed || [];
      box.append(h('div', { class: 'gen' + (f.length ? ' warn' : ' ok') },
        h('b', { text: s.status === 'cancelled' ? '생성을 취소했습니다' : f.length ? `완료 · 이미지 ${f.length}장 실패` : '생성이 끝났습니다' }),
        f.length ? h('p', { text: f[0].message || '다시 시도해 주세요.' }) : null,
        h('div', { class: 'row' },
          f.length ? h('button', { class: 'btn sm primary', text: '실패한 이미지 다시 시도', onclick: retryFailed }) : null,
          h('button', { class: 'btn sm', text: '닫기', onclick: () => { box.hidden = true; } }))));
      return;
    }
    const label = s.phase === 'plan' ? '문구와 구성을 만드는 중…' : `이미지 만드는 중 ${s.done}/${s.total}`;
    const pct = s.phase === 'plan' ? 8 : Math.max(8, Math.round((s.done / Math.max(1, s.total)) * 100));
    box.append(h('div', { class: 'gen' }, h('b', { text: 'AI 생성 중' }), h('span', { text: label }), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
      h('button', { class: 'btn sm', text: '취소', onclick: () => { if (genJob) { genJob.cancelled = true; if (genJob.jobId) api('DELETE', `/api/jobs/${genJob.jobId}`).catch(() => {}); } } })));
  }

  async function retryFailed() {
    const list = (DPA.rt.lastFailed || []).map((x) => x.sid).filter((sid) => findSlot(sid));
    if (!list.length) { genUI().hidden = true; return; }
    if (!(await DPA.ensureAi({ alwaysConfirm: true, title: '다시 시도 전 확인', okText: '동의하고 진행', extra: [`이미지 ${list.length}장을 다시 요청합니다.`] }))) return;
    list.forEach((sid) => DPA.rt.pending.add(sid)); paintAll();
    genUI().hidden = true;
    try {
      const items = list.map((sid) => { const { slot } = findSlot(sid); return { slotId: sid, prompt: slot.prompt, aspect: slot.aspect, baseAssetId: null, instruction: '' }; });
      const r = await api('POST', '/api/ai/images', { projectId: DPA.project.id, product: DPA.project.product, brief: DPA.project.brief, photoAssetIds: DPA.project.photos.map((x) => x.assetId), mode: DPA.project.mode, items });
      const v = await DPA.pollJob(r.jobId, () => {});
      let ok = 0;
      const still = [];
      for (const sid of list) {
        const res = v.images[sid];
        const hit = findSlot(sid);
        if (res && res.status === 'done' && hit && !hit.slot.deleted) { hit.slot.assetId = res.assetId; hit.slot.source = 'ai'; DPA.touch('block:' + hit.block.id); ok += 1; } else still.push({ sid, message: (res && res.error && res.error.message) || '' });
      }
      DPA.rt.lastFailed = still;
      toast(`이미지 ${ok}장을 만들었습니다.${still.length ? ` ${still.length}장은 아직 실패했습니다.` : ''}`, still.length ? 'warn' : 'ok');
      if (still.length) showGenStatus({ finished: true, failed: still, status: 'done' });
    } catch (e) { toast(DPA.errMsg(e), 'err'); } finally { list.forEach((sid) => DPA.rt.pending.delete(sid)); paintAll(); }
  }

  function makeBasic() {
    const pr = DPA.project;
    if (!pr.product.name.trim()) { toast('상품명을 입력해 주세요.', 'warn'); $('#fName').focus(); return; }
    const go = () => {
      DPA.mutate((p) => { const r = S.buildBlocks(p.product, p.photos, {}); p.blocks = r.blocks; p.brief = r.brief; }, null, 'all');
      renderList(); toast('입력한 내용으로 기본 구성을 만들었습니다. 블록별로 문구를 다듬어 보세요.', 'ok');
      $('.tab[data-tab=preview]').click();
    };
    if (pr.blocks.length) DPA.confirm('현재 편집 중인 상세페이지가 기본 구성으로 교체됩니다.\n[되돌리기]로 복구할 수 있습니다.', { okText: '교체' }).then((ok) => ok && go()); else go();
  }

  // ───────────── 색상 ─────────────
  function paletteModal() {
    const pr = DPA.project;
    const setPal = (pal) => { DPA.mutate((p) => { p.brief.palette = S.mergePalette(S.pickPalette(p.product), pal); }, null, 'brief'); paintAll(); };
    const sw = (pal) => h('button', { class: 'sw', type: 'button', 'aria-label': pal.id, style: `--a:${pal.accent};--b:${pal.bg};--c:${pal.accent2}`, onclick: () => setPal(pal) }, h('i'), h('i'), h('i'));
    const accent = h('input', { type: 'color', value: pr.brief.palette.accent, 'aria-label': '강조색', oninput: (e) => { DPA.mutate((p) => { p.brief.palette = S.mergePalette(p.brief.palette, { accent: e.target.value }); }, 'accent', 'brief'); paintAll(); } });
    const m = modal({
      title: '상세페이지 색상',
      body: h('div', { class: 'stack' }, h('p', { class: 'hint', text: '상세페이지 결과물의 색입니다. 프로그램 화면의 색과는 별개입니다.' }),
        h('div', { class: 'swatches' }, S.PALETTES.map((p) => { const { keys, ...pal } = p; void keys; return sw(pal); })),
        h('label', { class: 'f sm' }, h('span', { text: '강조색 직접 고르기' }), accent)),
      actions: [h('button', { class: 'btn primary', text: '완료', onclick: () => m.close() })],
    });
  }

  // ───────────── 초기화 ─────────────
  DPA.initPreview = function () {
    $('#btnUndo').addEventListener('click', DPA.undo);
    $('#btnRedo').addEventListener('click', DPA.redo);
    $('#btnPalette').addEventListener('click', paletteModal);
    $('#btnGenerate').addEventListener('click', startGenerate);
    $('#btnBasic').addEventListener('click', makeBasic);
    $('#drawer .dr-close').addEventListener('click', closeDrawer);
    $('#drawerScrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerId && !document.querySelector('dialog[open]')) closeDrawer();
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if ((e.ctrlKey || e.metaKey) && !/INPUT|TEXTAREA|SELECT/.test(tag) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) DPA.redo(); else DPA.undo(); }
    });
    DPA.on('changed', ({ scope }) => {
      if (scope === 'blocks') { renderList(); if (drawerId) redrawDrawer(); }
      else if (scope === 'all') { renderList(); if (drawerId) redrawDrawer(); }
      else if (scope === 'brief') paintAll();
      else if (scope && scope.startsWith('block:')) queuePaint(scope.slice(6));
    });
    DPA.on('restored', () => { renderList(); if (drawerId) redrawDrawer(); });
    DPA.on('image-loaded', ({ aid }) => {
      DPA.project.blocks.forEach((b) => { if (b.images.some((s) => s.assetId === aid)) queuePaint(b.id); });
    });
    DPA.on('undo-state', () => { $('#btnUndo').disabled = !DPA.canUndo(); $('#btnRedo').disabled = !DPA.canRedo(); });
    DPA.on('gen-state', () => { const on = !!genJob; $('#btnGenerate').disabled = on; $('#btnBasic').disabled = on; });
    DPA.on('save-state', ({ state, msg }) => {
      const el = $('#saveState');
      const map = { dirty: '변경됨…', saving: '저장 중…', saved: `자동 저장됨 ${DPA.fmtTime()}`, error: `저장 실패 — 다시 시도합니다 (${msg || ''})`, conflict: '다른 창에서 변경됨 — 새로고침이 필요합니다' };
      el.textContent = map[state] || '';
      el.dataset.state = state;
    });
  };

  DPA.loadPreview = function () {
    closeDrawer();
    renderList();
    DPA.emit('undo-state');
  };
  DPA.repaintAll = paintAll;
  DPA.afterFonts = () => paintAll();
})();
