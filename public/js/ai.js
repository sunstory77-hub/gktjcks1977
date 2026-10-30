/* DETAIL PAGE AI — Gemini 연결, 외부 전송·사용료 동의, 작업 진행 확인. by BAPI */
(function () {
  'use strict';
  const DPA = window.DPA;
  const { h, $, modal, toast, api } = DPA;

  DPA.refreshState = async function () {
    try {
      const s = await api('GET', '/api/state');
      Object.assign(DPA.rt, { connected: s.connected, models: s.models, available: s.available, consent: s.consent, version: s.version, dataDir: s.dataDir });
    } catch { /* 연결 확인 실패는 heartbeat 가 안내한다 */ }
    DPA.emit('api-state');
  };

  function modelSelects(m, refresh) {
    const rt = DPA.rt;
    if (!rt.available) return null;
    const mk = (kind, mode, label) => {
      const sel = h('select', { 'aria-label': label, onchange: async (e) => {
        try { const r = await api('POST', '/api/models/select', { kind, mode, id: e.target.value }); rt.models = r.models; toast('모델을 바꿨습니다.', 'ok'); } catch (er) { toast(DPA.errMsg(er), 'err'); }
        refresh();
      } });
      const list = rt.available[kind];
      if (!list.length) sel.append(h('option', { value: '', text: '사용 가능한 모델 없음' }));
      list.forEach((id) => sel.append(h('option', { value: id, text: id, selected: rt.models[kind][mode] === id })));
      return h('label', { class: 'f sm' }, h('span', { text: label }), sel);
    };
    return h('details', { class: 'adv' }, h('summary', { text: '고급: 사용할 모델 직접 선택' }),
      h('p', { class: 'hint', text: '연결할 때 구글에서 현재 사용 가능한 모델을 확인해 자동으로 고릅니다. 필요하면 바꿀 수 있습니다.' }),
      mk('text', 'normal', '문구 · 일반'), mk('text', 'high', '문구 · 고품질'), mk('image', 'normal', '이미지 · 일반'), mk('image', 'high', '이미지 · 고품질'));
  }

  DPA.openConnect = function () {
    return new Promise((resolve) => {
      const rt = DPA.rt;
      const body = h('div', { class: 'stack' });
      const msg = h('p', { class: 'form-msg', role: 'alert' });
      let m;
      const keyInput = h('input', { type: 'password', id: 'apiKey', autocomplete: 'off', spellcheck: false, placeholder: 'Gemini API 키를 붙여넣어 주세요', 'aria-label': 'Gemini API 키' });
      const eye = h('button', { class: 'btn sm', type: 'button', text: '보기', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; eye.textContent = keyInput.type === 'password' ? '보기' : '숨기기'; } });
      const connectBtn = h('button', { class: 'btn primary', text: '연결하기' });
      const draw = () => {
        body.replaceChildren();
        if (rt.connected) {
          body.append(
            h('div', { class: 'okbox' }, h('b', { text: '연결되었습니다' }),
              h('p', { class: 'hint', text: `문구 모델: ${rt.models.text.normal || '-'} / ${rt.models.text.high || '-'}\n이미지 모델: ${rt.models.image.normal || '없음'} / ${rt.models.image.high || '없음'}` })),
            !rt.models.image.normal ? h('p', { class: 'warn', text: '이 키로는 이미지 생성 모델을 찾지 못했습니다. 문구 생성은 가능하지만 연출 이미지는 만들 수 없습니다.' }) : null,
            modelSelects(rt.models, draw),
            h('p', { class: 'hint', text: '키는 이 프로그램이 켜져 있는 동안 컴퓨터 메모리에만 보관됩니다. 프로그램을 종료하면 사라지므로 다시 켤 때 새로 연결해 주세요.' }),
            h('button', { class: 'btn', text: '연결 해제', onclick: async () => { await api('POST', '/api/disconnect', {}); await DPA.refreshState(); draw(); } }));
          return;
        }
        body.append(
          h('p', { text: '내 Google 계정의 Gemini API 키로 문구와 이미지를 만듭니다. 키는 저장 파일, 백업, 로그에 남지 않습니다.' }),
          h('ol', { class: 'steps-list' },
            h('li', {}, h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer', text: 'Google AI Studio' }), '에서 API 키를 만듭니다.'),
            h('li', { text: '아래 칸에 붙여넣고 [연결하기]를 누릅니다.' })),
          h('div', { class: 'row' }, keyInput, eye), msg,
          h('p', { class: 'hint', text: '※ 상품 정보와 사진은 생성할 때 Google Gemini API로 전송되며, 사용량에 따라 Google에서 별도 요금이 청구될 수 있습니다. 요금은 이 프로그램과 무관하게 Google 계정에 부과됩니다.' }));
      };
      connectBtn.onclick = async () => {
        msg.textContent = '';
        const key = keyInput.value.trim();
        if (!key) { msg.textContent = 'API 키를 입력해 주세요.'; keyInput.focus(); return; }
        connectBtn.disabled = true; connectBtn.textContent = '연결 중…';
        try {
          await api('POST', '/api/connect', { key });
          keyInput.value = '';
          await DPA.refreshState();
          toast('Gemini API에 연결했습니다.', 'ok');
          draw(); m.setFoot([doneBtn]);
        } catch (e) {
          msg.textContent = DPA.errMsg(e);
        } finally { connectBtn.disabled = false; connectBtn.textContent = '연결하기'; }
      };
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectBtn.click(); });
      const doneBtn = h('button', { class: 'btn primary', text: '완료', onclick: () => m.close() });
      m = modal({ title: 'Gemini API 연결', body, actions: rt.connected ? [doneBtn] : [h('button', { class: 'btn', text: '닫기', onclick: () => m.close() }), connectBtn], onClose: () => resolve(DPA.rt.connected) });
      draw();
      if (!rt.connected) setTimeout(() => keyInput.focus(), 50);
    });
  };

  // 외부 전송·사용료 동의 (세션당 1회, 전체 생성은 매번)
  function consentModal(opts) {
    return new Promise((resolve) => {
      let ok = false;
      const chk = h('input', { type: 'checkbox', id: 'consentChk' });
      const go = h('button', { class: 'btn primary', text: opts.okText || '동의하고 진행', disabled: true });
      chk.addEventListener('change', () => { go.disabled = !chk.checked; });
      go.onclick = async () => {
        try { await api('POST', '/api/consent', { agree: true }); DPA.rt.consent = true; ok = true; m.close(); } catch (e) { toast(DPA.errMsg(e), 'err'); }
      };
      const m = modal({
        title: opts.title || '외부 전송 및 사용료 안내',
        body: h('div', { class: 'stack' },
          h('ul', { class: 'bul' },
            h('li', { text: '입력한 상품 정보와 상품 사진이 Google Gemini API로 전송됩니다.' }),
            h('li', { text: '사용량에 따라 Google에서 별도 사용료가 청구될 수 있습니다. (무료 한도, 요금은 Google 정책에 따릅니다)' }),
            h('li', { text: '사진은 외부로 전송되어도 되는 자료만 사용해 주세요.' }),
            ...(opts.extra || []).map((t) => h('li', { text: t }))),
          h('label', { class: 'chk' }, chk, h('span', { text: '위 내용을 확인했고 진행합니다.' }))),
        actions: [h('button', { class: 'btn', text: '취소', onclick: () => m.close() }), go],
        onClose: () => resolve(ok),
      });
    });
  }

  // AI 기능을 쓰기 전 연결·동의를 확인한다. 통과하면 true.
  DPA.ensureAi = async function (opts) {
    opts = opts || {};
    if (!DPA.rt.connected) {
      const ok = await DPA.openConnect();
      if (!ok) return false;
    }
    if (opts.alwaysConfirm || !DPA.rt.consent) return consentModal(opts);
    return true;
  };

  DPA.pollJob = async function (jobId, onUpdate, cancelRef) {
    let fails = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 900));
      let v;
      try { v = await api('GET', `/api/jobs/${jobId}`); fails = 0; } catch (e) {
        if (e.status === 404 || ++fails >= 5) throw e;
        continue;
      }
      onUpdate(v);
      if (v.status !== 'running') return v;
      if (cancelRef && cancelRef.cancelled) { try { await api('DELETE', `/api/jobs/${jobId}`); } catch { /* 이미 끝났을 수 있다 */ } }
    }
  };

  DPA.errorHint = (e) => {
    const c = e && e.code;
    if (c === 'auth') return 'API 키를 확인해 주세요. (헤더의 API 연결 버튼에서 다시 연결할 수 있습니다)';
    if (c === 'not_connected') return 'API 연결이 끊겼습니다. 다시 연결해 주세요.';
    return '';
  };
  void $;
})();
