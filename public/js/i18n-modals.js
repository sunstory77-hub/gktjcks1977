/* DETAIL PAGE AI — 다국어 대화상자: 번역 언어 관리, 시장 정보, 용어집, 전문 번역 검수(내보내기·가져오기). by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { S, h, toast, modal, api } = DPA;
  const meta = (c) => S.LANG_BY[c] || { code: c, name: c, native: c };
  const now = () => new Date().toISOString();

  // ───────────── 번역 언어 관리 ─────────────
  DPA.openLangManager = function () {
    const p = DPA.project;
    const sel = new Set(p.i18n.langs);
    const trChk = h('input', { type: 'checkbox', id: 'trNow', checked: true });
    const rows = S.TARGET_LANGS.map((l) => {
      const cb = h('input', { type: 'checkbox', checked: sel.has(l.code), onchange: (e) => { if (e.target.checked) sel.add(l.code); else sel.delete(l.code); } });
      const sum = sel.has(l.code) ? S.langSummary(p, l.code) : null;
      return h('label', { class: 'chk lang-row' }, cb, h('span', {}, h('b', { text: `${l.name}` }), ' ', h('small', { text: l.native }), sum && sum.total ? h('em', { class: 'hint', text: ` · 검수 완료 ${sum.approved}/${sum.total}` }) : null));
    });
    const m = modal({
      title: '번역 언어',
      body: h('div', { class: 'stack' },
        h('p', { class: 'hint', text: '한국어 원문 하나로 수출 국가별 상세페이지를 만듭니다. 이미지는 모든 언어가 함께 쓰고, 문구만 번역합니다. (현재 영어·일본어·중국어 간체 지원)' }),
        ...rows,
        h('label', { class: 'chk' }, trChk, h('span', { text: '새로 추가한 언어는 바로 AI로 번역하기' })),
        h('p', { class: 'hint', text: '언어를 빼면 그 언어의 번역·검수 기록이 삭제됩니다(되돌리기로 복구 가능).' })),
      actions: [h('button', { class: 'btn', text: '취소', onclick: () => m.close() }), h('button', { class: 'btn primary', text: '적용', onclick: async () => {
        const before = p.i18n.langs.slice();
        const removed = before.filter((c) => !sel.has(c));
        const added = S.TARGET_LANGS.map((l) => l.code).filter((c) => sel.has(c) && !before.includes(c));
        if (removed.length && !(await DPA.confirm(`${removed.map((c) => meta(c).name).join(', ')}의 번역과 검수 기록을 삭제할까요?`, { okText: '삭제', danger: true }))) return;
        const doTr = trChk.checked;
        m.close();
        DPA.mutate((pr) => {
          for (const c of removed) delete pr.i18n.data[c];
          pr.i18n.langs = S.TARGET_LANGS.map((l) => l.code).filter((c) => sel.has(c));
          for (const c of added) DPA.i18nEnsureLang(pr, c);
        }, null, 'all');
        if (removed.includes(DPA.lang)) await DPA.setLang('ko'); else DPA.renderLangBar();
        if (added.length) {
          await DPA.setLang(added[0]);
          if (doTr) { let first = true; for (const c of added) { if (!(await DPA.translateLang(c, 'pending', { noReconfirm: !first }))) break; first = false; } }
        }
      } })],
    });
  };

  // ───────────── 시장 정보 ─────────────
  DPA.openMarket = function (lang0) {
    const p = DPA.project;
    if (!p.i18n.langs.length) { toast('먼저 번역 언어를 추가해 주세요.', 'info'); return; }
    let cur = lang0 && p.i18n.langs.includes(lang0) ? lang0 : p.i18n.langs[0];
    const box = h('div', { class: 'stack' });
    const FIELDS = [
      ['name', '현지 상품명', '그 나라에서 쓸 공식 상품명. 입력하면 번역에 그대로 사용됩니다.', 'input'],
      ['price', '현지 가격', '예) $24.90 / ¥3,200 / ¥168. 원화 가격은 자동으로 환산하지 않으니 직접 입력하세요.', 'input'],
      ['shipping', '배송 조건', '예) Free shipping over $50', 'area'],
      ['promo', '프로모션', '그 나라에서만 하는 행사(없으면 비워 두세요)', 'area'],
      ['buyUrl', '구매 링크', '현지 판매 페이지 주소(저장본 JPG에는 링크가 걸리지 않고 ZIP의 구매링크 파일에 담깁니다)', 'input'],
      ['notes', '메모', '번역가·검수자에게 줄 시장 특이사항(문체, 금지 표현 등)', 'area'],
    ];
    const draw = () => {
      const d = DPA.i18nEnsureLangRead(cur);
      const sel = h('select', { 'aria-label': '언어', onchange: (e) => { cur = e.target.value; draw(); } }, p.i18n.langs.map((c) => h('option', { value: c, text: meta(c).name, selected: c === cur })));
      box.replaceChildren(h('label', { class: 'f sm' }, h('span', { text: '언어' }), sel),
        h('p', { class: 'hint', text: '번역 요청과 검수 파일에 함께 전달됩니다. 가격·배송처럼 나라마다 다른 내용은 번역이 아니라 여기에 직접 입력하세요.' }),
        ...FIELDS.map(([k, label, hint, kind]) => {
          const el = kind === 'area' ? h('textarea', { rows: 2, value: d.market[k] || '' }) : h('input', { value: d.market[k] || '', type: k === 'buyUrl' ? 'url' : 'text' });
          el.addEventListener('input', (e) => DPA.mutate((pr) => { DPA.i18nEnsureLang(pr, cur).market[k] = e.target.value; }, `mk:${cur}:${k}`, 'i18n'));
          return h('label', { class: 'f sm' }, h('span', { text: label }), el, h('small', { class: 'hint', text: hint }));
        }));
    };
    const m = modal({ title: '시장 정보', body: box, wide: true, onClose: () => DPA.repaintAll(), actions: [h('button', { class: 'btn primary', text: '완료', onclick: () => m.close() })] });
    draw();
  };
  DPA.i18nEnsureLangRead = (lang) => DPA.project.i18n.data[lang] || DPA.i18nEnsureLang(DPA.project, lang);

  // ───────────── 용어집 ─────────────
  DPA.openGlossary = function () {
    const p = DPA.project;
    const langs = p.i18n.langs.length ? p.i18n.langs : S.TARGET_LANGS.map((l) => l.code);
    const wrap = h('div', { class: 'gl' });
    const draw = () => {
      const g = p.i18n.glossary;
      wrap.replaceChildren(
        h('p', { class: 'hint', text: '번역 용어를 통일하고 상품명·브랜드명처럼 번역하면 안 되는 말을 지정합니다. AI 번역과 전문 번역가 검수 요청서에 그대로 전달되고, 어긋나면 자동 점검이 경고합니다.' }),
        g.length ? h('div', { class: 'gl-head' }, h('span', { text: '한국어 용어' }), h('span', { text: '번역 금지' }), ...langs.map((c) => h('span', { text: meta(c).native })), h('span', { text: '' })) : h('p', { class: 'hint', text: '아직 등록한 용어가 없습니다.' }),
        ...g.map((e, i) => {
          const ko = h('input', { value: e.ko, placeholder: '예) 한라봉', 'aria-label': '한국어 용어' });
          ko.addEventListener('input', (ev) => DPA.mutate((pr) => { pr.i18n.glossary[i].ko = ev.target.value; }, `gl:${e.id}:ko`, 'i18n'));
          const dnt = h('input', { type: 'checkbox', checked: !!e.dnt, 'aria-label': '번역 금지(그대로 사용)', onchange: (ev) => { DPA.mutate((pr) => { pr.i18n.glossary[i].dnt = ev.target.checked; }, null, 'i18n'); draw(); } });
          const cells = langs.map((c) => {
            const inp = h('input', { value: (e.tr && e.tr[c]) || '', disabled: !!e.dnt, placeholder: e.dnt ? '그대로 사용' : '번역어', 'aria-label': `${meta(c).name} 번역어`, class: 'lang-' + c });
            inp.addEventListener('input', (ev) => DPA.mutate((pr) => { const x = pr.i18n.glossary[i]; x.tr = x.tr || {}; x.tr[c] = ev.target.value; }, `gl:${e.id}:${c}`, 'i18n'));
            return inp;
          });
          return h('div', { class: 'gl-row' }, ko, h('label', { class: 'chk center' }, dnt), ...cells, h('button', { class: 'btn sm icon', 'aria-label': '용어 삭제', text: '×', onclick: () => { DPA.mutate((pr) => { pr.i18n.glossary.splice(i, 1); }, null, 'i18n'); draw(); } }));
        }),
        h('button', { class: 'btn sm', text: '＋ 용어 추가', onclick: () => { DPA.mutate((pr) => { pr.i18n.glossary.push({ id: S.newId('g'), ko: '', dnt: false, tr: {} }); }, null, 'i18n'); draw(); } }),
        p.product.name ? h('button', { class: 'btn sm', text: '상품명을 번역 금지 용어로 추가', onclick: () => { DPA.mutate((pr) => { pr.i18n.glossary.push({ id: S.newId('g'), ko: pr.product.name, dnt: true, tr: {} }); }, null, 'i18n'); draw(); } }) : null);
    };
    const m = modal({ title: '용어집', body: wrap, wide: true, onClose: () => DPA.repaintAll(), actions: [h('button', { class: 'btn primary', text: '완료', onclick: () => m.close() })] });
    draw();
  };

  // ───────────── 검수 메뉴 ─────────────
  function bulkStatus(lang, to) {
    const p = DPA.project;
    const targets = p.blocks.filter((b) => S.needsTranslation(b) && !S.localizeBlock(p, lang, b).hidden && S.getTr(p, lang, b.type));
    const eligible = targets.filter((b) => { const st = S.trStatus(p, lang, b); return to === 'review' ? (st === 'ai' || st === 'edited') : (st !== 'stale'); });
    return { targets, eligible };
  }
  async function bulkApply(lang, to) {
    const p = DPA.project;
    const { eligible } = bulkStatus(lang, to);
    if (!eligible.length) { toast('표시할 블록이 없습니다.', 'info'); return; }
    let by = (p.i18n.data[lang] && p.i18n.data[lang].reviewer) || '';
    if (to === 'approved') {
      const warn = eligible.filter((b) => S.qaCheck(p, lang, b).length).length;
      const nameIn = h('input', { value: by, placeholder: '검수자 이름(선택)', 'aria-label': '검수자 이름' });
      const ok = await new Promise((resolve) => {
        let r = false;
        const m = modal({ title: '전체 검수 완료로 표시', onClose: () => resolve(r), body: h('div', { class: 'stack' },
          h('p', { text: `${meta(lang).name} ${eligible.length}개 블록을 ‘검수 완료’로 표시합니다.` }),
          warn ? h('p', { class: 'warn', text: `자동 점검 경고가 있는 블록이 ${warn}개 있습니다. 확인 후 진행하세요.` }) : null,
          h('p', { class: 'hint', text: '원문이 바뀐 블록은 제외됩니다. 전문 번역가가 실제로 검수한 뒤에 사용하세요.' }),
          h('label', { class: 'f sm' }, h('span', { text: '검수자' }), nameIn)),
        actions: [h('button', { class: 'btn', text: '취소', onclick: () => m.close() }), h('button', { class: 'btn primary', text: '검수 완료로 표시', onclick: () => { r = true; m.close(); } })] });
      });
      if (!ok) return;
      by = nameIn.value.trim().slice(0, 60);
    }
    DPA.mutate((pr) => {
      const d = DPA.i18nEnsureLang(pr, lang);
      if (to === 'approved') d.reviewer = by;
      for (const b of eligible) {
        const rec = d.blocks[b.type];
        rec.status = to; rec.updatedAt = now();
        if (to === 'approved') { rec.by = by; rec.at = now(); } else { rec.by = ''; rec.at = ''; }
      }
    }, null, 'all');
    toast(`${eligible.length}개 블록을 ‘${S.STATUS_LABEL[to]}’로 표시했습니다.`, 'ok');
  }

  DPA.openReviewMenu = function (lang) {
    const m = modal({
      title: '전문 번역 검수',
      body: h('div', { class: 'stack' },
        h('ol', { class: 'steps-list' },
          h('li', { text: 'AI 번역(초안)을 확인하고 필요한 곳을 직접 고칩니다.' }),
          h('li', { text: '[검수 패키지 내보내기]로 번역가에게 보낼 파일(엑셀 또는 번역 도구용 XLIFF)을 만듭니다.' }),
          h('li', { text: '번역가가 고쳐서 돌려주면 [검수 결과 가져오기]로 변경 내용을 확인하고 적용합니다.' }),
          h('li', { text: '모든 블록이 ‘검수 완료’가 되면 저장합니다. (설정에 따라 미검수 번역은 저장이 막힙니다)' })),
        h('button', { class: 'btn primary wide', text: '검수 패키지 내보내기 (번역가에게 보내기)', onclick: () => { m.close(); DPA.openReviewExport(lang); } }),
        h('button', { class: 'btn wide', text: '검수 결과 가져오기 (번역가가 돌려준 파일)', onclick: () => { m.close(); DPA.openReviewImport(); } }),
        h('hr', { class: 'sep' }),
        h('button', { class: 'btn wide', text: `${meta(lang).native} 전체를 ‘검수 요청’으로 표시`, onclick: () => { m.close(); bulkApply(lang, 'review'); } }),
        h('button', { class: 'btn wide', text: `${meta(lang).native} 전체를 ‘검수 완료’로 표시`, onclick: () => { m.close(); bulkApply(lang, 'approved'); } })),
    });
  };

  // ───────────── 검수 패키지 내보내기 ─────────────
  DPA.openReviewExport = function (lang0) {
    const p = DPA.project;
    if (!p.i18n.langs.length) { toast('먼저 번역 언어를 추가해 주세요.', 'info'); return; }
    const picked = new Set(lang0 ? [lang0] : p.i18n.langs);
    const fmt = { v: 'xlsx' };
    const mark = h('input', { type: 'checkbox', id: 'rvMark', checked: true });
    const pend = h('input', { type: 'checkbox', id: 'rvPend' });
    const status = h('p', { class: 'hint', role: 'status' });
    const go = h('button', { class: 'btn primary', text: '파일 만들기' });
    const m = modal({
      title: '검수 패키지 내보내기',
      body: h('div', { class: 'stack' },
        h('div', { class: 'f' }, h('span', { text: '검수할 언어' }), ...p.i18n.langs.map((c) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: picked.has(c), onchange: (e) => { if (e.target.checked) picked.add(c); else picked.delete(c); } }), h('span', { text: `${meta(c).name} (${S.langSummary(p, c).total}개 블록)` })))),
        h('fieldset', { class: 'seg2' }, h('legend', { class: 'sr', text: '파일 형식' }),
          h('label', {}, h('input', { type: 'radio', name: 'rvfmt', value: 'xlsx', checked: true, onchange: () => { fmt.v = 'xlsx'; } }), h('span', {}, h('b', { text: '엑셀(XLSX) — 권장' }), h('small', { text: '언어별 시트, 원문·AI 번역·검수본 열, 안내·용어집 시트 포함' }))),
          h('label', {}, h('input', { type: 'radio', name: 'rvfmt', value: 'xliff', onchange: () => { fmt.v = 'xliff'; } }), h('span', {}, h('b', { text: 'XLIFF 1.2' }), h('small', { text: '번역 도구(Trados, memoQ 등)용. 언어마다 파일 1개(여러 언어는 ZIP)' })))),
        h('label', { class: 'chk' }, pend, h('span', { text: '이미 ‘검수 완료’인 블록은 제외' })),
        h('label', { class: 'chk' }, mark, h('span', { text: '내보낸 블록을 ‘검수 요청’으로 표시' })),
        h('p', { class: 'hint', text: '번역가에게는 이 파일만 보내면 됩니다. 상품 사진이나 API 키는 들어가지 않습니다.' }), status),
      actions: [h('button', { class: 'btn', text: '닫기', onclick: () => m.close() }), go],
    });
    go.onclick = async () => {
      const langs = [...picked];
      if (!langs.length) { toast('검수할 언어를 선택해 주세요.', 'warn'); return; }
      go.disabled = true; status.textContent = '파일을 만드는 중…';
      try {
        await DPA.flushSave();
        const res = await api('POST', `/api/projects/${p.id}/review/export`, { langs, format: fmt.v, pending: pend.checked }, { raw: true });
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get('x-dpa-filename') || 'review.xlsx');
        DPA.saveBlob(blob, name);
        if (mark.checked) {
          DPA.mutate((pr) => {
            for (const c of langs) {
              for (const b of pr.blocks) {
                const d = pr.i18n.data[c]; const rec = d && d.blocks[b.type];
                if (rec && (rec.status === 'ai' || rec.status === 'edited') && S.trStatus(pr, c, b) !== 'stale') { rec.status = 'review'; rec.updatedAt = now(); }
              }
            }
          }, null, 'all');
        }
        status.textContent = `저장했습니다: ${name}`;
        toast('검수 패키지를 저장했습니다. 번역가에게 전달하세요.', 'ok');
      } catch (e) { status.textContent = ''; toast(DPA.errMsg(e), 'err'); } finally { go.disabled = false; }
    };
  };

  // ───────────── 검수 결과 가져오기 ─────────────
  DPA.openReviewImport = function () {
    const p = DPA.project;
    const file = h('input', { type: 'file', accept: '.xlsx,.xlf,.xliff', hidden: true });
    const result = h('div', { class: 'stack' });
    const m = modal({
      title: '검수 결과 가져오기', wide: true,
      body: h('div', { class: 'stack' },
        h('p', { class: 'hint', text: '번역가가 돌려준 엑셀(XLSX) 또는 XLIFF 파일을 선택하세요. 바로 적용하지 않고 변경 내용을 먼저 보여 드립니다.' }),
        h('button', { class: 'btn primary', text: '파일 선택', onclick: () => file.click() }), file, result),
    });
    file.addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      result.replaceChildren(h('p', { class: 'hint', text: '파일을 읽는 중…' }));
      try {
        await DPA.flushSave();
        const buf = new Blob([await f.arrayBuffer()], { type: 'application/octet-stream' });
        const r = await api('POST', `/api/projects/${p.id}/review/import`, buf, { headers: { 'x-dpa-filename': encodeURIComponent(f.name) } });
        renderImport(r, m, result);
      } catch (er) { result.replaceChildren(h('p', { class: 'warn', text: DPA.errMsg(er) })); }
    });
  };

  function renderImport(r, m, box) {
    const p = DPA.project;
    const known = r.items.filter((i) => !i.unknown && p.i18n.langs.includes(i.lang));
    const skippedLang = r.items.filter((i) => !i.unknown && !p.i18n.langs.includes(i.lang)).length;
    const changed = known.filter((i) => i.changed);
    const picked = new Set(changed.filter((i) => i.srcMatch).map((i) => i.lang + '|' + i.id));
    const S0 = r.summary;
    const nameIn = h('input', { placeholder: '검수자(번역가) 이름', 'aria-label': '검수자 이름', value: '' });
    const list = h('div', { class: 'imp-list' });
    const info = h('div', { class: 'lp-chips' },
      h('span', { class: 'chip', text: `전체 ${S0.total}행` }), h('span', { class: 'chip st-edited', text: `변경 ${S0.changed}` }), h('span', { class: 'chip st-approved', text: `검수 완료 표시 ${S0.approved}` }),
      S0.flagged ? h('span', { class: 'chip warn-chip', text: `수정 필요 ${S0.flagged}` }) : null, S0.srcChanged ? h('span', { class: 'chip st-stale', text: `원문 달라짐 ${S0.srcChanged}` }) : null, S0.unknown ? h('span', { class: 'chip warn-chip', text: `알 수 없는 ID ${S0.unknown}` }) : null);
    const rows = changed.length ? changed.map((it) => {
      const key = it.lang + '|' + it.id;
      const cb = h('input', { type: 'checkbox', checked: picked.has(key), 'aria-label': `${it.label} 적용`, onchange: (e) => { if (e.target.checked) picked.add(key); else picked.delete(key); } });
      return h('div', { class: 'imp-row' }, h('label', { class: 'chk' }, cb, h('span', {}, h('b', { text: `${meta(it.lang).native} · ${it.label}` }), it.srcMatch ? null : h('span', { class: 'chip st-stale', text: '원문이 달라짐' }))),
        h('div', { class: 'imp-cols' }, h('div', {}, h('small', { text: '현재 번역' }), h('div', { class: 'imp-t lang-' + it.lang, text: it.current || '(없음)' })), h('div', {}, h('small', { text: '검수본' }), h('div', { class: 'imp-t new lang-' + it.lang, text: it.after })),
          it.note ? h('div', {}, h('small', { text: '검수 메모' }), h('div', { class: 'imp-t', text: it.note })) : null));
    }) : [h('p', { class: 'hint', text: '번역문이 바뀐 행이 없습니다. 상태·메모만 반영됩니다.' })];
    list.replaceChildren(...rows);
    box.replaceChildren(info,
      ...(r.warnings || []).map((w) => h('p', { class: 'warn', text: w })),
      skippedLang ? h('p', { class: 'warn', text: `프로젝트에 없는 언어의 ${skippedLang}행은 건너뜁니다.` }) : null,
      S0.srcChanged ? h('p', { class: 'warn', text: '내보낸 뒤 한국어 원문이 바뀐 행은 기본으로 선택되지 않습니다. 내용을 확인하고 필요하면 직접 선택하세요.' }) : null,
      list,
      h('label', { class: 'f sm' }, h('span', { text: '검수자 이름 (검수 완료로 기록됩니다)' }), nameIn),
      h('div', { class: 'row-end' }, h('button', { class: 'btn', text: '취소', onclick: () => m.close() }), h('button', { class: 'btn primary', text: '선택 항목 적용', onclick: () => { applyImport(r, known, picked, nameIn.value.trim().slice(0, 60)); m.close(); } })));
  }

  function applyImport(r, known, picked, by) {
    let nChanged = 0, nApproved = 0, nFlag = 0;
    DPA.mutate((p) => {
      const groups = new Map();
      for (const it of known) { const k = it.lang + '|' + it.type; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
      for (const [k, rows] of groups) {
        const [lang, type] = k.split('|');
        const blk = p.blocks.find((b) => b.type === type);
        if (!blk) continue;
        const d = DPA.i18nEnsureLang(p, lang);
        const rec = DPA.i18nEnsureRec(p, lang, blk);
        let applied = false;
        for (const it of rows) if (it.changed && picked.has(lang + '|' + it.id)) { rec.t[it.path] = it.after; applied = true; nChanged += 1; }
        const notes = rows.map((x) => x.note).filter(Boolean);
        if (notes.length) rec.note = [rec.note, ...notes.filter((n) => !(rec.note || '').includes(n))].filter(Boolean).join('\n');
        const allApproved = rows.length > 0 && rows.every((x) => x.status === 'approved') && rows.every((x) => x.srcMatch);
        const anyFlag = rows.some((x) => x.status === 'flag');
        if (anyFlag) { rec.status = 'review'; rec.by = ''; rec.at = ''; nFlag += 1; }
        else if (allApproved) { rec.status = 'approved'; rec.by = by; rec.at = now(); if (by) d.reviewer = by; nApproved += 1; }
        else if (applied) { rec.status = 'edited'; rec.by = ''; rec.at = ''; }
        rec.updatedAt = now();
      }
    }, null, 'all');
    toast(`검수 결과를 적용했습니다. 번역 ${nChanged}행 반영 · 검수 완료 ${nApproved}개 블록${nFlag ? ` · 수정 필요 ${nFlag}개 블록` : ''}`, nFlag ? 'warn' : 'ok');
  }
})();
