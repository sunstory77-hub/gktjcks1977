// 홍보공장 웹 화면: 입력 → 카피 선택 → 카드뉴스 미리보기(템플릿 전환) → 릴스 렌더 → ZIP.
const $ = (sel) => document.querySelector(sel);
const form = $('#brief');
const LIST_FIELDS = ['painPoints', 'curriculum', 'benefits'];

const state = { copy: null, variant: 0, template: 'bold', job: null, meta: null, previewSeq: 0, imageId: null };

async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: body instanceof Blob || body instanceof ArrayBuffer ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : body instanceof Blob || body instanceof ArrayBuffer ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function showAlert(msg, kind = 'warn') {
  const el = $('#alert');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = `alert ${kind === 'error' ? 'error' : ''}`;
}

function setStep(n) {
  document.querySelectorAll('#steps li').forEach((li) => li.classList.toggle('on', Number(li.dataset.step) === n));
}

function readBrief() {
  const fd = new FormData(form);
  const brief = {};
  for (const [k, v] of fd.entries()) brief[k] = LIST_FIELDS.includes(k) ? v.split('\n').map((s) => s.trim()).filter(Boolean) : v;
  return brief;
}

function fillBrief(brief) {
  for (const el of form.elements) {
    if (!el.name || !(el.name in brief)) continue;
    const v = brief[el.name];
    el.value = Array.isArray(v) ? v.join('\n') : v;
  }
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.innerHTML = `<span class="spinner"></span> ${label}`;
  } else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

// ── 1) 카피 ──
function renderVariants() {
  const box = $('#variants');
  box.replaceChildren(
    ...state.copy.variants.map((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'variant';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === state.variant));
      const angle = document.createElement('div');
      angle.className = 'angle';
      angle.textContent = `${i + 1}안 · ${v.angle}`;
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = v.title;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = [v.subtitle, v.cta].filter(Boolean).join(' · ');
      b.append(angle, title, sub);
      b.addEventListener('click', () => {
        if (state.variant === i) return;
        state.variant = i;
        renderVariants();
        preview();
      });
      return b;
    }),
  );
  $('#caption').textContent = `${state.copy.caption}\n\n${state.copy.hashtags.map((t) => `#${t}`).join(' ')}`;
  $('#copySource').textContent = state.copy.source === 'offline' ? '입력 문구 기반' : `AI 생성 (${state.copy.source.replace('ai:', '')})`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const btn = $('#makeCopy');
  busy(btn, true, $('#useAi').checked ? 'Claude가 작성 중…' : '준비 중…');
  showAlert('');
  try {
    const { copy, warning } = await api('/api/copy', { method: 'POST', body: { brief: readBrief(), ai: $('#useAi').checked } });
    state.copy = copy;
    state.variant = 0;
    if (warning) showAlert(warning);
    $('#empty').hidden = true;
    $('#copySection').hidden = false;
    renderVariants();
    setStep(2);
    // 좁은 화면에서는 결과가 입력란 아래에 있으므로 결과로 이동
    if (matchMedia('(max-width: 860px)').matches) $('#copySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await preview();
  } catch (err) {
    showAlert(err.message, 'error');
  } finally {
    busy(btn, false);
  }
});

// ── 2) 카드뉴스 미리보기 ──
function renderTemplates() {
  $('#templates').replaceChildren(
    ...state.meta.templates.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t.name === state.template));
      b.title = t.label;
      b.textContent = t.name;
      b.addEventListener('click', () => {
        if (state.template === t.name) return;
        state.template = t.name;
        renderTemplates();
        preview();
      });
      return b;
    }),
  );
}

async function preview() {
  const seq = ++state.previewSeq; // 빠르게 여러 번 눌러도 마지막 요청 결과만 반영
  const cards = $('#cards');
  $('#previewSection').hidden = false;
  cards.classList.add('loading');
  try {
    const job = await api('/api/preview', {
      method: 'POST',
      body: { brief: readBrief(), copy: state.copy, variant: state.variant, template: state.template, imageId: state.imageId },
    });
    if (seq !== state.previewSeq) return;
    state.job = job;
    cards.replaceChildren(
      ...job.cards.map((url, i) => {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.download = `card_${i + 1}.png`;
        const img = document.createElement('img');
        img.src = url;
        img.alt = `카드뉴스 ${i + 1}장`;
        a.append(img);
        return a;
      }),
    );
    $('#reelSection').hidden = false;
    $('#zip').href = job.zip;
    $('#reel').hidden = true;
    $('#reel').removeAttribute('src');
    setReelStatus('');
    setStep(3);
  } catch (err) {
    if (seq === state.previewSeq) showAlert(err.message, 'error');
  } finally {
    if (seq === state.previewSeq) cards.classList.remove('loading');
  }
}

// ── 3) 릴스 ──
function setReelStatus(text, kind = '') {
  const el = $('#reelStatus');
  el.className = `status ${kind}`;
  el.innerHTML = '';
  if (kind === 'busy') {
    const s = document.createElement('span');
    s.className = 'spinner';
    el.append(s, ' ');
  }
  el.append(text);
}

async function uploadBgm() {
  const file = $('#bgm').files[0];
  if (!file) return undefined;
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const { bgmId } = await api('/api/bgm', { method: 'POST', body: file, headers: { 'x-file-ext': ext } });
  return bgmId;
}

$('#makeReel').addEventListener('click', async () => {
  if (!state.job) return;
  const btn = $('#makeReel');
  const jobId = state.job.jobId;
  busy(btn, true, '렌더링 중…');
  try {
    const bgmId = await uploadBgm();
    await api(`/api/jobs/${jobId}/reel`, { method: 'POST', body: { bgmId } });
    const started = Date.now();
    for (;;) {
      const job = await api(`/api/jobs/${jobId}`);
      if (state.job?.jobId !== jobId) return; // 도중에 미리보기를 바꾼 경우
      const sec = Math.round((Date.now() - started) / 1000);
      if (job.reel.status === 'done') {
        const v = $('#reel');
        v.src = job.reel.url;
        v.hidden = false;
        setReelStatus(`완료 (${sec}초). ZIP에 릴스가 포함됩니다.`, 'ok');
        setStep(4);
        break;
      }
      if (job.reel.status === 'error') throw new Error(job.reel.error);
      setReelStatus(job.reel.status === 'queued' ? `대기 중… ${sec}초` : `렌더링 중… ${sec}초 (보통 30초 안팎)`, 'busy');
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    setReelStatus(err.message, 'error');
  } finally {
    busy(btn, false);
  }
});

$('#copyCaption').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#caption').textContent);
    $('#copyCaption').textContent = '복사됨';
  } catch {
    $('#copyCaption').textContent = '직접 선택해 복사하세요';
  }
  setTimeout(() => ($('#copyCaption').textContent = '캡션 복사'), 1500);
});

// ── 표지 사진 ──
$('#cover').addEventListener('change', async () => {
  const file = $('#cover').files[0];
  if (!file) return;
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  showAlert('');
  try {
    const { imageId } = await api('/api/image', { method: 'POST', body: file, headers: { 'x-file-ext': ext } });
    state.imageId = imageId;
    $('#coverThumb').src = URL.createObjectURL(file);
    $('#coverPreview').hidden = false;
    if (state.copy) await preview();
  } catch (err) {
    $('#cover').value = '';
    showAlert(err.message, 'error');
  }
});

$('#coverRemove').addEventListener('click', async () => {
  state.imageId = null;
  $('#cover').value = '';
  $('#coverPreview').hidden = true;
  if (state.copy) await preview();
});

$('#loadSample').addEventListener('click', () => fillBrief(state.meta.sampleBrief));

// 초기화
state.meta = await api('/api/meta');
renderTemplates();
