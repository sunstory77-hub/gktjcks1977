/* DETAIL PAGE AI — 다국어: 언어 탭, 번역 실행, 번역 편집·검수 상태. by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { S, h, $, toast, modal, api } = DPA;

  const meta = (c) => S.LANG_BY[c] || { code: c, name: c, native: c };
  const findBlock = (id) => DPA.project.blocks.find((b) => b.id === id);
  const now = () => new Date().toISOString();
  const langClass = (c) => 'lang-' + c;

  // ───────────── 데이터 도우미 (mutate 안에서 사용) ─────────────
  function ensureLang(p, lang) {
    p.i18n = p.i18n || { langs: [], data: {}, glossary: [] };
    if (!p.i18n.langs.includes(lang)) p.i18n.langs.push(lang);
    p.i18n.data[lang] = p.i18n.data[lang] || { blocks: {}, imgs: {}, hidden: {}, market: { name: '', price: '', shipping: '', promo: '', buyUrl: '', notes: '' }, reviewer: '' };
    return p.i18n.data[lang];
  }
  function ensureRec(p, lang, block) {
    const d = ensureLang(p, lang);
    if (!d.blocks[block.type]) d.blocks[block.type] = { t: {}, ai: null, status: 'edited', srcHash: S.fieldsHash(block.type, block.fields), note: '', by: '', at: '', updatedAt: now() };
    return d.blocks[block.type];
  }
  DPA.i18nEnsureLang = ensureLang; DPA.i18nEnsureRec = ensureRec;

  // ───────────── 글꼴 ─────────────
  DPA.loadLangFonts = async function (lang) {
    const m = meta(lang);
    if (!m.family || lang === 'ko' || lang === 'en') return;
    const d = DPA.project.i18n.data[lang];
    let sample = '日本語简体中文字体';
    if (d) sample += Object.values(d.blocks).map((r) => Object.values(r.t || {}).join('')).join('') + Object.values(d.market || {}).join('');
    try { await Promise.all([400, 500, 600, 700, 800].map((w) => document.fonts.load(`${w} 24px ${m.family}`, sample))); } catch { /* 시스템 글꼴로 대체 */ }
  };

  // ───────────── 언어 전환 ─────────────
  DPA.setLang = async function (code) {
    if (code !== 'ko' && !DPA.project.i18n.langs.includes(code)) code = 'ko';
    DPA.lang = code;
    DPA.closeDrawer();
    document.body.dataset.lang = code;
    renderLangBar();
    DPA.renderList();
    await DPA.loadLangFonts(code);
    DPA.repaintAll();
  };

  // ───────────── 언어 막대·진행 패널 ─────────────
  function dotFor(code) {
    const s = S.langSummary(DPA.project, code);
    if (!s.total) return { cls: 'none', tip: '번역할 내용 없음' };
    if (s.ready) return { cls: 'ok', tip: '검수 완료' };
    if (s.none === s.total) return { cls: 'none', tip: '미번역' };
    return { cls: 'part', tip: '진행 중' };
  }

  function renderLangBar() {
    const bar = $('#langBar');
    if (!bar) return;
    const p = DPA.project;
    const tabs = h('div', { class: 'lang-tabs', role: 'tablist', 'aria-label': '언어 선택' });
    const mk = (code, label, extra) => h('button', { class: 'ltab' + (DPA.lang === code ? ' on' : ''), role: 'tab', type: 'button', 'aria-selected': DPA.lang === code ? 'true' : 'false', onclick: () => DPA.setLang(code) }, label, extra);
    tabs.append(mk('ko', '한국어', h('small', { text: '원문' })));
    for (const c of p.i18n.langs) {
      const d = dotFor(c);
      tabs.append(mk(c, meta(c).native, h('i', { class: 'ldot ' + d.cls, title: d.tip })));
    }
    tabs.append(h('button', { class: 'ltab add', type: 'button', onclick: () => DPA.openLangManager(), text: '＋ 번역 언어' }));
    bar.replaceChildren(tabs, h('div', { id: 'langPanel', class: 'lang-panel' }));
    renderLangPanel();
  }

  function chip(text, cls, title) { return h('span', { class: 'chip ' + (cls || ''), title, text }); }

  function renderLangPanel() {
    const box = $('#langPanel');
    if (!box) return;
    const p = DPA.project, lang = DPA.lang;
    box.replaceChildren();
    if (lang === 'ko') {
      if (p.i18n.langs.length) {
        box.append(h('div', { class: 'lp-row' }, h('span', { class: 'hint', text: `번역 언어 ${p.i18n.langs.length}개 · 한국어 원문을 고치면 번역에 ‘원문 변경’ 표시가 생깁니다.` }),
          h('span', { class: 'lp-btns' }, h('button', { class: 'btn sm', text: '용어집', onclick: () => DPA.openGlossary() }), h('button', { class: 'btn sm', text: '번역 언어 관리', onclick: () => DPA.openLangManager() }))));
      }
      return;
    }
    const s = S.langSummary(p, lang);
    const m = meta(lang);
    const chips = h('div', { class: 'lp-chips' }, chip(`${m.native}`, 'lang-name'), chip(`검수 완료 ${s.approved}/${s.total}`, s.ready ? 'st-approved' : ''));
    for (const k of ['none', 'stale', 'ai', 'edited', 'review']) if (s[k]) chips.append(chip(`${S.STATUS_LABEL[k]} ${s[k]}`, 'st-' + k));
    if (s.warnings) chips.append(chip(`⚠ 점검 경고 ${s.warnings}`, 'warn-chip', '숫자·한글 잔존·용어집 등 자동 점검에 걸린 블록 수'));
    const needs = s.none + s.stale;
    const btns = h('div', { class: 'lp-btns' },
      h('button', { class: 'btn sm ai', text: needs ? `AI로 번역 (${needs}개 블록)` : 'AI로 다시 번역', onclick: () => DPA.translateLang(lang, needs ? 'pending' : 'all') }),
      h('button', { class: 'btn sm', text: '시장 정보', onclick: () => DPA.openMarket(lang) }),
      h('button', { class: 'btn sm', text: '용어집', onclick: () => DPA.openGlossary() }),
      h('button', { class: 'btn sm', text: '검수', onclick: () => DPA.openReviewMenu(lang) }),
      h('button', { class: 'btn sm primary', text: `${m.native} 저장`, onclick: () => DPA.openExport({ lang }) }));
    const strict = h('input', { type: 'checkbox', id: 'strictChk', checked: !!p.i18n.strict, onchange: (e) => DPA.mutate((pr) => { pr.i18n.strict = e.target.checked; }, 'strict', 'i18n') });
    box.append(h('div', { class: 'lp-row' }, chips, btns), h('label', { class: 'chk sm', for: 'strictChk' }, strict, h('span', { text: '내보내기 전에 모든 블록이 ‘검수 완료’여야 함(켜면 미검수 번역은 저장되지 않음)' })));
  }

  let panelTimer = 0;
  function scheduleLangUi() {
    clearTimeout(panelTimer);
    panelTimer = setTimeout(() => { const keep = DPA.getDrawerId; void keep; renderLangPanel(); updateTabDots(); }, 250);
  }
  function updateTabDots() {
    document.querySelectorAll('#langBar .ltab:not(.add)').forEach((el, i) => {
      const code = i === 0 ? null : DPA.project.i18n.langs[i - 1];
      const dot = el.querySelector('.ldot');
      if (code && dot) { const d = dotFor(code); dot.className = 'ldot ' + d.cls; dot.title = d.tip; }
    });
  }

  // ───────────── AI 번역 ─────────────
  let trCtrl = null;
  function showTrStatus(text, onCancel) {
    const box = $('#genStatus');
    box.hidden = false;
    box.replaceChildren(h('div', { class: 'gen' }, h('b', { text: 'AI 번역 중' }), h('span', { text }), h('div', { class: 'bar' }, h('i', { style: 'width:40%' })), onCancel ? h('button', { class: 'btn sm', text: '취소', onclick: onCancel }) : null));
  }
  const hideTrStatus = () => { const b = $('#genStatus'); if (b && b.textContent.includes('AI 번역 중')) b.hidden = true; };

  function targetBlocks(lang, scope) {
    const p = DPA.project;
    const list = [];
    for (const b of p.blocks) {
      if (!S.needsTranslation(b) || b.hidden) continue;
      const d = p.i18n.data[lang];
      if (d && d.hidden && d.hidden[b.type]) continue;
      const st = S.trStatus(p, lang, b);
      if (scope === 'pending' && st !== 'none' && st !== 'stale') continue;
      if (scope && typeof scope === 'object' && !scope.types.includes(b.type)) continue;
      list.push(b);
    }
    return list;
  }

  /**
   * scope: 'pending'(미번역·원문 변경만) | 'all'(전부 다시) | { types:[...] }
   * 번역하는 동안 해당 블록의 한국어 원문이 바뀌었으면 그 블록의 결과는 적용하지 않는다.
   */
  DPA.translateLang = async function (lang, scope, opts) {
    opts = opts || {};
    if (trCtrl) { toast('이미 번역 중입니다.', 'warn'); return false; }
    const blocks = targetBlocks(lang, scope);
    if (!blocks.length) { toast('번역할 블록이 없습니다.', 'info'); return true; }
    if (scope === 'all' && !opts.skipConfirm) {
      const edited = blocks.filter((b) => ['edited', 'review', 'approved'].includes(S.trStatus(DPA.project, lang, b))).length;
      if (edited && !(await DPA.confirm(`직접 수정하거나 검수한 번역 ${edited}개 블록도 AI 번역으로 덮어씁니다.\n[되돌리기]로 복구할 수 있습니다. 계속할까요?`, { okText: '덮어쓰기', danger: true }))) return false;
    }
    const m = meta(lang);
    const ok = await DPA.ensureAi({ alwaysConfirm: !opts.noReconfirm, title: '번역 전 확인', okText: '동의하고 번역', extra: [`${m.name}로 ${blocks.length}개 블록의 문구를 번역합니다(문구 호출 1회). 이미지는 다시 만들지 않습니다.`, '번역문은 AI 초안입니다. 판매 전에 현지인 또는 전문 번역가의 검수를 권장합니다.'] });
    if (!ok) return false;
    const p = DPA.project;
    const hashes = {};
    const payload = blocks.map((b) => { hashes[b.type] = S.fieldsHash(b.type, b.fields); return { type: b.type, segments: Object.fromEntries(S.flatten(b.fields).map((x) => [x.path, x.text])) }; });
    const d = p.i18n.data[lang] || {};
    trCtrl = new AbortController();
    showTrStatus(`${m.native} (${blocks.length}개 블록)`, () => trCtrl && trCtrl.abort());
    try {
      const r = await api('POST', '/api/ai/translate', {
        lang, blocks: payload, product: { name: p.product.name, description: p.product.description, target: p.product.target }, glossary: p.i18n.glossary, market: d.market || {}, mode: p.mode,
      }, { signal: trCtrl.signal });
      let applied = 0, skipped = 0;
      DPA.mutate((pr) => {
        for (const [type, v] of Object.entries(r.blocks)) {
          const blk = pr.blocks.find((x) => x.type === type);
          if (!blk || S.fieldsHash(type, blk.fields) !== hashes[type]) { skipped += 1; continue; }
          const dd = ensureLang(pr, lang);
          const prev = dd.blocks[type];
          dd.blocks[type] = { t: { ...v.t }, ai: { ...v.t }, status: 'ai', srcHash: hashes[type], note: prev ? prev.note : '', by: '', at: '', updatedAt: now() };
          applied += 1;
        }
      }, null, 'all');
      await DPA.loadLangFonts(lang);
      DPA.repaintAll();
      const msgs = [`${m.native} 번역 ${applied}개 블록을 만들었습니다. (AI 초안 — 검수가 필요합니다)`];
      if (r.missing) msgs.push(`${r.missing}개 문장은 번역되지 않아 점검 경고로 표시됩니다.`);
      if (skipped) msgs.push(`번역하는 동안 원문이 바뀐 ${skipped}개 블록은 적용하지 않았습니다.`);
      toast(msgs.join(' '), r.missing || skipped ? 'warn' : 'ok');
      return true;
    } catch (e) {
      if (e.code === 'cancelled') toast('번역을 취소했습니다. 기존 번역은 그대로입니다.', 'info');
      else toast(DPA.errMsg(e) + ' ' + DPA.errorHint(e) + ' 입력한 내용과 기존 번역은 보존되어 있습니다.', 'err');
      return false;
    } finally { trCtrl = null; hideTrStatus(); }
  };

  // ───────────── 번역 편집 서랍 ─────────────
  function setSeg(blockType, path, value) {
    const lang = DPA.lang;
    let reset = false;
    DPA.mutate((p) => {
      const blk = p.blocks.find((b) => b.type === blockType);
      const rec = ensureRec(p, lang, blk);
      if (rec.status === 'approved' || rec.status === 'review') { reset = true; rec.by = ''; rec.at = ''; }
      if (rec.status !== 'edited') rec.status = 'edited';
      rec.t[path] = value;
      rec.updatedAt = now();
    }, `tr:${lang}:${blockType}:${path}`, 'block:' + findBlockByType(blockType).id);
    if (reset) toast('번역을 수정해 ‘검수’ 상태가 해제되었습니다. 다시 검수해 주세요.', 'info');
  }
  const findBlockByType = (t) => DPA.project.blocks.find((b) => b.type === t);

  function setStatus(blockType, status, extra) {
    const lang = DPA.lang;
    DPA.mutate((p) => {
      const blk = p.blocks.find((b) => b.type === blockType);
      const rec = ensureRec(p, lang, blk);
      rec.status = status;
      if (status === 'approved') { rec.by = (extra && extra.by) || ensureLang(p, lang).reviewer || ''; rec.at = now(); } else { rec.by = ''; rec.at = ''; }
      if (extra && extra.confirmSource) rec.srcHash = S.fieldsHash(blk.type, blk.fields);
      rec.updatedAt = now();
    }, null, 'block:' + findBlockByType(blockType).id);
    DPA.redrawTrDrawer(findBlockByType(blockType).id);
  }

  function qaLines(lang, b0) { return S.qaCheck(DPA.project, lang, b0); }

  function approve(b0) {
    const lang = DPA.lang, d = DPA.project.i18n.data[lang] || {};
    const warns = qaLines(lang, b0);
    const nameIn = h('input', { value: d.reviewer || '', placeholder: '검수자 이름(선택)', 'aria-label': '검수자 이름' });
    const m = modal({
      title: '검수 완료로 표시',
      body: h('div', { class: 'stack' },
        warns.length ? h('p', { class: 'warn', text: `자동 점검 경고 ${warns.length}건이 있습니다. 확인한 뒤 표시해 주세요.` }) : h('p', { class: 'hint', text: '검수자가 이 블록의 번역을 확인했음을 기록합니다. 이후 번역을 수정하면 해제됩니다.' }),
        warns.length ? h('ul', { class: 'bul' }, warns.slice(0, 6).map((w) => h('li', { text: `${S.prettyPath(w.path || '')} — ${w.msg}` }))) : null,
        h('label', { class: 'f sm' }, h('span', { text: '검수자' }), nameIn)),
      actions: [h('button', { class: 'btn', text: '취소', onclick: () => m.close() }), h('button', { class: 'btn primary', text: '검수 완료', onclick: () => {
        const by = nameIn.value.trim().slice(0, 60);
        DPA.mutate((p) => { ensureLang(p, lang).reviewer = by; }, null, 'i18n');
        setStatus(b0.type, 'approved', { by });
        m.close();
      } })],
    });
  }

  let drawerCtx = null;

  DPA.redrawTrDrawer = function (id) {
    const b0 = findBlock(id);
    if (!b0) { DPA.closeDrawer(); return; }
    const lang = DPA.lang, m = meta(lang), p = DPA.project;
    DPA.openDrawerRaw(id);
    const dr = $('#drawer'), body = $('.dr-body', dr), top = body.scrollTop;
    $('.dr-title', dr).textContent = `${S.LABELS[b0.type]} · ${m.native} 번역`;
    const rec = S.getTr(p, lang, b0.type);
    const st = S.trStatus(p, lang, b0);
    const d = p.i18n.data[lang] || {};
    const secs = [];

    // 상태·동작
    const head = h('div', { class: 'tr-head' });
    head.append(h('span', { class: 'chip st-' + st, text: S.STATUS_LABEL[st] || '' }));
    if (rec && rec.by) head.append(h('span', { class: 'hint', text: `검수자 ${rec.by}${rec.at ? ' · ' + new Date(rec.at).toLocaleDateString('ko-KR') : ''}` }));
    const acts = h('div', { class: 'row wrap' });
    acts.append(h('button', { class: 'btn sm ai', text: rec ? 'AI로 이 블록 다시 번역' : 'AI로 이 블록 번역', onclick: async () => { if (rec && !(await DPA.confirm('이 블록의 번역을 AI 번역으로 덮어씁니다. 계속할까요?(되돌리기 가능)', { okText: '덮어쓰기' }))) return; await DPA.translateLang(lang, { types: [b0.type] }, { skipConfirm: true, noReconfirm: true }); DPA.redrawTrDrawer(id); } }));
    if (!rec) acts.append(h('button', { class: 'btn sm', text: '원문을 복사해 직접 번역', onclick: () => { DPA.mutate((pr) => { const r = ensureRec(pr, lang, b0); for (const x of S.flatten(b0.fields)) r.t[x.path] = x.text; r.status = 'edited'; }, null, 'block:' + id); DPA.redrawTrDrawer(id); } }));
    if (rec && st === 'stale') acts.append(h('button', { class: 'btn sm primary', text: '현재 원문 기준으로 확정', title: '원문 변경 내용을 번역에 반영했음을 확인', onclick: () => setStatus(b0.type, 'edited', { confirmSource: true }) }));
    if (rec && (st === 'ai' || st === 'edited')) acts.append(h('button', { class: 'btn sm', text: '검수 요청으로 표시', onclick: () => setStatus(b0.type, 'review') }));
    if (rec && (st === 'review' || st === 'ai' || st === 'edited')) acts.append(h('button', { class: 'btn sm primary', text: '검수 완료', onclick: () => approve(b0) }));
    if (rec && (st === 'approved' || st === 'review')) acts.append(h('button', { class: 'btn sm', text: '수정 중으로 되돌림', onclick: () => setStatus(b0.type, 'edited') }));
    secs.push(h('section', { class: 'dr-sec' }, head, acts,
      st === 'stale' ? h('p', { class: 'warn', text: '한국어 원문이 번역한 뒤에 바뀌었습니다. 아래 원문과 번역을 비교해 고친 뒤 [현재 원문 기준으로 확정]을 누르거나 AI로 다시 번역하세요.' }) : null));

    // 문장 편집
    const flat = S.flatten(b0.fields);
    if (!flat.length) secs.push(h('section', { class: 'dr-sec' }, h('p', { class: 'hint', text: '이 블록에는 번역할 문구가 없습니다(이미지 전용).' })));
    else {
      const sec = h('section', { class: 'dr-sec' }, h('h4', { text: '문구 번역' }));
      for (const { path, text } of flat) {
        const cur = rec && typeof rec.t[path] === 'string' ? rec.t[path] : '';
        const ta = h('textarea', { class: 'tr-in ' + langClass(lang), rows: Math.min(8, Math.max(2, Math.ceil(Math.max(text.length, cur.length) / 34))), lang: meta(lang).htmlLang || lang, 'aria-label': `${S.prettyPath(path)} 번역`, placeholder: rec ? '번역을 입력하세요' : 'AI로 번역하거나 직접 입력하세요' });
        ta.value = cur;
        ta.addEventListener('input', (e) => { setSeg(b0.type, path, e.target.value); updateTrMeta(b0); });
        const aiBack = h('button', { class: 'link', type: 'button', text: 'AI 초안으로', onclick: () => { ta.value = rec.ai[path]; setSeg(b0.type, path, rec.ai[path]); updateTrMeta(b0); } });
        sec.append(h('div', { class: 'trseg', dataset: { path } },
          h('div', { class: 'seg-l', text: S.prettyPath(path) }),
          h('div', { class: 'seg-ko', text: text }),
          ta,
          h('div', { class: 'seg-meta' }, h('span', { class: 'seg-qa' }), h('span', { class: 'seg-ai', dataset: { aiback: '1' } }, aiBack))));
      }
      secs.push(sec);
    }

    // 메모
    const note = h('textarea', { rows: 2, placeholder: '번역가·검수자에게 남길 메모(예: 이 문구는 20자 이내로)', 'aria-label': '검수 메모' });
    note.value = (rec && rec.note) || '';
    note.addEventListener('input', (e) => DPA.mutate((pr) => { const r = ensureRec(pr, lang, b0); r.note = e.target.value; }, `trnote:${lang}:${b0.type}`, 'block:' + id));
    secs.push(h('section', { class: 'dr-sec' }, h('h4', { text: '검수 메모' }), note));

    // 이미지(언어 전용 교체)
    const slots = S.localizeBlock(p, lang, b0).images;
    if (slots.length) {
      const sec = h('section', { class: 'dr-sec' }, h('h4', { text: '이미지 (이 언어 전용으로 바꿀 수 있습니다)' }),
        h('p', { class: 'hint', text: '현지 포장·라벨 사진 등을 이 언어에만 쓰고 싶을 때 교체하세요. 기본은 한국어 화면의 이미지를 함께 씁니다.' }));
      slots.forEach((s, i) => {
        const key = b0.type + ':' + s.key;
        const own = d.imgs && d.imgs[key];
        const thumb = s.assetId ? h('img', { src: DPA.assetUrl(s.assetId, true), alt: `이미지 ${i + 1}` }) : h('div', { class: 'thumb-empty', text: '없음' });
        sec.append(h('div', { class: 'slot' }, h('div', { class: 'thumb' }, thumb), h('div', { class: 'slot-i' }, h('b', { text: `이미지 ${i + 1}` }), h('span', { class: 'chip', text: own ? '이 언어 전용' : '공통 이미지' }),
          h('div', { class: 'slot-b' }, h('button', { class: 'btn sm', text: '이 언어 전용 사진으로 교체', onclick: () => pickLangImage(b0, s, key) }), own ? h('button', { class: 'btn sm', text: '공통 이미지로 되돌림', onclick: () => { DPA.mutate((pr) => { delete ensureLang(pr, lang).imgs[key]; }, null, 'block:' + id); DPA.redrawTrDrawer(id); } }) : null))));
      });
      secs.push(sec);
    }

    // 이 언어에서 숨김
    const hid = !!(d.hidden && d.hidden[b0.type]);
    secs.push(h('section', { class: 'dr-sec row-end' }, h('button', { class: 'btn', text: hid ? '이 언어에서 블록 복원' : '이 언어에서만 블록 숨기기', onclick: () => { DPA.toggleLangHidden(id); DPA.redrawTrDrawer(id); } })));

    body.replaceChildren(...secs);
    body.scrollTop = top;
    drawerCtx = { id, lang };
    updateTrMeta(b0);
  };

  // 입력 중에는 칸을 다시 만들지 않고 경고·AI 초안 표시만 갱신한다.
  function updateTrMeta(b0) {
    const lang = DPA.lang, p = DPA.project;
    const rec = S.getTr(p, lang, b0.type);
    const warns = S.qaCheck(p, lang, b0);
    document.querySelectorAll('#drawer .trseg').forEach((el) => {
      const path = el.dataset.path;
      const ws = warns.filter((w) => w.path === path);
      const q = el.querySelector('.seg-qa');
      q.replaceChildren(...ws.map((w) => h('span', { class: 'qa-w', text: '⚠ ' + w.msg })));
      const ai = el.querySelector('.seg-ai');
      const changed = rec && rec.ai && typeof rec.ai[path] === 'string' && rec.t[path] !== rec.ai[path];
      ai.style.display = changed ? '' : 'none';
    });
    const head = document.querySelector('#drawer .tr-head .chip');
    if (head) { const st = S.trStatus(p, lang, b0); head.className = 'chip st-' + st; head.textContent = S.STATUS_LABEL[st] || ''; }
  }

  function pickLangImage(b0, slot, key) {
    const lang = DPA.lang, photos = DPA.project.photos;
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { const aid = await DPA.uploadImage(f); apply(aid, 'user'); } catch (er) { toast(DPA.errMsg(er), 'err'); }
    } });
    const apply = (aid, source) => { DPA.mutate((pr) => { ensureLang(pr, lang).imgs[key] = { assetId: aid, source }; }, null, 'block:' + b0.id); m.close(); DPA.redrawTrDrawer(b0.id); toast('이 언어 전용 이미지로 교체했습니다.', 'ok'); };
    const m = modal({
      title: `${meta(lang).native} 전용 이미지`,
      body: h('div', { class: 'stack' }, h('button', { class: 'btn primary wide', text: '내 컴퓨터에서 사진 선택', onclick: () => file.click() }), file, h('p', { class: 'hint', text: 'JPG, PNG, WEBP · 10MB 이하' }),
        photos.length ? h('div', {}, h('h4', { text: '입력해 둔 상품 사진에서 고르기' }), h('div', { class: 'photos pick' }, photos.map((ph, i) => h('button', { class: 'ph', type: 'button', 'aria-label': `상품 사진 ${i + 1}`, onclick: () => apply(ph.assetId, 'photo') }, h('img', { src: DPA.assetUrl(ph.assetId, true), alt: '' }))))) : null),
    });
    void slot;
  }

  DPA.toggleLangHidden = function (id) {
    const b0 = findBlock(id), lang = DPA.lang;
    if (!b0 || lang === 'ko') return;
    DPA.mutate((p) => { const d = ensureLang(p, lang); if (d.hidden[b0.type]) delete d.hidden[b0.type]; else d.hidden[b0.type] = true; }, null, 'blocks');
  };

  // ───────────── 초기화 ─────────────
  DPA.initI18n = function () {
    DPA.on('changed', ({ scope }) => { if (scope === 'all' || scope === 'blocks' || scope === 'i18n' || (scope && scope.startsWith('block:'))) scheduleLangUi(); if (scope === 'all' || scope === 'i18n') { renderLangBar(); } });
    DPA.on('restored', () => { if (DPA.lang !== 'ko' && !DPA.project.i18n.langs.includes(DPA.lang)) DPA.lang = 'ko'; renderLangBar(); });
  };
  DPA.renderLangBar = renderLangBar;
  void drawerCtx;
})();
