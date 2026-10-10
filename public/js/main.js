/* DETAIL PAGE AI — 시작·화면 연결. by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { h, $, $$, toast, api } = DPA;
  DPA.ZIP = window.DPA_ZIP;

  DPA.setProject = async function (p) {
    DPA.project = p;
    DPA.resetHistory();
    DPA.clearConflict();
    $$('input[name=mode]').forEach((r) => { r.checked = r.value === p.mode; });
    DPA.fillForm();
    DPA.loadPreview();
    document.title = `${p.name} · DETAIL PAGE AI`;
    DPA.emit('save-state-reset');
    await DPA.ensureFonts();
    DPA.repaintAll();
  };

  function wire() {
    $('#btnApi').addEventListener('click', () => DPA.openConnect());
    $('#btnProjects').addEventListener('click', () => DPA.openProjects());
    $('#btnExport').addEventListener('click', () => DPA.openExport());
    $('#btnHelp').addEventListener('click', () => DPA.openHelp());
    $('#btnMore').addEventListener('click', () => DPA.openMore());
    $$('input[name=mode]').forEach((r) => r.addEventListener('change', () => { if (r.checked) DPA.mutate((p) => { p.mode = r.value; }, 'mode', 'mode'); }));
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('on', x === t));
      document.body.classList.toggle('show-input', t.dataset.tab === 'input');
      document.body.classList.toggle('show-preview', t.dataset.tab === 'preview');
      window.scrollTo({ top: 0 });
    }));
    DPA.on('api-state', () => {
      const b = $('#btnApi'), on = DPA.rt.connected;
      b.classList.toggle('on', on);
      $('span', b).textContent = on ? 'API 연결됨' : 'API 연결 안 됨';
    });
    DPA.on('save-state', ({ state }) => {
      const banner = $('#banner');
      if (state === 'conflict') {
        banner.hidden = false;
        banner.replaceChildren(h('span', { text: '다른 창에서 이 프로젝트가 변경되었습니다. 덮어쓰지 않도록 저장을 멈췄습니다.' }), h('button', { class: 'btn sm', text: '새로고침', onclick: () => location.reload() }));
      }
    });
    window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); DPA.saveNow().then(() => toast('저장했습니다.', 'ok')); } });
  }

  function heartbeat() {
    let fails = 0;
    setInterval(async () => {
      try { await api('POST', '/api/ping', {}); if (fails) { fails = 0; $('#banner').hidden = true; DPA.refreshState(); } } catch (e) {
        if (++fails === 3) {
          const banner = $('#banner');
          banner.hidden = false;
          banner.replaceChildren(h('span', { text: '프로그램과 연결이 끊겼습니다. 종료되었다면 바탕화면의 DETAIL PAGE AI 바로가기로 다시 실행한 뒤 새로고침해 주세요. 작업 내용은 자동 저장되어 있습니다.' }));
        }
      }
    }, 20000);
  }

  async function start() {
    wire();
    DPA.initProduct();
    DPA.initPreview();
    await DPA.refreshState();
    try {
      const r = await api('GET', '/api/projects/current');
      await DPA.setProject(r.project);
    } catch (e) {
      document.body.prepend(h('div', { class: 'banner' }, h('span', { text: '프로젝트를 불러오지 못했습니다: ' + DPA.errMsg(e) }), h('button', { class: 'btn sm', text: '새로고침', onclick: () => location.reload() })));
      return;
    }
    heartbeat();
    window.__dpaReady = true;
  }
  start();
})();
