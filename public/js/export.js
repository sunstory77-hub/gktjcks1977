/* DETAIL PAGE AI — 저장·내보내기, 프로젝트 관리, 확인 요청(도움말), 종료. by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { S, h, $, toast, modal, api } = DPA;
  const R = window.DPA_RENDER;

  DPA.ensureFonts = async function () {
    try { await Promise.all([400, 500, 600, 700, 800].map((w) => document.fonts.load(`${w} 24px "Pretendard Variable"`, '가나다라abc123'))); } catch { /* 글꼴이 없으면 대체 글꼴 */ }
  };

  const usedSlots = (lang) => {
    const out = [];
    DPA.visibleBlocks(lang).forEach((b) => b.images.forEach((s, i) => { if (DPA.slotVisible(s)) out.push({ b, s, i }); }));
    return out;
  };
  const langTag = (lang) => (lang === 'ko' ? '' : '_' + lang);

  // ───────────── JPG ─────────────
  // 언어별 JPG 를 만들어 [{ name, blob }] 로 돌려준다(저장은 호출한 쪽에서 한다).
  async function buildJpgs(hi, say, lang) {
    await DPA.ensureFonts();
    await DPA.loadLangFonts(lang);
    const blocks = DPA.visibleBlocks(lang);
    if (!blocks.length) throw new Error('저장할 블록이 없습니다. 먼저 상세페이지를 만들어 주세요.');
    const aids = [...new Set(usedSlots(lang).map((x) => x.s.assetId))];
    say(`이미지 ${aids.length}장 불러오는 중…`);
    const res = await Promise.allSettled(aids.map((a) => DPA.loadImage(a)));
    const bad = res.filter((r) => r.status === 'rejected').length;
    if (bad) throw new Error(`이미지 ${bad}장을 불러오지 못해 저장을 중단했습니다. 해당 이미지를 교체하거나 삭제한 뒤 다시 시도해 주세요.`);
    const scale = hi ? 2 : 1;
    const base = { brief: DPA.project.brief, getImage: DPA.getImage, preview: false, pending: new Set(), lang };
    say('높이 계산 중…');
    const heights = blocks.map((b) => R.renderBlock(b, { ...base, scale: 1 }).height);
    const limit = Math.floor(30000 / scale);
    const parts = [[]];
    let acc = 0;
    blocks.forEach((b, i) => {
      if (!heights[i]) return;
      if (acc + heights[i] > limit && parts[parts.length - 1].length) { parts.push([]); acc = 0; }
      parts[parts.length - 1].push(i); acc += heights[i];
    });
    const out = [];
    const nm = DPA.safeName(DPA.project.name);
    for (let pi = 0; pi < parts.length; pi++) {
      say(`${lang === 'ko' ? '' : S.LANG_BY[lang].native + ' '}JPG 만드는 중… (${pi + 1}/${parts.length})`);
      const idx = parts[pi];
      const total = idx.reduce((n, i) => n + heights[i], 0);
      const cv = document.createElement('canvas');
      cv.width = R.W * scale; cv.height = total * scale;
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('이미지를 만들 메모리가 부족합니다. 고해상도를 끄고 다시 시도해 주세요.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
      let y = 0;
      for (const i of idx) {
        const { canvas } = R.renderBlock(blocks[i], { ...base, scale });
        if (canvas) ctx.drawImage(canvas, 0, y * scale);
        y += heights[i];
        await new Promise((r) => setTimeout(r));
      }
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob || blob.size < 1000) throw new Error('JPG를 만들지 못했습니다. 고해상도를 끄고 다시 시도해 주세요.');
      out.push({ name: `${nm}_상세페이지${langTag(lang)}_${DPA.ymd()}${parts.length > 1 ? '_' + (pi + 1) : ''}.jpg`, blob, width: R.W * scale, height: total * scale });
    }
    return out;
  }
  DPA.buildJpgs = buildJpgs;

  // 번역이 덜 된 언어는 저장 전에 알리고(설정에 따라 막고) 확인받는다.
  DPA.exportGate = async function (lang) {
    if (lang === 'ko') return true;
    const p = DPA.project, name = S.LANG_BY[lang].name;
    const s = S.langSummary(p, lang);
    const problems = [];
    if (s.none) problems.push(`번역되지 않은 블록 ${s.none}개 (한국어 그대로 출력됩니다)`);
    if (s.stale) problems.push(`한국어 원문이 바뀐 뒤 확인하지 않은 블록 ${s.stale}개`);
    const unreviewed = s.ai + s.edited + s.review;
    if (unreviewed) problems.push(`검수가 끝나지 않은 블록 ${unreviewed}개 (AI 초안 ${s.ai} · 직접 수정 ${s.edited} · 검수 요청 ${s.review})`);
    if (s.warningsOpen) problems.push(`자동 점검 경고가 있는 블록 ${s.warningsOpen}개`);
    if (!problems.length) return true;
    if (p.i18n.strict) {
      await DPA.confirm(`${name}는 ‘내보내기 전 검수 완료 필수’ 설정이라 저장할 수 없습니다.\n\n· ${problems.join('\n· ')}\n\n전문 번역 검수를 마치거나, 번역 언어 화면에서 이 설정을 끄세요.`, { title: '검수가 필요합니다', okText: '확인', cancelText: '닫기' });
      return false;
    }
    return DPA.confirm(`${name} 번역에 확인되지 않은 항목이 있습니다.\n\n· ${problems.join('\n· ')}\n\n그래도 저장할까요?`, { title: '검수 확인', okText: '그래도 저장', danger: true });
  };

  // ───────────── ZIP ─────────────
  async function collectZipFiles(say, lang, prefix) {
    const list = usedSlots(lang);
    const vis = DPA.visibleBlocks(lang);
    const cta = vis.find((b) => b.type === 'cta' && b.fields.buttonUrl);
    if (!list.length) throw new Error('저장할 이미지가 없습니다. (숨긴 블록과 삭제한 이미지는 제외됩니다)');
    const files = [];
    const counter = {};
    for (let n = 0; n < list.length; n++) {
      const { b, s } = list[n];
      say(`이미지 담는 중… ${n + 1}/${list.length}`);
      const r = await fetch(DPA.assetUrl(s.assetId));
      if (!r.ok) throw new Error('이미지를 읽지 못해 ZIP 저장을 중단했습니다.');
      const type = r.headers.get('content-type') || '';
      const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
      const k = (counter[b.id] = (counter[b.id] || 0) + 1);
      const pos = vis.indexOf(b) + 1;
      files.push({ name: `${prefix}${String(pos).padStart(2, '0')}_${S.LABELS[b.type].replace(/[·\s]/g, '')}_${k}.${ext}`, data: new Uint8Array(await r.arrayBuffer()) });
    }
    if (cta) files.push({ name: `${prefix}구매링크.txt`, data: new TextEncoder().encode(cta.fields.buttonUrl + '\n') });
    return files;
  }
  async function exportZip(say, langs) {
    const files = [];
    for (const lang of langs) files.push(...(await collectZipFiles(say, lang, langs.length > 1 ? `${lang}/` : '')));
    const blob = DPA.ZIP.makeZip(files);
    DPA.saveBlob(blob, `${DPA.safeName(DPA.project.name)}_이미지${langs.length === 1 ? langTag(langs[0]) : '_전체언어'}_${DPA.ymd()}.zip`);
    return { count: files.length, size: blob.size };
  }

  // ───────────── JSON 백업·복원 ─────────────
  async function exportBackup() {
    await DPA.flushSave();
    const blob = await api('GET', `/api/projects/${DPA.project.id}/backup`, undefined, { blob: true });
    DPA.saveBlob(blob, `${DPA.safeName(DPA.project.name)}_백업_${DPA.ymd()}.json`);
    return blob.size;
  }
  async function importBackup(file) {
    if (!file) return;
    const text = await file.text();
    const r = await api('POST', '/api/projects/import', text, { rawText: true });
    await DPA.setProject(r.project);
    toast(`백업에서 복원했습니다.${r.missingAssets ? ` 이미지 ${r.missingAssets}장은 백업에 없어 비어 있습니다.` : ''}`, r.missingAssets ? 'warn' : 'ok');
  }

  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }

  DPA.openExport = function (opts) {
    opts = opts || {};
    const p = DPA.project;
    const all = ['ko', ...p.i18n.langs];
    const picked = new Set([opts.lang && all.includes(opts.lang) ? opts.lang : (all.includes(DPA.lang) ? DPA.lang : 'ko')]);
    const statusEl = h('p', { class: 'hint', role: 'status', text: '' });
    const say = (t) => { statusEl.textContent = t; };
    const hi = h('input', { type: 'checkbox', id: 'optHi' });
    const sumEl = h('p', { class: 'hint' });
    const refresh = () => {
      const ls = all.filter((c) => picked.has(c));
      const parts = ls.map((c) => `${c === 'ko' ? '한국어' : S.LANG_BY[c].native} ${DPA.visibleBlocks(c).length}블록·이미지 ${usedSlots(c).length}장`);
      sumEl.textContent = ls.length ? `${parts.join(' / ')}. 숨긴 블록과 삭제한 이미지는 저장되지 않습니다.` : '저장할 언어를 선택해 주세요.';
      jpgBtn.disabled = zipBtn.disabled = !ls.length || ls.every((c) => !DPA.visibleBlocks(c).length);
    };
    const run = (btn, fn) => async () => {
      btn.disabled = true;
      try { await fn(); } catch (e) { say(''); toast(DPA.errMsg(e), 'err'); } finally { btn.disabled = false; refresh(); }
    };
    const jpgBtn = h('button', { class: 'btn primary wide', text: '상세페이지 JPG 저장' });
    jpgBtn.onclick = run(jpgBtn, async () => {
      const ls = all.filter((c) => picked.has(c));
      for (const c of ls) if (!(await DPA.exportGate(c))) { say('검수가 필요해 저장하지 않았습니다.'); return; }
      const made = [];
      for (const c of ls) made.push(...(await buildJpgs(hi.checked, say, c)));
      if (ls.length === 1) { made.forEach((f) => DPA.saveBlob(f.blob, f.name)); say(`저장했습니다. JPG ${made.length}개 · 가로 ${made[0].width}px`); }
      else {
        say('ZIP으로 묶는 중…');
        const files = [];
        for (const f of made) files.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
        const zip = DPA.ZIP.makeZip(files);
        DPA.saveBlob(zip, `${DPA.safeName(p.name)}_상세페이지_전체언어_${DPA.ymd()}.zip`);
        say(`저장했습니다. ${ls.length}개 언어 JPG ${made.length}개를 ZIP 하나로 묶었습니다.`);
      }
      toast('JPG로 저장했습니다.', 'ok');
    });
    const zipBtn = h('button', { class: 'btn wide', text: '사용 중인 이미지 ZIP 저장' });
    zipBtn.onclick = run(zipBtn, async () => {
      const ls = all.filter((c) => picked.has(c));
      for (const c of ls) if (!(await DPA.exportGate(c))) { say('검수가 필요해 저장하지 않았습니다.'); return; }
      const r = await exportZip(say, ls); say(`저장했습니다. 파일 ${r.count}개 (${fmtSize(r.size)})`); toast('ZIP으로 저장했습니다.', 'ok');
    });
    const jsonBtn = h('button', { class: 'btn wide', text: '프로젝트 백업(JSON) 저장' });
    jsonBtn.onclick = run(jsonBtn, async () => { const n = await exportBackup(); say(`백업을 저장했습니다 (${fmtSize(n)}). 번역·검수 기록이 포함되며 API 키는 포함되지 않습니다.`); });
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; try { await importBackup(f); m.close(); } catch (er) { toast(DPA.errMsg(er), 'err'); } } });
    const langBox = all.length > 1 ? h('div', { class: 'f' }, h('span', { text: '저장할 언어' }), h('div', { class: 'row wrap' }, ...all.map((c) => {
      const st = c === 'ko' ? null : S.langSummary(p, c);
      return h('label', { class: 'chk inline' }, h('input', { type: 'checkbox', checked: picked.has(c), onchange: (e) => { if (e.target.checked) picked.add(c); else picked.delete(c); refresh(); } }), h('span', { text: c === 'ko' ? '한국어' : S.LANG_BY[c].native }), st ? h('i', { class: 'ldot ' + (st.ready ? 'ok' : st.none === st.total ? 'none' : 'part'), title: st.ready ? '검수 완료' : '검수 필요' }) : null);
    }))) : null;
    const m = modal({
      title: '저장·내보내기',
      body: h('div', { class: 'stack' },
        langBox, sumEl, jpgBtn,
        h('label', { class: 'chk' }, hi, h('span', { text: '고해상도(가로 1720px, 용량이 커집니다)' })),
        zipBtn, jsonBtn,
        h('button', { class: 'btn wide', text: '백업 파일에서 복원', onclick: () => file.click() }), file,
        statusEl),
    });
    refresh();
  };

  // ───────────── 프로젝트 ─────────────
  DPA.openProjects = async function () {
    await DPA.flushSave();
    let data;
    try { data = await api('GET', '/api/projects'); } catch (e) { toast(DPA.errMsg(e), 'err'); return; }
    const list = h('div', { class: 'plist' });
    const m = modal({ title: '프로젝트', body: list, wide: true, actions: [h('button', { class: 'btn primary', text: '＋ 새 프로젝트', onclick: async () => {
      try { const r = await api('POST', '/api/projects', {}); await DPA.setProject(r.project); m.close(); } catch (e) { toast(DPA.errMsg(e), 'err'); }
    } })] });
    const draw = () => {
      list.replaceChildren(...data.projects.map((p) => h('div', { class: 'prow' + (p.id === DPA.project.id ? ' cur' : '') },
        p.thumb ? h('img', { src: `/api/projects/${p.id}/assets/${p.thumb}?ref=1`, alt: '' }) : h('div', { class: 'thumb-empty', text: '없음' }),
        h('div', { class: 'pi' }, h('b', { text: p.name }), h('small', { text: `수정 ${new Date(p.updatedAt).toLocaleString('ko-KR')} · 블록 ${p.blocks}개` })),
        h('div', { class: 'pb' },
          p.id === DPA.project.id ? h('span', { class: 'chip', text: '작업 중' }) : h('button', { class: 'btn sm', text: '열기', onclick: async () => { try { const r = await api('GET', `/api/projects/${p.id}`); await DPA.setProject(r.project); m.close(); } catch (e) { toast(DPA.errMsg(e), 'err'); } } }),
          h('button', { class: 'btn sm danger-o', text: '삭제', onclick: async () => {
            const ok = await DPA.confirm(`‘${p.name}’ 프로젝트를 삭제할까요?\n입력 자료와 이미지가 함께 삭제 목록으로 이동합니다. (데이터 폴더의 trash 폴더에 남아 있어 직접 복구할 수 있습니다)`, { okText: '삭제', danger: true });
            if (!ok) return;
            try {
              await api('DELETE', `/api/projects/${p.id}`);
              data.projects = data.projects.filter((x) => x.id !== p.id);
              if (p.id === DPA.project.id) {
                const next = data.projects[0];
                const r = next ? await api('GET', `/api/projects/${next.id}`) : await api('POST', '/api/projects', {});
                await DPA.setProject(r.project);
                if (!next) data.projects = [{ id: r.project.id, name: r.project.name, updatedAt: r.project.updatedAt, blocks: 0, thumb: null }];
              }
              draw();
            } catch (e) { toast(DPA.errMsg(e), 'err'); }
          } })))));
    };
    draw();
  };

  // ───────────── 확인 요청(사용 안내) ─────────────
  DPA.openHelp = async function () {
    const body = h('div', { class: 'guide' }, h('p', { class: 'hint', text: '불러오는 중…' }));
    modal({ title: '확인 요청 · 사용 안내', body, wide: true });
    try {
      const r = await fetch('/guide.html');
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.importNode(n, true)));
    } catch { body.replaceChildren(h('p', { text: '안내를 불러오지 못했습니다.' })); }
  };

  // ───────────── 더보기 / 종료 ─────────────
  DPA.openMore = function () {
    const m = modal({
      title: DPA.rt.version ? `DETAIL PAGE AI ${DPA.rt.version} · by BAPI` : 'DETAIL PAGE AI · by BAPI',
      body: h('div', { class: 'stack' },
        h('p', { class: 'hint pre', text: `자료 저장 위치\n${DPA.rt.dataDir || ''}\n\n프로그램을 업데이트하거나 지워도 이 폴더의 프로젝트는 그대로 남습니다.` }),
        h('a', { class: 'btn wide', href: '/licenses.html', target: '_blank', rel: 'noopener', text: '라이선스 보기' }),
        h('button', { class: 'btn wide danger-o', text: '프로그램 종료', onclick: async () => {
          if (!(await DPA.confirm('프로그램을 종료할까요?\n작업 내용은 자동 저장되어 있습니다. API 키는 종료와 함께 지워집니다.', { okText: '종료' }))) return;
          await DPA.flushSave();
          try { await api('POST', '/api/quit', {}); } catch { /* 이미 종료 */ }
          m.close();
          document.body.replaceChildren(h('div', { class: 'bye' }, h('h2', { text: '프로그램이 종료되었습니다' }), h('p', { text: '이 창은 닫아도 됩니다. 다시 사용하려면 바탕화면의 DETAIL PAGE AI 바로가기를 실행해 주세요.' })));
        } })),
    });
  };
})();
