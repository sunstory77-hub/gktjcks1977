// 홍보공장 앱 화면: 로그인 → 회사·API 설정 → 캠페인(팩트 시트 → 카피 → 표지 → 카드뉴스 → 릴스·ZIP)
const $ = (sel) => document.querySelector(sel);
const LIST_FIELDS = ['painPoints', 'curriculum', 'benefits'];
const COLOR_LABELS = { primary: '포인트', accent: '강조', dark: '진한 색', light: '밝은 바탕', muted: '보조 글자' };

const state = { me: null, meta: null, campaign: null, variant: 0, adVariant: 0, template: 'bold', seq: 0, invite: null, reset: null };
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
const VIEWS = ['auth', 'reset', 'campaigns', 'editor', 'settings'];
function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $('#nav').hidden = view === 'auth' || view === 'reset';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (view === 'editor' ? 'campaigns' : view)));
}

async function route() {
  showAlert('');
  const hash = location.hash || '#/campaigns';
  if (hash === '#/login') return openAuth(null);
  const reset = /^#\/reset\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (reset) {
    state.reset = reset[1];
    return show('reset');
  }
  const invite = /^#\/invite\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (invite) return openAuth(invite[1]);
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
  document.body.classList.toggle('is-member', state.me.user.role !== 'owner');
  $('#companyName').textContent = state.me.company.name;
  $('#who').textContent = state.me.user.email;
}

// ── 로그인·가입 ──
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('#view-auth [data-mode]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.mode === mode)));
  $('#signupFields').hidden = mode !== 'signup';
  $('#forgotNote').hidden = mode === 'signup';
  $('#authSubmit').textContent = mode === 'signup' ? '가입하기' : '로그인';
  $('#authForm').password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
}
document.querySelectorAll('#view-auth [data-mode]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));

// 초대 링크로 들어오면 가입 화면에 초대 이메일을 채우고 회사명은 받지 않는다
async function openAuth(inviteToken) {
  show('auth');
  state.invite = null;
  $('#companyField').hidden = false;
  $('#inviteNote').hidden = true;
  $('#authForm').email.readOnly = false;
  if (!inviteToken) return;
  try {
    const inv = await api(`/api/invites/${inviteToken}`);
    state.invite = inviteToken;
    setAuthMode('signup');
    $('#authForm').email.value = inv.email;
    $('#authForm').email.readOnly = true;
    $('#companyField').hidden = true;
    $('#inviteNote').hidden = false;
    $('#inviteNote').textContent = `${inv.companyName}의 팀원으로 가입합니다.`;
  } catch (err) {
    showAlert(err.message, 'error');
  }
}

$('#authForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData($('#authForm')));
  f.agree = $('#authForm').agree.checked;
  if (state.invite) f.invite = state.invite;
  guarded($('#authSubmit'), '확인 중…', async () => {
    await api(`/api/auth/${authMode}`, { method: 'POST', body: f });
    state.invite = null;
    await loadMe();
    location.hash = authMode === 'signup' && state.me.user.role === 'owner' ? '#/settings' : '#/campaigns';
  });
});

$('#resetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guarded($('#resetSubmit'), '바꾸는 중…', async () => {
    await api('/api/auth/reset', { method: 'POST', body: { token: state.reset, password: $('#resetForm').password.value } });
    state.reset = null;
    location.hash = '#/login';
    showAlert('비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요.');
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
  $('#onboarding').hidden = steps.every(([, done]) => done) || me.user.role !== 'owner';
  $('#checklist').replaceChildren(
    ...steps.map(([label, done]) => el('li', { className: done ? 'done' : '' }, done ? `✓ ${label}` : el('a', { href: '#/settings', textContent: `${label} 등록하기` }))),
  );
  const p = me.plan;
  const banner = $('#planBanner');
  banner.hidden = !(p.expired || p.campaigns.used >= p.campaigns.limit || p.plan === 'trial');
  banner.className = `alert ${p.expired ? 'error' : ''}`;
  banner.textContent = p.expired
    ? `${p.label} 이용 기간이 끝났습니다. 만든 결과물은 내려받을 수 있고, 새로 만들려면 요금제를 연장하세요.`
    : `${p.label} · 이번 달 캠페인 ${p.campaigns.used}/${p.campaigns.limit}${p.until ? ` · ${new Date(p.until).toLocaleDateString('ko-KR')}까지` : ''}`;
  state.meta ??= await api('/api/meta');
  const kindLabel = Object.fromEntries(state.meta.kinds.map((k) => [k.name, k.label]));
  const list = await api('/api/campaigns');
  $('#campaignEmpty').hidden = list.length > 0;
  $('#campaignList').replaceChildren(
    ...list.map((c) => el('li', {}, el('a', { href: `#/campaigns/${c.id}` }, el('span', {}, el('small', { textContent: `${kindLabel[c.kind] ?? ''} · ` }), c.title), el('small', { textContent: new Date(c.updatedAt).toLocaleString('ko-KR') })))),
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
    if (!input.name || input.name === 'kind') continue;
    const v = facts[input.name];
    input.value = v === undefined ? '' : Array.isArray(v) ? v.join(input.name === 'hashtags' ? ', ' : '\n') : v;
  }
  applyKind(facts.kind || 'edu');
}

// 업종에 맞게 라벨·필수 표시를 바꾼다
const BASE_LABELS = { tag: '태그', title: '제목', subtitle: '부제', handle: 'SNS 계정', promise: '약속 한 문장', hashtags: '해시태그' };
const FIELD_KIND_LABEL = { instructor: 'instructor', target: 'target', painPoints: 'painPoints', curriculum: 'curriculum', benefits: 'benefits', date: 'date', place: 'place', price: 'price', cta: 'cta' };
function applyKind(kind) {
  const k = state.meta.kinds.find((x) => x.name === kind) ?? state.meta.kinds[0];
  $('#facts').kind.value = k.name;
  $('#kinds').replaceChildren(
    ...state.meta.kinds.map((x) => {
      const b = el('button', { type: 'button', textContent: x.label });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(x.name === k.name));
      b.addEventListener('click', () => applyKind(x.name));
      return b;
    }),
  );
  for (const input of $('#facts').elements) {
    const label = input.closest?.('label');
    if (!input.name || !label || !(input.name in FIELD_KIND_LABEL || input.name in BASE_LABELS)) continue;
    const text = FIELD_KIND_LABEL[input.name] ? k.labels[FIELD_KIND_LABEL[input.name]] : BASE_LABELS[input.name];
    label.firstChild.nodeValue = `${text} `;
    const required = k.required.includes(input.name);
    input.required = required;
    let star = label.querySelector('.req');
    if (!star) {
      star = el('span', { className: 'req', textContent: '*' });
      label.insertBefore(star, input);
      label.insertBefore(document.createTextNode(' '), input);
    }
    star.hidden = !required;
  }
  const L = k.labels;
  $('#factsNote').textContent = `여기 입력한 ${L.date}·${L.place}·${L.price}·${L.curriculum}·${L.benefits}는 AI가 바꾸지 않고 그대로 들어갑니다.`;
  $('#imageStyle')?.replaceChildren(...styleOptions(k.name));
}

function styleOptions(kind) {
  const rec = state.meta.stylesByKind[kind] ?? [];
  const byName = Object.fromEntries(state.meta.imageStyles.map((s) => [s.name, s]));
  const rest = state.meta.imageStyles.filter((s) => !rec.includes(s.name));
  return [
    el('optgroup', { label: '추천' }, ...rec.map((n) => el('option', { value: n, textContent: byName[n].label }))),
    el('optgroup', { label: '그 밖의 스타일' }, ...rest.map((s) => el('option', { value: s.name, textContent: s.label }))),
  ];
}

async function openEditor(id) {
  show('editor');
  state.meta ??= await api('/api/meta');
  $('#imageRatio').replaceChildren(...state.meta.imageRatios.map((r) => el('option', { value: r.name, textContent: r.label })));
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
  for (const b of ['#copyBlock', '#imageBlock', '#previewBlock', '#adsBlock', '#detailBlock']) $(b).hidden = !c;
  $('#reelBlock').hidden = !c?.render;
  if (!c) return;

  // 카피
  const copy = c.copy;
  $('#copySource').textContent = copy ? sourceLabel(copy) : '아직 없음 — 없으면 입력 문구로 만듭니다';
  $('#editCopy').hidden = !copy;
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

  renderGallery(c);

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

const sourceLabel = (x) => (x ? ({ offline: '입력 문구 기반', edited: '직접 수정' }[x.source] ?? `AI 생성 (${x.source.replace('ai:', '')})`) : '');
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
  $('#editAds').hidden = !ad;
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
  $('#editDetail').hidden = !c.detail;
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
    const keep = readFacts();
    const r = await api('/api/import', { method: 'POST', body: file, headers: { 'x-file-ext': ext, 'x-kind': keep.kind, 'content-type': 'application/octet-stream' } });
    fillFacts({ ...r.facts, kind: keep.kind, handle: keep.handle, hashtags: keep.hashtags });
    for (const input of $('#facts').elements) input.closest?.('label')?.classList.toggle('missing', r.missing.includes(input.name));
    status.className = 'status ok';
    const labels = { ...FIELD_LABELS, ...state.meta.kinds.find((k) => k.name === keep.kind)?.labels };
    status.textContent = `초안을 채웠습니다. 내용을 확인하고 저장하세요.${r.missing.length ? ` 빈 항목: ${r.missing.map((k) => labels[k] ?? k).join(', ')}` : ''}`;
    showWarnings('#importNotes', r.notes);
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message;
  } finally {
    $('#importFile').value = '';
  }
});

// ── 이미지 보관함 ──
const SLOT_LABEL = { vertical: '세로', feed: '피드' };
function renderGallery(c) {
  const imgs = c.images ?? [];
  $('#imageCount').textContent = `${imgs.length}/${state.meta.maxImages}`;
  const uploads = imgs.filter((im) => im.source === 'upload');
  const keep = $('#imageRef').value;
  $('#imageRef').replaceChildren(el('option', { value: '', textContent: '사용 안 함' }), ...uploads.map((im, i) => el('option', { value: im.id, textContent: `올린 사진 ${i + 1}` })));
  if (uploads.some((im) => im.id === keep)) $('#imageRef').value = keep;
  const styleLabel = Object.fromEntries(state.meta.imageStyles.map((x) => [x.name, x.label]));
  $('#gallery').replaceChildren(
    ...imgs.map((im, i) => {
      const slots = Object.entries(c.slots).filter(([, v]) => v === im.id).map(([k]) => k);
      const slotBtn = (slot) => {
        const on = c.slots[slot] === im.id;
        const b = el('button', { type: 'button', className: 'ghost', textContent: on ? `${SLOT_LABEL[slot]} ✓` : `${SLOT_LABEL[slot]}에 쓰기` });
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => setSlots({ ...c.slots, [slot]: on ? null : im.id }));
        return b;
      };
      const del = el('button', { type: 'button', className: 'ghost', textContent: '삭제' });
      del.addEventListener('click', () => deleteImage(im.id));
      return el(
        'figure',
        {},
        el('a', { className: 'thumb', href: im.url, target: '_blank', rel: 'noopener' }, el('img', { src: im.url, alt: `이미지 ${i + 1}`, loading: 'lazy' }), el('div', { className: 'badges' }, ...slots.map((k) => el('span', { textContent: `${SLOT_LABEL[k]} 자리` })))),
        el('figcaption', { textContent: im.source === 'ai' ? `AI · ${im.ratio} · ${styleLabel[im.style] ?? ''}` : '올린 사진' }),
        el('div', { className: 'img-actions' }, slotBtn('vertical'), slotBtn('feed'), del),
      );
    }),
  );
}

// 이미지가 바뀌면 이미 만든 결과물(카드·광고·상세)을 새 이미지로 다시 만든다
async function afterImageChange(prev) {
  renderEditor();
  await renderCards();
  if (prev?.ads) await renderAdImages();
  if (prev?.detailImages) {
    $('#detailImages').classList.add('loading');
    try {
      state.campaign = await api(`/api/campaigns/${state.campaign.id}/detail/render`, { method: 'POST', body: {} });
      renderDetail(state.campaign);
    } finally {
      $('#detailImages').classList.remove('loading');
    }
  }
}

async function imageAction(fn) {
  const prev = state.campaign;
  $('#gallery').classList.add('loading');
  showAlert('');
  try {
    state.campaign = await fn();
    await afterImageChange(prev);
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    $('#gallery').classList.remove('loading');
  }
}
const setSlots = (slots) => imageAction(() => api(`/api/campaigns/${state.campaign.id}/images/slots`, { method: 'PUT', body: slots }));
const deleteImage = (imgId) => confirm('이 이미지를 지울까요?') && imageAction(() => api(`/api/campaigns/${state.campaign.id}/images/${imgId}`, { method: 'DELETE' }));

$('#imageUpload').addEventListener('change', async () => {
  const file = $('#imageUpload').files[0];
  if (!file) return;
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  await imageAction(() => api(`/api/campaigns/${state.campaign.id}/images`, { method: 'POST', body: file, headers: { 'x-file-ext': ext } }));
  $('#imageUpload').value = '';
});

$('#genForm').addEventListener('submit', (e) => {
  e.preventDefault();
  guarded($('#makeImage'), '만드는 중… (10초 안팎)', () =>
    imageAction(() =>
      api(`/api/campaigns/${state.campaign.id}/images/generate`, {
        method: 'POST',
        body: { style: $('#imageStyle').value, ratio: $('#imageRatio').value, extra: $('#imageExtra').value, referenceId: $('#imageRef').value || undefined },
      }),
    ),
  );
});

// ── 문안 직접 수정 ──
// 필드: [경로, 라벨, 최대 글자, 여러 줄]
const COPY_LIMITS = { tag: 12, title: 21, subtitle: 20, promise: 26, cta: 16, painPoint: 22 };
const AD_FIELD_LIMITS = { overlay: 14, overlaySub: 22, headline: 20, description: 25, primaryText: 150 };
const DETAIL_L = { title: 24, body: 160, featureTitle: 16, featureBody: 70, proofItem: 40, q: 40, a: 120 };
let editing = null;

function openEdit(title, groups, onSave) {
  editing = { onSave, inputs: [] };
  $('#editTitle').textContent = title;
  $('#editError').textContent = '';
  $('#editFields').replaceChildren(
    ...groups.map(([heading, fields]) =>
      el(
        'div',
        { className: 'edit-group' },
        heading ? el('h3', { textContent: heading }) : null,
        ...fields.map(([label, value, max, multi]) => {
          const input = el(multi ? 'textarea' : 'input', { value: value ?? '', rows: multi ? (max > 100 ? 4 : 2) : undefined });
          if (multi) input.value = value ?? '';
          const count = el('span', { className: 'count' });
          const upd = () => {
            // 제목은 줄마다 10자(두 줄)
            const n = [...input.value].length;
            count.textContent = `${n}/${max}`;
            count.classList.toggle('over', n > max);
          };
          input.addEventListener('input', upd);
          upd();
          editing.inputs.push(input);
          return el('label', {}, label, count, input);
        }),
      ),
    ),
  );
  $('#editDialog').showModal();
}
$('#editCancel').addEventListener('click', () => $('#editDialog').close());
$('#editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const values = editing.inputs.map((i) => i.value);
  guarded($('#editSave'), '저장 중…', async () => {
    try {
      await editing.onSave(values);
      $('#editDialog').close();
    } catch (err) {
      $('#editError').textContent = err.message;
      throw err;
    }
  });
});

$('#editCopy').addEventListener('click', () => {
  const c = state.campaign;
  const copy = structuredClone(c.copy);
  const v = copy.variants[state.variant];
  openEdit(
    `카피 ${state.variant + 1}안 고치기`,
    [
      [null, [['태그', v.tag, COPY_LIMITS.tag], ['제목 (두 줄까지, 줄마다 10자)', v.title, COPY_LIMITS.title, true], ['부제', v.subtitle, COPY_LIMITS.subtitle], ['약속 한 문장', v.promise, COPY_LIMITS.promise], ['신청 문구', v.cta, COPY_LIMITS.cta]]],
      ['고민 (카드 2장)', copy.painPoints.map((p, i) => [`고민 ${i + 1}`, p, COPY_LIMITS.painPoint])],
      ['인스타그램 캡션', [['캡션', copy.caption, 2200, true]]],
    ],
    async (vals) => {
      [v.tag, v.title, v.subtitle, v.promise, v.cta] = vals;
      copy.painPoints = vals.slice(5, 5 + copy.painPoints.length);
      copy.caption = vals.at(-1);
      const out = await api(`/api/campaigns/${c.id}/copy`, { method: 'PUT', body: { copy } });
      state.campaign = out;
      showWarnings('#copyWarnings', out.warnings);
      renderEditor();
      await renderCards();
    },
  );
});

$('#editAds').addEventListener('click', () => {
  const c = state.campaign;
  const adCopy = structuredClone(c.adCopy);
  const a = adCopy.ads[state.adVariant];
  const keys = ['overlay', 'overlaySub', 'headline', 'description', 'primaryText'];
  const labels = { overlay: '이미지 큰 문구', overlaySub: '이미지 보조 문구', headline: '광고 제목', description: '광고 설명', primaryText: '광고 본문' };
  openEdit(`광고 ${state.adVariant + 1}안 고치기`, [[null, keys.map((k) => [labels[k], a[k], AD_FIELD_LIMITS[k], k === 'primaryText'])]], async (vals) => {
    keys.forEach((k, i) => (a[k] = vals[i]));
    state.campaign = await api(`/api/campaigns/${c.id}/ads/copy`, { method: 'PUT', body: { adCopy } });
    renderAds(state.campaign);
    await renderAdImages();
  });
});

$('#editDetail').addEventListener('click', () => {
  const c = state.campaign;
  const d = structuredClone(c.detail);
  const pair = (o, name) => [`${name} 제목`, o.title, DETAIL_L.title], body = (o, name) => [`${name} 본문`, o.body, DETAIL_L.body, true];
  openEdit(
    '상세페이지 문안 고치기',
    [
      ['① 문제공감', [pair(d.hook, '문제공감'), body(d.hook, '문제공감')]],
      ['② 핵심가치', [pair(d.value, '핵심가치'), body(d.value, '핵심가치')]],
      ['③ 특징', d.features.flatMap((f, i) => [[`특징 ${i + 1} 제목`, f.title, DETAIL_L.featureTitle], [`특징 ${i + 1} 설명`, f.body, DETAIL_L.featureBody, true]])],
      ['④ 근거', [['근거 제목', d.proof.title, DETAIL_L.title], ...d.proof.items.map((t, i) => [`근거 ${i + 1}`, t, DETAIL_L.proofItem])]],
      ['⑤ 자주 묻는 질문', d.faq.flatMap((f, i) => [[`질문 ${i + 1}`, f.q, DETAIL_L.q], [`답 ${i + 1}`, f.a, DETAIL_L.a, true]])],
      ['⑥ 신청', [pair(d.cta, '신청'), body(d.cta, '신청')]],
    ],
    async (vals) => {
      const it = vals[Symbol.iterator]();
      const next = () => it.next().value;
      for (const k of ['hook', 'value']) [d[k].title, d[k].body] = [next(), next()];
      for (const f of d.features) [f.title, f.body] = [next(), next()];
      d.proof.title = next();
      d.proof.items = d.proof.items.map(() => next());
      for (const f of d.faq) [f.q, f.a] = [next(), next()];
      [d.cta.title, d.cta.body] = [next(), next()];
      const id = c.id;
      const out = await api(`/api/campaigns/${id}/detail/copy`, { method: 'PUT', body: { detail: d } });
      state.campaign = out;
      renderDetail(out);
      showWarnings('#detailWarnings', out.warnings);
      $('#detailImages').classList.add('loading');
      try {
        state.campaign = await api(`/api/campaigns/${id}/detail/render`, { method: 'POST', body: {} });
        renderDetail(state.campaign);
      } finally {
        $('#detailImages').classList.remove('loading');
      }
    },
  );
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

  renderPlan();
  await renderTeam();
  const isOwner = state.me.user.role === 'owner';
  for (const f of ['#companyForm', '#brandForm']) $(f).querySelectorAll('input, textarea, button').forEach((x) => (x.disabled = !isOwner));
  $('#keyRows').querySelectorAll('input, button').forEach((x) => (x.disabled = !isOwner));
  $('#roleNote').textContent = isOwner ? '' : '팀원 계정: 회사 정보·브랜드·API 키는 소유자만 바꿀 수 있습니다';
  $('#deleteNote').textContent = isOwner
    ? '소유자가 탈퇴하면 이 회사의 캠페인·결과물·API 키·팀원 계정이 모두 즉시 삭제되며 되돌릴 수 없습니다. 필요한 결과물은 먼저 ZIP으로 내려받으세요.'
    : '팀원 계정만 삭제되고 회사 데이터는 남습니다.';

  const usage = await api('/api/usage');
  const KIND = { copy: '카피', ads: '광고 문구', detail: '상세페이지', import: '자료 가져오기', image: 'AI 이미지', key_test: '키 확인' };
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

// ── 요금제·팀원·계정 ──
function renderPlan() {
  const p = state.me.plan;
  const box = (title, value, sub) => el('div', {}, title, el('b', { textContent: value }), sub ? el('small', { textContent: sub }) : null);
  $('#planBox').replaceChildren(
    el(
      'div',
      { className: 'plan-grid' },
      box('현재 요금제', p.label, p.expired ? '이용 기간 끝남' : p.until ? `${new Date(p.until).toLocaleDateString('ko-KR')}까지` : '기간 제한 없음'),
      box('이번 달 캠페인', `${p.campaigns.used} / ${p.campaigns.limit}`),
      box('팀원', `${p.members.used} / ${p.members.limit}`),
    ),
    el('p', { className: 'note', textContent: '요금제 변경·연장은 운영자에게 문의하세요. AI 사용료는 등록한 API 키로 각 AI 회사가 청구합니다.' }),
  );
}

async function renderTeam() {
  const { members, invites } = await api('/api/members');
  const isOwner = state.me.user.role === 'owner';
  $('#members').replaceChildren(
    ...members.map((m) => {
      const out = el('button', { type: 'button', className: 'ghost small', textContent: '내보내기', hidden: !isOwner || m.role === 'owner' });
      out.addEventListener('click', async () => {
        if (!confirm(`${m.email} 계정을 삭제할까요?`)) return;
        await api(`/api/members/${m.id}`, { method: 'DELETE' }).catch((e) => showAlert(e.message, 'error'));
        await openSettings();
      });
      return el('li', {}, el('span', {}, `${m.name} `, el('small', { textContent: `${m.email} · ${m.role === 'owner' ? '소유자' : '팀원'}` })), out);
    }),
  );
  $('#inviteForm').hidden = !isOwner;
  $('#invites').replaceChildren(
    ...invites.map((i) => {
      const cancel = el('button', { type: 'button', className: 'ghost small', textContent: '취소' });
      cancel.addEventListener('click', async () => {
        await api(`/api/invites/${i.id}`, { method: 'DELETE' });
        await renderTeam();
      });
      return el('li', {}, el('span', {}, '초대 대기 ', el('small', { textContent: `${i.email} · ${new Date(i.expiresAt).toLocaleDateString('ko-KR')}까지` })), cancel);
    }),
  );
}

$('#inviteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('#inviteForm');
  guarded(f.querySelector('button'), '만드는 중…', async () => {
    const r = await api('/api/invites', { method: 'POST', body: { email: f.email.value } });
    const link = `${location.origin}${r.path}`;
    const box = $('#inviteLink');
    box.hidden = false;
    const copy = el('button', { type: 'button', className: 'ghost small', textContent: '링크 복사' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = '복사됨';
      } catch {
        copy.textContent = '직접 선택해 복사하세요';
      }
    });
    box.replaceChildren(el('div', { textContent: `${r.email} 초대 링크 (7일, 1회용)` }), el('code', { className: 'break', textContent: link }), ' ', copy);
    f.reset();
    await renderTeam();
  });
});

$('#pwForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('#pwForm');
  guarded(f.querySelector('button'), '바꾸는 중…', async () => {
    await api('/api/me/password', { method: 'PUT', body: { current: f.current.value, next: f.next.value } });
    f.reset();
    showAlert('비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끊었습니다.');
  });
});

$('#deleteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('#deleteForm');
  if (!confirm(state.me.user.role === 'owner' ? '회사의 모든 데이터가 삭제됩니다. 정말 탈퇴할까요?' : '계정을 삭제할까요?')) return;
  guarded(f.querySelector('button'), '삭제 중…', async () => {
    await api('/api/me', { method: 'DELETE', body: { password: f.password.value } });
    state.me = null;
    location.hash = '#/login';
    showAlert('탈퇴했습니다. 이용해 주셔서 감사합니다.');
  });
});

window.addEventListener('hashchange', route);
route();
