// 홍보공장 앱 화면: 로그인 → 회사·API 설정 → 캠페인(팩트 시트 → 카피 → 표지 → 카드뉴스 → 릴스·ZIP)
const $ = (sel) => document.querySelector(sel);
const LIST_FIELDS = ['painPoints', 'curriculum', 'benefits'];
const COLOR_LABELS = { primary: '포인트', accent: '강조', dark: '진한 색', light: '밝은 바탕', muted: '보조 글자' };

const state = { me: null, meta: null, campaign: null, variant: 0, adVariant: 0, template: 'bold', seq: 0 };
const AD_LABELS = { square: '1:1 피드', portrait: '4:5 피드', story: '9:16 스토리' };

async function api(path, { method = 'GET', body, headers } = {}) {
  const raw = body instanceof Blob;
  const res = await fetch(path, {
    method,
    headers: { 'x-requested-with': 'fetch', ...(body !== undefined && !raw && { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    state.me = null;
    location.hash = '#/login';
    throw new Error('로그인이 필요합니다');
  }
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function showAlert(msg, kind = 'warn') {
  const el = $('#alert');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = `alert ${kind === 'error' ? 'error' : ''}`;
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = '';
    const s = document.createElement('span');
    s.className = 'spinner';
    btn.append(s, ` ${label}`);
  } else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

async function guarded(btn, label, fn) {
  busy(btn, true, label);
  showAlert('');
  try {
    await fn();
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    busy(btn, false);
  }
}

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c !== undefined && c !== null && c !== false));
  return n;
};

// ── 라우팅 ──
const VIEWS = ['auth', 'campaigns', 'editor', 'settings'];
function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $('#nav').hidden = view === 'auth';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (view === 'editor' ? 'campaigns' : view)));
}

async function route() {
  showAlert('');
  const hash = location.hash || '#/campaigns';
  if (hash === '#/login') return show('auth');
  if (!state.me) {
    try {
      if (!(await api('/api/session')).loggedIn) return (location.hash = '#/login');
      await loadMe();
    } catch {
      return;
    }
  }
  if (hash === '#/settings') return openSettings();
  const m = /^#\/campaigns\/(new|[0-9a-f-]{36})$/.exec(hash);
  if (m) return openEditor(m[1]);
  return openCampaigns();
}

async function loadMe() {
  state.me = await api('/api/me');
  $('#companyName').textContent = state.me.company.name;
  $('#who').textContent = state.me.user.email;
}

// ── 로그인·가입 ──
let authMode = 'login';
document.querySelectorAll('#view-auth [data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    authMode = b.dataset.mode;
    document.querySelectorAll('#view-auth [data-mode]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    $('#signupFields').hidden = authMode !== 'signup';
    $('#authSubmit').textContent = authMode === 'signup' ? '가입하기' : '로그인';
    $('#authForm').password.autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
  }),
);

$('#authForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData($('#authForm')));
  guarded($('#authSubmit'), '확인 중…', async () => {
    await api(`/api/auth/${authMode}`, { method: 'POST', body: f });
    await loadMe();
    location.hash = authMode === 'signup' ? '#/settings' : '#/campaigns';
  });
});

$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  state.me = null;
  location.hash = '#/login';
});

// ── 캠페인 목록 ──
async function openCampaigns() {
  show('campaigns');
  const { me } = state;
  const steps = [
    ['회사 정보', Boolean(me.company.profile.handle)],
    ['브랜드 킷·로고', me.company.hasLogo],
    ['Claude 키 (카피)', Boolean(me.keys.anthropic)],
    ['Gemini 키 (AI 배경)', Boolean(me.keys.gemini)],
  ];
  $('#onboarding').hidden = steps.every(([, done]) => done);
  $('#checklist').replaceChildren(
    ...steps.map(([label, done]) => el('li', { className: done ? 'done' : '' }, done ? `✓ ${label}` : el('a', { href: '#/settings', textContent: `${label} 등록하기` }))),
  );
  const list = await api('/api/campaigns');
  $('#campaignEmpty').hidden = list.length > 0;
  $('#campaignList').replaceChildren(
    ...list.map((c) => el('li', {}, el('a', { href: `#/campaigns/${c.id}` }, el('span', { textContent: c.title }), el('small', { textContent: new Date(c.updatedAt).toLocaleString('ko-KR') })))),
  );
}

$('#newSample').addEventListener('click', () =>
  guarded($('#newSample'), '만드는 중…', async () => {
    state.meta ??= await api('/api/meta');
    const { _note, handle, hashtags, ...facts } = state.meta.sampleFacts;
    const c = await api('/api/campaigns', { method: 'POST', body: { facts } });
    location.hash = `#/campaigns/${c.id}`;
  }),
);

// ── 캠페인 편집 ──
function readFacts() {
  const fd = new FormData($('#facts'));
  const facts = {};
  for (const [k, v] of fd.entries()) {
    if (LIST_FIELDS.includes(k)) facts[k] = v.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (k === 'hashtags') facts[k] = v.split(',').map((s) => s.trim()).filter(Boolean);
    else facts[k] = v;
  }
  return facts;
}

function fillFacts(facts = {}) {
  for (const input of $('#facts').elements) {
    if (!input.name) continue;
    const v = facts[input.name];
    input.value = v === undefined ? '' : Array.isArray(v) ? v.join(input.name === 'hashtags' ? ', ' : '\n') : v;
  }
}

async function openEditor(id) {
  show('editor');
  state.meta ??= await api('/api/meta');
  $('#imageStyle').replaceChildren(...state.meta.imageStyles.map((s) => el('option', { value: s.name, textContent: `AI 배경: ${s.label}` })));
  if (id === 'new') {
    state.campaign = null;
    fillFacts({});
  } else {
    state.campaign = await api(`/api/campaigns/${id}`);
    fillFacts(state.campaign.facts);
  }
  state.variant = state.campaign?.render?.variant ?? 0;
  state.adVariant = state.campaign?.ads?.variant ?? 0;
  state.template = state.campaign?.render?.template ?? 'bold';
  renderEditor();
  // 서버가 다시 시작돼 렌더 결과가 없으면 카드뉴스를 바로 다시 만든다(1초 안팎)
  if (state.campaign && !state.campaign.render) await renderCards();
}

function renderEditor() {
  const c = state.campaign;
  $('#deleteCampaign').hidden = !c;
  $('#editorEmpty').hidden = Boolean(c);
  for (const b of ['#copyBlock', '#coverBlock', '#previewBlock', '#adsBlock', '#detailBlock']) $(b).hidden = !c;
  $('#reelBlock').hidden = !c?.render;
  if (!c) return;

  // 카피
  const copy = c.copy;
  $('#copySource').textContent = copy ? (copy.source === 'offline' ? '입력 문구 기반' : `AI 생성 (${copy.source.replace('ai:', '')})`) : '아직 없음 — 없으면 입력 문구로 만듭니다';
  $('#variants').replaceChildren(
    ...(copy?.variants ?? []).map((v, i) => {
      const b = el(
        'button',
        { type: 'button', className: 'variant' },
        el('div', { className: 'angle', textContent: `${i + 1}안 · ${v.angle}` }),
        el('div', { className: 'title', textContent: v.title }),
        el('div', { className: 'sub', textContent: [v.subtitle, v.cta].filter(Boolean).join(' · ') }),
      );
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === state.variant));
      b.addEventListener('click', () => {
        if (state.variant === i) return;
        state.variant = i;
        renderEditor();
        renderCards();
      });
      return b;
    }),
  );
  const warnings = copy?.warnings ?? [];
  $('#copyWarnings').hidden = !warnings.length;
  $('#copyWarnings').replaceChildren(...warnings.map((w) => el('li', { textContent: w })));
  $('#captionBox').hidden = !copy;
  $('#caption').textContent = copy ? `${copy.caption}\n\n${copy.hashtags.map((t) => `#${t}`).join(' ')}` : '';

  // 표지
  $('#coverPreview').hidden = !c.hasCover;
  if (c.hasCover) $('#coverThumb').src = `/api/campaigns/${c.id}/cover?t=${Date.parse(c.updatedAt)}`;

  // 템플릿·카드
  $('#templates').replaceChildren(
    ...state.meta.templates.map((t) => {
      const b = el('button', { type: 'button', textContent: t.name, title: t.label });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.name === state.template));
      b.addEventListener('click', () => {
        if (state.template === t.name) return;
        state.template = t.name;
        renderEditor();
        renderCards().then(() => state.campaign?.ads && renderAdImages());
      });
      return b;
    }),
  );
  renderAds(c);
  renderDetail(c);

  const r = c.render;
  if (r) {
    $('#cards').replaceChildren(
      ...r.cards.map((url, i) => el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: `${url}?t=${Date.now()}`, alt: `카드뉴스 ${i + 1}장` }))),
    );
    $('#zip').href = `/api/campaigns/${c.id}/zip`;
    setReel(r.reel);
  } else $('#cards').replaceChildren();
}

const sourceLabel = (x) => (x ? (x.source === 'offline' ? '입력 문구 기반' : `AI 생성 (${x.source.replace('ai:', '')})`) : '');
function showWarnings(sel, warnings) {
  $(sel).hidden = !warnings?.length;
  $(sel).replaceChildren(...(warnings ?? []).map((w) => el('li', { textContent: w })));
}

function renderAds(c) {
  const a = c.adCopy;
  $('#adSource').textContent = sourceLabel(a);
  $('#adVariants').replaceChildren(
    ...(a?.ads ?? []).map((ad, i) => {
      const b = el(
        'button',
        { type: 'button', className: 'variant' },
        el('div', { className: 'angle', textContent: `${i + 1}안 · ${ad.angle}` }),
        el('div', { className: 'title', textContent: ad.overlay }),
        el('div', { className: 'sub', textContent: `${ad.overlaySub} · ${ad.headline}` }),
      );
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === state.adVariant));
      b.addEventListener('click', () => {
        if (state.adVariant === i) return;
        state.adVariant = i;
        renderAds(state.campaign);
        renderAdImages();
      });
      return b;
    }),
  );
  showWarnings('#adWarnings', a?.warnings);
  const ad = a?.ads?.[state.adVariant];
  $('#adDetail').hidden = !ad;
  if (ad) {
    $('#adPrimary').textContent = ad.primaryText;
    $('#adHeadline').textContent = ad.headline;
    $('#adDescription').textContent = ad.description;
  }
  const imgs = c.ads?.images;
  $('#adImages').replaceChildren(
    ...(imgs ? Object.entries(imgs).map(([k, url]) => el('figure', {}, el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: `${url}?t=${Date.now()}`, alt: `인스타 광고 ${AD_LABELS[k]}` })), el('figcaption', { textContent: AD_LABELS[k] }))) : []),
  );
}

function renderDetail(c) {
  $('#detailSource').textContent = sourceLabel(c.detail);
  showWarnings('#detailWarnings', c.detail?.warnings);
  $('#detailImages').hidden = !c.detailImages;
  $('#detailImages').replaceChildren(...(c.detailImages ?? []).map((url, i) => el('img', { src: `${url}?t=${Date.now()}`, alt: `상세페이지 ${i + 1}블록` })));
}

async function renderAdImages() {
  const c = state.campaign;
  $('#adImages').classList.add('loading');
  try {
    state.campaign = await api(`/api/campaigns/${c.id}/ads/render`, { method: 'POST', body: { variant: state.adVariant, template: state.template } });
    renderAds(state.campaign);
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    $('#adImages').classList.remove('loading');
  }
}

async function renderCards() {
  const c = state.campaign;
  if (!c) return;
  const seq = ++state.seq;
  $('#cards').classList.add('loading');
  try {
    const out = await api(`/api/campaigns/${c.id}/render`, { method: 'POST', body: { template: state.template, variant: state.variant } });
    if (seq !== state.seq) return;
    state.campaign = out;
    renderEditor();
  } catch (err) {
    if (seq === state.seq) showAlert(err.message, 'error');
  } finally {
    if (seq === state.seq) $('#cards').classList.remove('loading');
  }
}

$('#facts').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!$('#facts').reportValidity()) return;
  guarded($('#saveFacts'), '저장 중…', async () => {
    const body = { facts: readFacts() };
    const c = state.campaign ? await api(`/api/campaigns/${state.campaign.id}`, { method: 'PUT', body }) : await api('/api/campaigns', { method: 'POST', body });
    const isNew = !state.campaign;
    document.querySelectorAll('#facts .missing').forEach((l) => l.classList.remove('missing'));
    state.campaign = c;
    if (isNew) history.replaceState(null, '', `#/campaigns/${c.id}`);
    renderEditor();
    await renderCards();
  });
});

$('#deleteCampaign').addEventListener('click', async () => {
  if (!confirm('이 캠페인과 만든 파일을 모두 지울까요?')) return;
  await api(`/api/campaigns/${state.campaign.id}`, { method: 'DELETE' });
  location.hash = '#/campaigns';
});

$('#makeCopy').addEventListener('click', () =>
  guarded($('#makeCopy'), $('#useAi').checked ? 'Claude가 작성 중…' : '준비 중…', async () => {
    const out = await api(`/api/campaigns/${state.campaign.id}/copy`, { method: 'POST', body: { ai: $('#useAi').checked } });
    state.campaign = out;
    state.variant = 0;
    renderEditor();
    await renderCards();
  }),
);

$('#makeAds').addEventListener('click', () =>
  guarded($('#makeAds'), $('#useAi').checked ? 'Claude가 작성 중…' : '준비 중…', async () => {
    state.campaign = await api(`/api/campaigns/${state.campaign.id}/ads/copy`, { method: 'POST', body: { ai: $('#useAi').checked } });
    state.adVariant = 0;
    renderAds(state.campaign);
    await renderAdImages();
  }),
);

$('#copyAdText').addEventListener('click', async () => {
  const ad = state.campaign?.adCopy?.ads?.[state.adVariant];
  if (!ad) return;
  try {
    await navigator.clipboard.writeText(`${ad.primaryText}\n\n제목: ${ad.headline}\n설명: ${ad.description}`);
    $('#copyAdText').textContent = '복사됨';
  } catch {
    $('#copyAdText').textContent = '직접 선택해 복사하세요';
  }
  setTimeout(() => ($('#copyAdText').textContent = '광고 문구 복사'), 1500);
});

$('#makeDetail').addEventListener('click', () =>
  guarded($('#makeDetail'), $('#useAi').checked ? 'Claude가 작성 중…' : '준비 중…', async () => {
    const id = state.campaign.id;
    state.campaign = await api(`/api/campaigns/${id}/detail/copy`, { method: 'POST', body: { ai: $('#useAi').checked } });
    renderDetail(state.campaign);
    $('#detailImages').classList.add('loading');
    try {
      state.campaign = await api(`/api/campaigns/${id}/detail/render`, { method: 'POST', body: {} });
      renderDetail(state.campaign);
    } finally {
      $('#detailImages').classList.remove('loading');
    }
  }),
);

// 자료 → 팩트 시트 초안: 폼에 채우기만 하고 저장은 사용자가 확인 후
const FIELD_LABELS = { tag: '태그', title: '제목', subtitle: '부제', instructor: '강사명', target: '추천 대상', painPoints: '고객 고민', promise: '약속', curriculum: '커리큘럼', benefits: '혜택', date: '일시', place: '장소', price: '수강료', cta: '신청 안내' };
$('#importFile').addEventListener('change', async () => {
  const file = $('#importFile').files[0];
  if (!file) return;
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const status = $('#importStatus');
  status.className = 'status';
  status.textContent = '자료를 읽는 중… (30초 안팎)';
  showWarnings('#importNotes', []);
  try {
    const r = await api('/api/import', { method: 'POST', body: file, headers: { 'x-file-ext': ext, 'content-type': 'application/octet-stream' } });
    const keep = readFacts();
    fillFacts({ ...r.facts, handle: keep.handle, hashtags: keep.hashtags });
    for (const input of $('#facts').elements) input.closest?.('label')?.classList.toggle('missing', r.missing.includes(input.name));
    status.className = 'status ok';
    status.textContent = `초안을 채웠습니다. 내용을 확인하고 저장하세요.${r.missing.length ? ` 빈 항목: ${r.missing.map((k) => FIELD_LABELS[k] ?? k).join(', ')}` : ''}`;
    showWarnings('#importNotes', r.notes);
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message;
  } finally {
    $('#importFile').value = '';
  }
});

$('#cover').addEventListener('change', async () => {
  const file = $('#cover').files[0];
  if (!file) return;
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  try {
    await api(`/api/campaigns/${state.campaign.id}/cover`, { method: 'POST', body: file, headers: { 'x-file-ext': ext } });
    state.campaign = await api(`/api/campaigns/${state.campaign.id}`);
    renderEditor();
    await renderCards();
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    $('#cover').value = '';
  }
});

$('#makeImage').addEventListener('click', () =>
  guarded($('#makeImage'), '만드는 중…', async () => {
    await api(`/api/campaigns/${state.campaign.id}/cover/generate`, { method: 'POST', body: { style: $('#imageStyle').value } });
    state.campaign = await api(`/api/campaigns/${state.campaign.id}`);
    renderEditor();
    await renderCards();
  }),
);

$('#coverRemove').addEventListener('click', async () => {
  await api(`/api/campaigns/${state.campaign.id}/cover`, { method: 'DELETE' });
  state.campaign = await api(`/api/campaigns/${state.campaign.id}`);
  renderEditor();
  await renderCards();
});

function setReel(reel) {
  const s = $('#reelStatus');
  s.className = `status ${reel.status === 'done' ? 'ok' : reel.status === 'error' ? 'error' : ''}`;
  s.textContent = { idle: '', queued: '대기 중…', rendering: '렌더링 중… (30초 안팎)', done: '완료. ZIP에 릴스가 포함됩니다.', error: reel.error }[reel.status] ?? '';
  const v = $('#reel');
  v.hidden = reel.status !== 'done';
  if (reel.status === 'done' && reel.url && !v.src.includes(reel.url)) v.src = reel.url;
}

$('#makeReel').addEventListener('click', () =>
  guarded($('#makeReel'), '렌더링 중…', async () => {
    const id = state.campaign.id;
    await api(`/api/campaigns/${id}/reel`, { method: 'POST', body: {} });
    for (;;) {
      const c = await api(`/api/campaigns/${id}`);
      if (state.campaign?.id !== id) return;
      setReel(c.render.reel);
      if (c.render.reel.status === 'done' || c.render.reel.status === 'error') {
        state.campaign = c;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }),
);

// ── 설정 ──
async function openSettings() {
  show('settings');
  state.meta ??= await api('/api/meta');
  await loadMe();
  const { company, keys } = state.me;
  const cf = $('#companyForm');
  cf.name.value = company.name;
  for (const k of ['handle', 'phone', 'email', 'website', 'bizNumber', 'intro']) cf[k].value = company.profile[k] ?? '';

  const bf = $('#brandForm');
  $('#colorInputs').replaceChildren(
    ...Object.entries(COLOR_LABELS).map(([role, label]) => {
      const text = el('input', { type: 'text', name: `c_${role}`, value: company.brand.colors[role], maxLength: 7, ariaLabel: `${label} 색상 코드` });
      const pick = el('input', { type: 'color', value: company.brand.colors[role], ariaLabel: `${label} 색상 선택` });
      pick.addEventListener('input', () => (text.value = pick.value.toUpperCase()));
      text.addEventListener('change', () => /^#[0-9a-f]{6}$/i.test(text.value) && (pick.value = text.value));
      return el('label', {}, pick, el('span', {}, label, text));
    }),
  );
  bf.tone.value = company.brand.tone;
  bf.forbidden.value = company.brand.forbidden.join(', ');
  bf.hashtags.value = company.brand.hashtags.join(', ');
  bf.aiBadge.checked = company.brand.aiBadge !== false;
  $('#brandAdjusted').hidden = true;
  $('#logoBox').hidden = !company.hasLogo;
  if (company.hasLogo) $('#logoImg').src = `/api/company/logo?t=${Date.now()}`;

  $('#keyRows').replaceChildren(
    ...state.meta.providers.map((p) => {
      const k = keys[p.name];
      const input = el('input', { type: 'password', autocomplete: 'off', placeholder: k ? `등록됨 ${k.last4 ? '••••' + k.last4 : ''} — 바꾸려면 새 키 입력` : `${p.label} API 키` });
      const status = el('div', { className: `state ${k ? 'ok' : ''}`, textContent: k ? `✓ 연결됨 · 사용 모델 ${k.textModel ?? k.imageModel} · ${new Date(k.updatedAt).toLocaleDateString('ko-KR')}` : '미등록' });
      const save = el('button', { type: 'button', className: 'primary small', textContent: '연결 테스트 후 저장' });
      const del = el('button', { type: 'button', className: 'ghost small', textContent: '삭제', hidden: !k });
      save.addEventListener('click', () =>
        guarded(save, '확인 중…', async () => {
          await api(`/api/keys/${p.name}`, { method: 'PUT', body: { apiKey: input.value } });
          await openSettings();
          showAlert(`${p.label} 키를 저장했습니다.`);
        }),
      );
      del.addEventListener('click', async () => {
        if (!confirm(`${p.label} 키를 삭제할까요?`)) return;
        await api(`/api/keys/${p.name}`, { method: 'DELETE' });
        await openSettings();
      });
      return el('div', { className: 'keyrow' }, el('label', {}, `${p.label} — ${p.use}`, input, status), el('div', {}, save, ' ', del));
    }),
  );

  const usage = await api('/api/usage');
  const KIND = { copy: '카피', ads: '광고 문구', detail: '상세페이지', import: '자료 가져오기', image: 'AI 배경', key_test: '키 확인' };
  $('#usage').replaceChildren(
    el('tr', {}, el('th', { textContent: '공급자' }), el('th', { textContent: '작업' }), el('th', { textContent: '성공' }), el('th', { textContent: '전체' })),
    ...usage.rows.map((r) => el('tr', {}, el('td', { textContent: r.provider }), el('td', { textContent: KIND[r.kind] ?? r.kind }), el('td', { textContent: r.ok }), el('td', { textContent: r.total }))),
  );
}

$('#companyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('#companyForm');
  guarded(f.querySelector('button'), '저장 중…', async () => {
    const profile = Object.fromEntries(['handle', 'phone', 'email', 'website', 'bizNumber', 'intro'].map((k) => [k, f[k].value]));
    await api('/api/company', { method: 'PUT', body: { name: f.name.value, profile } });
    await loadMe();
    showAlert('회사 정보를 저장했습니다.');
  });
});

$('#brandForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('#brandForm');
  guarded(f.querySelector('button[type=submit]'), '저장 중…', async () => {
    const colors = Object.fromEntries(Object.keys(COLOR_LABELS).map((r) => [r, f[`c_${r}`].value]));
    const { adjusted } = await api('/api/company/brand', { method: 'PUT', body: { colors, tone: f.tone.value, forbidden: f.forbidden.value, hashtags: f.hashtags.value, aiBadge: f.aiBadge.checked } });
    await openSettings();
    const box = $('#brandAdjusted');
    box.hidden = !adjusted.length;
    box.textContent = adjusted.length ? `글자가 잘 읽히도록 색을 보정했습니다: ${adjusted.map((a) => `${COLOR_LABELS[a.role]} ${a.from} → ${a.to}`).join(', ')}` : '';
    showAlert('브랜드 킷을 저장했습니다.');
  });
});

$('#logo').addEventListener('change', async () => {
  const file = $('#logo').files[0];
  if (!file) return;
  try {
    await api('/api/company/logo', { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } });
    await openSettings();
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    $('#logo').value = '';
  }
});

$('#logoRemove').addEventListener('click', async () => {
  await api('/api/company/logo', { method: 'DELETE' });
  await openSettings();
});

window.addEventListener('hashchange', route);
route();
