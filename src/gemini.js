'use strict';
/* Google Gemini API 클라이언트 (키는 호출 때마다 헤더로만 보낸다. 로그·URL에 남기지 않는다.) */

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

class GeminiError extends Error {
  constructor(code, message, status, detail) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;       // auth | quota | timeout | cancelled | network | model | blocked | bad_response | bad_request | server
    this.status = status || 0;
    this.detail = detail || '';
  }
}

function baseUrl() {
  const o = process.env.DPA_GEMINI_BASE;
  // 테스트용 모의 서버는 DPA_TEST=1 일 때만 허용한다. 평소에는 Google 주소로 고정.
  if (o && process.env.DPA_TEST === '1' && /^http:\/\/127\.0\.0\.1:\d+/.test(o)) return o.replace(/\/$/, '');
  return DEFAULT_BASE;
}

function redact(text, key) {
  let t = String(text || '');
  if (key) t = t.split(key).join('[키]');
  return t.replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[키]');
}

// ───────────── 모델 선택 (실행 시점에 models.list 로 확인) ─────────────
function parseModel(m) {
  const id = String(m.name || '').replace(/^models\//, '');
  const methods = m.supportedGenerationMethods || [];
  if (!/^gemini-/.test(id) || !methods.includes('generateContent')) return null;
  if (/embedding|tts|audio|live|robotics|computer-use|learnlm|aqa|gemma|translate|dialog/.test(id)) return null;
  const isImage = /image/.test(id);
  const ver = /gemini-(\d+(?:\.\d+)?)/.exec(id);
  const version = ver ? parseFloat(ver[1]) : (/latest/.test(id) ? 0.5 : 0);
  const tier = /flash-lite/.test(id) ? 'lite' : /pro/.test(id) ? 'pro' : /flash/.test(id) ? 'flash' : 'other';
  const stability = /exp|experimental/.test(id) ? 0 : /preview/.test(id) ? 1 : /latest/.test(id) ? 1.5 : 2;
  return { id, isImage, version, tier, stability };
}
function best(list, tier) {
  const c = list.filter((x) => x.tier === tier);
  c.sort((a, b) => b.version - a.version || b.stability - a.stability || a.id.length - b.id.length);
  return c[0] ? c[0].id : null;
}
function resolveModels(rawList) {
  const parsed = (rawList || []).map(parseModel).filter(Boolean);
  const text = parsed.filter((x) => !x.isImage);
  const image = parsed.filter((x) => x.isImage);
  const textNormal = best(text, 'flash') || best(text, 'pro') || best(text, 'lite');
  const textHigh = best(text, 'pro') || textNormal;
  const imageNormal = best(image, 'flash') || best(image, 'pro');
  const imageHigh = best(image, 'pro') || imageNormal;
  return {
    text: { normal: textNormal, high: textHigh },
    image: { normal: imageNormal, high: imageHigh },
    available: { text: text.map((x) => x.id).sort(), image: image.map((x) => x.id).sort() },
  };
}

// ───────────── 오류 해석 ─────────────
function mapHttpError(status, bodyText, key) {
  let msg = '';
  let statusStr = '';
  try {
    const j = JSON.parse(bodyText);
    msg = (j.error && j.error.message) || '';
    statusStr = (j.error && j.error.status) || '';
  } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
  msg = redact(msg, key).slice(0, 300);
  const low = (msg + ' ' + statusStr).toLowerCase();
  if (status === 400 && (low.includes('api key') || low.includes('api_key')) ) {
    return new GeminiError('auth', 'API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.', status, msg);
  }
  if (status === 401 || status === 403) {
    return new GeminiError('auth', 'API 키 인증에 실패했습니다. 키가 올바른지, 해당 모델 사용 권한이 있는지 확인해 주세요.', status, msg);
  }
  if (status === 404) return new GeminiError('model', '선택한 모델을 찾을 수 없습니다. 연결을 다시 시도하거나 다른 모델을 선택해 주세요.', status, msg);
  if (status === 429) return new GeminiError('quota', '사용량 한도를 넘었거나 요청이 너무 빠릅니다. 잠시 후 다시 시도하거나 Google AI Studio의 사용량·결제 상태를 확인해 주세요.', status, msg);
  if (status >= 500) return new GeminiError('server', 'Google 서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.', status, msg);
  if (status === 400) return new GeminiError('bad_request', '요청을 처리할 수 없습니다: ' + (msg || '입력 내용을 확인해 주세요.'), status, msg);
  return new GeminiError('bad_request', `예상하지 못한 응답입니다(HTTP ${status}).`, status, msg);
}

class GeminiClient {
  constructor(key) {
    this.key = key;
    this.base = baseUrl();
  }

  async _fetch(path, { method = 'GET', body, timeoutMs = 60000, signal } = {}) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: { 'x-goog-api-key': this.key, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw mapHttpError(res.status, text, this.key);
      try { return JSON.parse(text); } catch {
        throw new GeminiError('bad_response', 'Google 응답을 해석하지 못했습니다(JSON 형식이 아님).', res.status);
      }
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if (e && e.name === 'AbortError') {
        if (timedOut) throw new GeminiError('timeout', '응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
        throw new GeminiError('cancelled', '작업이 취소되었습니다.');
      }
      throw new GeminiError('network', '인터넷 또는 Google 서버에 연결하지 못했습니다. 네트워크(방화벽·프록시)를 확인해 주세요.', 0, redact(e && e.message, this.key));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async listModels() {
    const all = [];
    let token = '';
    for (let i = 0; i < 6; i++) {
      const j = await this._fetch('/models?pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { timeoutMs: 20000 });
      all.push(...(j.models || []));
      token = j.nextPageToken || '';
      if (!token) break;
    }
    return all;
  }

  /**
   * generateContent 호출.
   * opts: { model, parts, system, json, search, image, aspectRatio, temperature, maxOutputTokens, timeoutMs, signal }
   * 반환: { text, images:[{mimeType,data}], sources:[{title,uri}] }
   */
  async generate(opts) {
    const { model, parts, system, json, search, image, aspectRatio, temperature, maxOutputTokens, timeoutMs, signal } = opts;
    if (!model) throw new GeminiError('model', '사용할 수 있는 모델이 없습니다. API 연결을 다시 확인해 주세요.');
    const generationConfig = {};
    if (temperature != null) generationConfig.temperature = temperature;
    if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;
    if (json && !search) generationConfig.responseMimeType = 'application/json';
    if (image) {
      generationConfig.responseModalities = ['TEXT', 'IMAGE'];
      if (aspectRatio) generationConfig.imageConfig = { aspectRatio };
    }
    const body = { contents: [{ role: 'user', parts }], generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (search) body.tools = [{ google_search: {} }];
    const path = `/models/${encodeURIComponent(model)}:generateContent`;
    const call = (b) => this._fetch(path, { method: 'POST', body: b, timeoutMs: timeoutMs || 90000, signal });

    let data;
    try {
      data = await this._retry(() => call(body));
    } catch (e) {
      // 화면비 지정을 지원하지 않는 모델이면 지정 없이 한 번 더 시도한다.
      if (e instanceof GeminiError && e.code === 'bad_request' && generationConfig.imageConfig && /imageconfig|aspect/i.test(e.detail)) {
        const g2 = { ...generationConfig }; delete g2.imageConfig;
        data = await this._retry(() => call({ ...body, generationConfig: g2 }));
      } else throw e;
    }
    return this.parse(data, { wantImage: !!image });
  }

  async _retry(fn) {
    try { return await fn(); } catch (e) {
      if (e instanceof GeminiError && e.code === 'server') {
        await new Promise((r) => setTimeout(r, 1500));
        return fn();
      }
      throw e;
    }
  }

  parse(data, { wantImage } = {}) {
    if (!data || typeof data !== 'object') throw new GeminiError('bad_response', 'Google 응답이 비어 있습니다.');
    const pf = data.promptFeedback;
    if (pf && pf.blockReason) {
      throw new GeminiError('blocked', 'Google 안전 정책으로 요청이 차단되었습니다. 문구나 사진을 바꿔 다시 시도해 주세요.', 0, String(pf.blockReason));
    }
    const cand = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (!cand) throw new GeminiError('bad_response', 'Google이 결과를 돌려주지 않았습니다. 잠시 후 다시 시도해 주세요.');
    const fr = String(cand.finishReason || '');
    const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
    const text = parts.map((p) => (typeof p.text === 'string' && !p.thought ? p.text : '')).join('').trim();
    const images = [];
    for (const p of parts) {
      const d = p.inlineData || p.inline_data;
      if (d && d.data && /^image\//.test(d.mimeType || d.mime_type || '')) images.push({ mimeType: d.mimeType || d.mime_type, data: d.data });
    }
    if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION|IMAGE_SAFETY/.test(fr) && !text && images.length === 0) {
      throw new GeminiError('blocked', 'Google 안전 정책으로 결과가 생성되지 않았습니다. 문구나 사진을 바꿔 다시 시도해 주세요.', 0, fr);
    }
    if (wantImage && images.length === 0) {
      throw new GeminiError('bad_response', '이미지가 생성되지 않았습니다. 다시 시도해 주세요.' + (text ? ` (모델 응답: ${text.slice(0, 80)})` : ''), 0, fr);
    }
    if (!wantImage && !text) throw new GeminiError('bad_response', 'Google이 빈 응답을 돌려주었습니다. 다시 시도해 주세요.', 0, fr);
    const gm = cand.groundingMetadata || {};
    const sources = [];
    const seen = new Set();
    for (const c of gm.groundingChunks || []) {
      const w = c && c.web;
      if (w && w.uri && !seen.has(w.uri)) { seen.add(w.uri); sources.push({ title: String(w.title || w.uri).slice(0, 160), uri: String(w.uri) }); }
    }
    return { text, images, sources, finishReason: fr };
  }
}

module.exports = { GeminiClient, GeminiError, resolveModels, redact, DEFAULT_BASE };
