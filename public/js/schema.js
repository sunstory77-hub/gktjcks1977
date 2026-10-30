/* DETAIL PAGE AI — 프로젝트 구조(스키마). 브라우저와 Node 서버가 함께 사용한다. by BAPI */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DPA_SCHEMA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;

  const BLOCK_TYPES = [
    { type: 'info', label: '상품 정보' },
    { type: 'promo', label: '프로모션' },
    { type: 'hero', label: '대표 이미지' },
    { type: 'headline', label: '헤드라인·고객 고민' },
    { type: 'mood', label: '감성·사용 장면' },
    { type: 'intro', label: '상품 소개' },
    { type: 'features', label: '주요 특징' },
    { type: 'gallery', label: '상품 화보' },
    { type: 'usage', label: '활용·사용 방법' },
    { type: 'detail', label: '디테일' },
    { type: 'faq', label: 'FAQ·규격' },
    { type: 'cta', label: '구매 제안' },
  ];
  const TYPE_SET = new Set(BLOCK_TYPES.map((b) => b.type));
  const LABELS = Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b.label]));

  // 블록별 이미지 슬롯(키, 화면비). 슬롯 id는 블록 안에서 안정적으로 유지된다.
  const SLOT_DEFS = {
    hero: [{ key: 'main', aspect: '4:5' }],
    mood: [{ key: 'scene', aspect: '3:2' }],
    features: [{ key: 'feature', aspect: '1:1' }],
    gallery: [{ key: 'g1', aspect: '1:1' }, { key: 'g2', aspect: '1:1' }, { key: 'g3', aspect: '1:1' }],
    usage: [{ key: 'use', aspect: '4:3' }],
    detail: [{ key: 'd1', aspect: '1:1' }, { key: 'd2', aspect: '1:1' }],
  };

  const LIMITS = {
    short: 80, mid: 200, long: 1500, label: 40,
    points: 4, items: 6, steps: 5, faqs: 6, specs: 10, rows: 8, blocks: 30, photos: 5,
  };

  const ID_RE = /^[a-z0-9_-]{6,48}$/;

  function newId(prefix) {
    let hex = '';
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) {
      const a = new Uint8Array(8);
      c.getRandomValues(a);
      hex = Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
    } else {
      for (let i = 0; i < 16; i++) hex += Math.floor(Math.random() * 16).toString(16);
    }
    return (prefix || 'x') + '_' + hex;
  }

  // ───────────── 문자열 도구 ─────────────
  function str(v, max) {
    if (v == null) return '';
    let s = typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : '';
    s = s.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    s = s.trim();
    if (max && s.length > max) s = s.slice(0, max).trim();
    return s;
  }
  function splitSentences(text) {
    return str(text, 20000)
      .split(/\n+|(?<=[.!?。])\s+/)
      .map((s) => s.replace(/^[\s·•\-*▪■□✔✓]+/, '').trim())
      .filter(Boolean);
  }
  function firstSentence(text, max) {
    const s = splitSentences(text)[0] || '';
    return s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
  }

  // ───────────── 색상(상품마다 다른 연출) ─────────────
  const PALETTES = [
    { id: 'rose', keys: ['화장품', '뷰티', '스킨', '크림', '세럼', '에센스', '립', '향수', '마스크팩', '바디', '샴푸', '헤어'],
      bg: '#FBF5F6', surface: '#FFFFFF', tint: '#F6E6EA', ink: '#2B1E24', sub: '#6F5A62', accent: '#B8456B', accent2: '#E8A5B8', onAccent: '#FFFFFF', radius: 28 },
    { id: 'warm', keys: ['식품', '과자', '간식', '커피', '차', '음료', '건강', '영양', '쌀', '김치', '반찬', '소스', '빵', '디저트', '견과', '과일'],
      bg: '#FFF8EE', surface: '#FFFFFF', tint: '#FBE9CF', ink: '#2D2013', sub: '#6B5842', accent: '#D4701F', accent2: '#F2B66B', onAccent: '#FFFFFF', radius: 24 },
    { id: 'stone', keys: ['의류', '패션', '옷', '가방', '신발', '모자', '시계', '주얼리', '액세서리', '니트', '셔츠', '원피스'],
      bg: '#F4F2EE', surface: '#FFFFFF', tint: '#E7E3DB', ink: '#1C1B19', sub: '#625E56', accent: '#2A2724', accent2: '#B9A88A', onAccent: '#FFFFFF', radius: 6 },
    { id: 'tech', keys: ['가전', '전자', '디지털', '충전', '이어폰', '스피커', '노트북', '케이블', '카메라', '모니터', '청소기', '로봇'],
      bg: '#F2F5FB', surface: '#FFFFFF', tint: '#DFE8FA', ink: '#101828', sub: '#4B5A75', accent: '#2D62F0', accent2: '#7FA6FF', onAccent: '#FFFFFF', radius: 16 },
    { id: 'pet', keys: ['반려', '펫', '강아지', '고양이', '사료', '애견', '애묘'],
      bg: '#F3F8F1', surface: '#FFFFFF', tint: '#DDEBD7', ink: '#1B2A1B', sub: '#4F6650', accent: '#3E8E4D', accent2: '#A5D6A7', onAccent: '#FFFFFF', radius: 30 },
    { id: 'kids', keys: ['아기', '유아', '키즈', '어린이', '아동', '신생아', '장난감', '완구'],
      bg: '#FFFBEA', surface: '#FFFFFF', tint: '#FFF0B8', ink: '#2B2A1B', sub: '#6A6640', accent: '#F2A900', accent2: '#8ADBC3', onAccent: '#2B2A1B', radius: 34 },
    { id: 'living', keys: ['주방', '생활', '인테리어', '리빙', '수납', '조명', '침구', '욕실', '청소', '가구', '캔들', '화분'],
      bg: '#F5F6F1', surface: '#FFFFFF', tint: '#E3E7D8', ink: '#222619', sub: '#5C634C', accent: '#6B7F3A', accent2: '#C2CD97', onAccent: '#FFFFFF', radius: 20 },
    { id: 'sport', keys: ['운동', '스포츠', '헬스', '요가', '러닝', '골프', '캠핑', '등산', '자전거', '낚시'],
      bg: '#111827', surface: '#1B2436', tint: '#243049', ink: '#F4F7FB', sub: '#A7B3C9', accent: '#B8F03A', accent2: '#4ADE80', onAccent: '#111827', radius: 12, dark: true },
  ];
  const NEUTRAL = [
    { id: 'ocean', bg: '#F1F7F9', surface: '#FFFFFF', tint: '#D9ECF1', ink: '#0F2A33', sub: '#4A6770', accent: '#1B7F95', accent2: '#8ACBD8', onAccent: '#FFFFFF', radius: 22 },
    { id: 'plum', bg: '#F7F3FA', surface: '#FFFFFF', tint: '#E9DDF3', ink: '#25182F', sub: '#625070', accent: '#7A45B0', accent2: '#C7A7E6', onAccent: '#FFFFFF', radius: 24 },
    { id: 'clay', bg: '#FAF4F0', surface: '#FFFFFF', tint: '#F0DED3', ink: '#2B1C15', sub: '#6E5547', accent: '#B5532F', accent2: '#E6A98C', onAccent: '#FFFFFF', radius: 18 },
  ];

  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

  function pickPalette(product) {
    const p = product || {};
    const text = [p.category, p.name, p.description, p.target].map((x) => str(x, 600)).join(' ');
    let best = null, bestScore = 0;
    for (const pal of PALETTES) {
      let score = 0;
      for (const k of pal.keys) if (text.includes(k)) score += 1 + (str(p.name, 200).includes(k) ? 2 : 0);
      if (score > bestScore) { best = pal; bestScore = score; }
    }
    const base = best || NEUTRAL[hash(str(p.name, 200) || 'x') % NEUTRAL.length];
    const { keys, ...pal } = base; // eslint-disable-line no-unused-vars
    return pal;
  }

  function hexToRgb(h) {
    const m = /^#([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(h) {
    const c = hexToRgb(h);
    if (!c) return 0;
    const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  function contrast(a, b) {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()); }

  // AI가 제안한 색을 검증하고, 읽기 어려우면 기본 팔레트 값으로 되돌린다.
  function mergePalette(base, proposed) {
    const out = { ...base };
    if (proposed && typeof proposed === 'object') {
      for (const k of ['bg', 'surface', 'tint', 'ink', 'sub', 'accent', 'accent2']) {
        if (isHex(proposed[k])) out[k] = proposed[k].trim().toUpperCase();
      }
      if (isHex(proposed.onAccent)) out.onAccent = proposed.onAccent.trim().toUpperCase();
    }
    out.dark = luminance(out.bg) < 0.25;
    if (contrast(out.ink, out.bg) < 4.5) out.ink = base.ink;
    if (contrast(out.ink, out.bg) < 4.5) out.ink = out.dark ? '#F4F7FB' : '#1A1A1A';
    if (contrast(out.sub, out.bg) < 3.2) out.sub = base.sub;
    if (contrast(out.ink, out.surface) < 4.5) out.surface = out.bg;
    if (contrast(out.onAccent, out.accent) < 3.5) out.onAccent = luminance(out.accent) > 0.4 ? '#1A1A1A' : '#FFFFFF';
    out.radius = Math.max(4, Math.min(40, Number(out.radius) || 20));
    return out;
  }

  // ───────────── 블록 필드 정규화 ─────────────
  const S = str;
  function list(arr, max, fn) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const x of arr) {
      const v = fn(x);
      if (v) out.push(v);
      if (out.length >= max) break;
    }
    return out;
  }
  let PAIR_SCALE = 1; // normalizeFields 호출 동안만 사용하는 스케일(동기 호출이라 안전)
  function pair(x, a, b, maxA, maxB) {
    if (!x || typeof x !== 'object') return null;
    const o = { [a]: str(x[a], maxA && Math.round(maxA * PAIR_SCALE)), [b]: str(x[b], maxB && Math.round(maxB * PAIR_SCALE)) };
    return o[a] || o[b] ? o : null;
  }

  // scale: 번역문은 한국어보다 길어질 수 있어 문자열 한도를 늘려 적용한다(잘림 방지).
  function normalizeFieldsInner(type, f, scale) {
    f = f && typeof f === 'object' ? f : {};
    const k = scale || 1;
    const S = (v, max) => str(v, max ? Math.round(max * k) : max);
    switch (type) {
      case 'info': return { eyebrow: S(f.eyebrow, LIMITS.label), title: S(f.title, LIMITS.short), subtitle: S(f.subtitle, LIMITS.mid), rows: list(f.rows, LIMITS.rows, (x) => pair(x, 'label', 'value', LIMITS.label, LIMITS.mid)) };
      case 'promo': return { badge: S(f.badge, LIMITS.label), title: S(f.title, LIMITS.short), desc: S(f.desc, LIMITS.mid) };
      case 'hero': return { title: S(f.title, LIMITS.short), subtitle: S(f.subtitle, LIMITS.mid) };
      case 'headline': return { kicker: S(f.kicker, LIMITS.label), title: S(f.title, LIMITS.mid), points: list(f.points, LIMITS.points, (x) => S(x, LIMITS.mid) || null) };
      case 'mood': return { title: S(f.title, LIMITS.short), text: S(f.text, LIMITS.long) };
      case 'intro': return { title: S(f.title, LIMITS.short), body: S(f.body, LIMITS.long) };
      case 'features': return { title: S(f.title, LIMITS.short), items: list(f.items, LIMITS.items, (x) => pair(x, 'title', 'desc', LIMITS.short, LIMITS.mid)) };
      case 'gallery': return { title: S(f.title, LIMITS.short), caption: S(f.caption, LIMITS.mid) };
      case 'usage': return { title: S(f.title, LIMITS.short), steps: list(f.steps, LIMITS.steps, (x) => pair(x, 'title', 'desc', LIMITS.short, LIMITS.mid)) };
      case 'detail': return { title: S(f.title, LIMITS.short), items: list(f.items, 4, (x) => pair(x, 'title', 'desc', LIMITS.short, LIMITS.mid)) };
      case 'faq': return { title: S(f.title, LIMITS.short), faqs: list(f.faqs, LIMITS.faqs, (x) => pair(x, 'q', 'a', LIMITS.mid, LIMITS.long)), specTitle: S(f.specTitle, LIMITS.short), specs: list(f.specs, LIMITS.specs, (x) => pair(x, 'label', 'value', LIMITS.label, LIMITS.mid)) };
      case 'cta': return { title: S(f.title, LIMITS.short), desc: S(f.desc, LIMITS.mid), buttonLabel: S(f.buttonLabel, LIMITS.label), buttonUrl: S(f.buttonUrl, 500) };
      default: return {};
    }
  }

  function normalizeFields(type, f, scale) {
    const prev = PAIR_SCALE;
    PAIR_SCALE = scale || 1;
    try { return normalizeFieldsInner(type, f, scale); } finally { PAIR_SCALE = prev; }
  }

  function emptyFields(type) { return normalizeFields(type, {}); }

  function makeSlots(type, blockId) {
    return (SLOT_DEFS[type] || []).map((d) => ({ id: blockId + '_' + d.key, key: d.key, aspect: d.aspect, assetId: null, source: 'none', deleted: false, prompt: '' }));
  }

  function blockHasContent(block) {
    const f = block.fields || {};
    const hasText = JSON.stringify(f, (k, v) => (v === '' ? undefined : v)).replace(/[\s{}\[\]",:]|null/g, '').length > 0;
    const hasImg = (block.images || []).some((s) => s.assetId && !s.deleted);
    return hasText || hasImg;
  }

  function sanitizeSlot(s, blockId, idx, type) {
    s = s && typeof s === 'object' ? s : {};
    const def = (SLOT_DEFS[type] || [])[idx] || {};
    const id = typeof s.id === 'string' && ID_RE.test(s.id) ? s.id : blockId + '_' + (def.key || 'i' + idx);
    return {
      id,
      key: S(s.key, 20) || def.key || 'i' + idx,
      aspect: /^\d{1,2}:\d{1,2}$/.test(s.aspect || '') ? s.aspect : (def.aspect || '1:1'),
      assetId: typeof s.assetId === 'string' && ID_RE.test(s.assetId) ? s.assetId : null,
      source: ['none', 'photo', 'ai', 'user'].includes(s.source) ? s.source : 'none',
      deleted: !!s.deleted,
      prompt: S(s.prompt, 1200),
    };
  }

  function sanitizeBlock(b) {
    if (!b || typeof b !== 'object' || !TYPE_SET.has(b.type)) return null;
    const id = typeof b.id === 'string' && ID_RE.test(b.id) ? b.id : newId('b');
    const want = (SLOT_DEFS[b.type] || []).length;
    const imgs = Array.isArray(b.images) ? b.images.slice(0, 8) : [];
    const images = imgs.map((s, i) => sanitizeSlot(s, id, i, b.type));
    while (images.length < want) images.push(makeSlots(b.type, id)[images.length]);
    return { id, type: b.type, hidden: !!b.hidden, fields: normalizeFields(b.type, b.fields), images };
  }

  function sanitizeBrief(br, product) {
    br = br && typeof br === 'object' ? br : {};
    const base = pickPalette(product);
    return {
      category: S(br.category, LIMITS.label),
      mood: S(br.mood, LIMITS.mid),
      tone: S(br.tone, LIMITS.mid),
      imageStyle: S(br.imageStyle, 400),
      palette: mergePalette(base, br.palette),
    };
  }

  function sanitizeProduct(p) {
    p = p && typeof p === 'object' ? p : {};
    return {
      name: S(p.name, 200), description: S(p.description, 12000), target: S(p.target, 1000),
      price: S(p.price, 200), spec: S(p.spec, 3000), shipping: S(p.shipping, 1500), promo: S(p.promo, 1500),
    };
  }

  function sanitizeProject(p) {
    p = p && typeof p === 'object' ? p : {};
    const product = sanitizeProduct(p.product);
    const photos = list(p.photos, LIMITS.photos, (x) => (x && typeof x.assetId === 'string' && ID_RE.test(x.assetId) ? { assetId: x.assetId, name: S(x.name, 120) } : null));
    const blocks = list(p.blocks, LIMITS.blocks, sanitizeBlock);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : newId('p'),
      name: S(p.name, 120) || product.name || '새 상세페이지',
      rev: Number.isInteger(p.rev) && p.rev >= 0 ? p.rev : 0,
      createdAt: S(p.createdAt, 40) || new Date().toISOString(),
      updatedAt: S(p.updatedAt, 40) || new Date().toISOString(),
      product,
      photos,
      mode: p.mode === 'high' ? 'high' : 'normal',
      brief: sanitizeBrief(p.brief, product),
      blocks,
      i18n: sanitizeI18n(p.i18n),
    };
  }

  // ───────────── 다국어(번역·검수) ─────────────
  // 1차 지원: 영어·일본어·중국어(간체). 언어를 더 늘리려면 이 목록에 항목(글꼴 포함)을 추가한다.
  const LANGS = [
    { code: 'ko', name: '한국어', native: '한국어', source: true, family: '"Pretendard Variable", Pretendard', wrap: 'ko', htmlLang: 'ko' },
    { code: 'en', name: '영어', native: 'English', ai: 'English (American English, natural e-commerce marketing tone)', family: '"Pretendard Variable", Pretendard', wrap: 'latin', htmlLang: 'en', short: 'EN' },
    { code: 'ja', name: '일본어', native: '日本語', ai: 'Japanese (polite です・ます style, natural for Japanese e-commerce product pages)', family: '"Noto Sans JP Variable"', wrap: 'cjk', htmlLang: 'ja', short: 'JA' },
    { code: 'zh-CN', name: '중국어(간체)', native: '简体中文', ai: 'Simplified Chinese (Mainland China usage and vocabulary, natural for Chinese e-commerce)', family: '"Noto Sans SC Variable"', wrap: 'cjk', htmlLang: 'zh-CN', short: 'ZH' },
  ];
  const LANG_BY = Object.fromEntries(LANGS.map((l) => [l.code, l]));
  const TARGET_LANGS = LANGS.filter((l) => !l.source);
  const TR_STATUS = ['ai', 'edited', 'review', 'approved'];
  const STATUS_LABEL = { none: '미번역', ai: 'AI 초안', edited: '직접 수정', review: '검수 요청', approved: '검수 완료', stale: '원문 변경' };
  const TR_SCALE = 3; // 번역문 문자열 한도 배율

  // 번역 대상 문자열을 평탄화: [{ path:'items.0.title', text }] (구매 링크는 제외)
  function flatten(obj, prefix, out) {
    out = out || []; prefix = prefix || '';
    if (typeof obj === 'string') { if (obj.trim()) out.push({ path: prefix, text: obj }); return out; }
    if (Array.isArray(obj)) { obj.forEach((v, i) => flatten(v, prefix ? prefix + '.' + i : String(i), out)); return out; }
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) { if (k === 'buttonUrl') continue; flatten(v, prefix ? prefix + '.' + k : k, out); }
    }
    return out;
  }
  function getPath(obj, path) {
    let cur = obj;
    for (const k of String(path).split('.')) { if (cur == null) return undefined; cur = cur[k]; }
    return cur;
  }
  function setPath(obj, path, val) {
    const keys = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i], nextIsIdx = /^\d+$/.test(keys[i + 1]);
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = nextIsIdx ? [] : {};
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = val;
  }
  function fieldsHash(type, fields) {
    const flat = flatten(normalizeFields(type, fields)).map((x) => x.path + '=' + x.text).join('\n');
    let h = 0x811c9dc5;
    for (let i = 0; i < flat.length; i++) { h ^= flat.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }
  const needsTranslation = (block) => flatten(block.fields).length > 0;
  const getLangData = (project, lang) => (project && project.i18n && project.i18n.data && project.i18n.data[lang]) || null;
  const getTr = (project, lang, type) => { const d = getLangData(project, lang); return (d && d.blocks && d.blocks[type]) || null; };

  // 블록 하나의 번역 상태: n/a | none | stale | ai | edited | review | approved
  function trStatus(project, lang, block) {
    if (!needsTranslation(block)) return 'n/a';
    const rec = getTr(project, lang, block.type);
    if (!rec) return 'none';
    if (rec.srcHash !== fieldsHash(block.type, block.fields)) return 'stale';
    return rec.status;
  }

  // 특정 언어로 보이는 블록(번역문·언어별 이미지·언어별 숨김 반영).
  // 번역 레코드는 '경로 → 문장' 평면 맵이라 구조가 항상 원문과 같다. 번역이 없는 경로는 한국어 원문을 그대로 보여 주고 점검에서 경고한다.
  function applyTr(type, koFields, tmap) {
    const out = JSON.parse(JSON.stringify(koFields));
    for (const { path } of flatten(koFields)) {
      const v = tmap && tmap[path];
      if (typeof v === 'string' && v.trim()) setPath(out, path, v);
    }
    return out;
  }
  function localizeBlock(project, lang, block) {
    if (!lang || lang === 'ko') return block;
    const d = getLangData(project, lang) || {};
    const rec = d.blocks && d.blocks[block.type];
    let fields = block.fields;
    if (rec) {
      fields = applyTr(block.type, block.fields, rec.t);
      if (block.type === 'cta') fields.buttonUrl = (d.market && d.market.buyUrl) || block.fields.buttonUrl || '';
    }
    const images = block.images.map((s) => {
      const o = d.imgs && d.imgs[block.type + ':' + s.key];
      return o ? { ...s, assetId: o.assetId, source: o.source, deleted: false } : s;
    });
    const hidden = !!(block.hidden || (d.hidden && d.hidden[block.type]));
    return { ...block, fields, images, hidden, __untranslated: !rec && needsTranslation(block) };
  }

  const PATH_WORDS = {
    title: '제목', desc: '설명', items: '항목', steps: '단계', faqs: '질문', specs: '규격', rows: '핵심 정보', points: '고객 고민', body: '본문', text: '문장',
    subtitle: '보조 문구', caption: '설명', kicker: '작은 제목', eyebrow: '분류', badge: '배지', label: '항목명', value: '내용', q: '질문', a: '답변',
    buttonLabel: '버튼 문구', specTitle: '규격 제목',
  };
  // 'items.0.title' → '항목 › 1 › 제목' (사람이 읽는 항목 이름)
  function prettyPath(path) {
    return String(path).split('.').map((k) => (/^\d+$/.test(k) ? String(Number(k) + 1) : (PATH_WORDS[k] || k))).join(' › ');
  }

  const HANGUL = /[ᄀ-ᇿㄱ-ㆎ가-힣]/;
  const normNum = (t) => String(t).normalize('NFKC');
  function numTokens(text) {
    const out = [];
    for (const m of normNum(text).matchAll(/\d+(?:[.,]\d+)*/g)) out.push(m[0].replace(/,/g, ''));
    return out;
  }

  // 번역 품질 자동 점검: 누락·숫자 불일치·한글 잔존·용어집·길이. 사람이 검수할 때 우선 볼 곳을 알려 준다.
  function qaCheck(project, lang, block) {
    const rec = getTr(project, lang, block.type);
    if (!rec || !needsTranslation(block)) return [];
    const d = getLangData(project, lang) || {};
    const market = d.market || {};
    const glossary = (project.i18n && project.i18n.glossary) || [];
    const meta = LANG_BY[lang] || {};
    const warns = [];
    const koFlat = flatten(block.fields);
    const trFlat = rec.t || {};
    const dntKo = glossary.filter((g) => g.dnt && g.ko).map((g) => g.ko);
    const productName = project.product && project.product.name;
    for (const { path, text: ko } of koFlat) {
      const tr = trFlat[path];
      if (!tr || !String(tr).trim()) { warns.push({ code: 'missing', path, msg: '번역이 비어 있습니다' }); continue; }
      // 숫자: 원문의 숫자가 번역문에 그대로 있어야 한다(가격은 현지 가격 입력 시 제외, 한글 단위 만·천·억 포함은 제외)
      const skipNum = /\d\s*[만천억]/.test(ko) || (market.price && /[원₩]|KRW/.test(ko));
      if (!skipNum) {
        const have = new Set(numTokens(tr));
        const miss = numTokens(ko).filter((n) => !have.has(n));
        if (miss.length) warns.push({ code: 'number', path, msg: `원문 숫자(${[...new Set(miss)].join(', ')})가 번역문에 없습니다` });
      }
      // 한글 잔존(번역 금지 용어의 한글은 제외)
      let probe = tr;
      for (const t of dntKo) probe = probe.split(t).join('');
      if (productName) probe = probe.split(productName).join('');
      if (HANGUL.test(probe)) warns.push({ code: 'hangul', path, msg: '번역문에 한글이 남아 있습니다' });
      // 길이: 레이아웃이 깨질 만큼 길어졌는지
      const limit = meta.wrap === 'latin' ? 2.8 : 1.8;
      if (ko.length >= 20 && tr.length > ko.length * limit) warns.push({ code: 'long', path, msg: '원문보다 훨씬 길어 레이아웃이 어긋날 수 있습니다' });
      // 용어집
      for (const g of glossary) {
        if (!g.ko || !ko.includes(g.ko)) continue;
        if (g.dnt) { if (!tr.includes(g.ko)) warns.push({ code: 'dnt', path, msg: `번역 금지 용어 ‘${g.ko}’가 그대로 있어야 합니다` }); }
        else if (g.tr && g.tr[lang] && !tr.toLowerCase().includes(String(g.tr[lang]).toLowerCase())) warns.push({ code: 'glossary', path, msg: `용어집 불일치: ‘${g.ko}’ → ‘${g.tr[lang]}’ (으)로 번역해야 합니다` });
      }
      // 한글 번역 금지 용어: 일본어·중국어·영어 문장에 한글이 섞인다(상품명은 제외)
      for (const g of glossary) {
        if (g.dnt && g.ko && g.ko !== productName && HANGUL.test(g.ko) && tr.includes(g.ko)) warns.push({ code: 'dnt-hangul', path, msg: `번역 금지 용어 ‘${g.ko}’의 한글이 번역문에 그대로 남았습니다. 용어집에서 번역어를 지정하세요` });
      }
      // 현지 상품명
      if (market.name && productName && ko.includes(productName) && !tr.includes(market.name)) warns.push({ code: 'name', path, msg: `현지 상품명 ‘${market.name}’ 사용 필요` });
    }
    // 항목 수가 원문과 다르면 구조 불일치
    const koPaths = new Set(koFlat.map((x) => x.path));
    const extra = Object.keys(trFlat).filter((k) => !koPaths.has(k) && String(trFlat[k]).trim());
    if (extra.length) warns.push({ code: 'structure', path: extra[0], msg: '원문에 없는 항목이 번역에 있습니다' });
    return warns;
  }

  // 한 언어의 진행 요약(내보내기 대상 블록 기준)
  function langSummary(project, lang) {
    const out = { total: 0, none: 0, stale: 0, ai: 0, edited: 0, review: 0, approved: 0, warnings: 0, warningsOpen: 0 };
    for (const b of project.blocks) {
      const lb = localizeBlock(project, lang, b);
      if (lb.hidden || !needsTranslation(b)) continue;
      out.total += 1;
      const st = trStatus(project, lang, b);
      out[st] += 1;
      // 검수 완료된 블록의 경고는 검수자가 수용한 것으로 보고, 저장 확인(warningsOpen)에는 반영하지 않는다.
      if (qaCheck(project, lang, b).length) { out.warnings += 1; if (st !== 'approved') out.warningsOpen += 1; }
    }
    out.ready = out.total > 0 && out.approved === out.total;
    return out;
  }

  function sanitizeTrMap(m) {
    const out = {};
    if (m && typeof m === 'object') {
      for (const [k, v] of Object.entries(m)) {
        if (/^[A-Za-z0-9_.]{1,60}$/.test(k) && typeof v === 'string') out[k] = str(v, 4500);
      }
    }
    return out;
  }
  function sanitizeTr(type, rec) {
    if (!rec || typeof rec !== 'object') return null;
    void type;
    return {
      t: sanitizeTrMap(rec.t),
      ai: rec.ai ? sanitizeTrMap(rec.ai) : null,
      status: TR_STATUS.includes(rec.status) ? rec.status : 'ai',
      srcHash: S(rec.srcHash, 16),
      note: S(rec.note, 1000), by: S(rec.by, 60), at: S(rec.at, 40), updatedAt: S(rec.updatedAt, 40),
    };
  }
  function sanitizeLangData(d) {
    d = d && typeof d === 'object' ? d : {};
    const blocks = {};
    for (const t of TYPE_SET) { const r = sanitizeTr(t, d.blocks && d.blocks[t]); if (r) blocks[t] = r; }
    const imgs = {};
    if (d.imgs && typeof d.imgs === 'object') {
      for (const [k, v] of Object.entries(d.imgs)) {
        const [t, key] = k.split(':');
        if (TYPE_SET.has(t) && /^[a-z0-9]{1,12}$/.test(key || '') && v && typeof v.assetId === 'string' && ID_RE.test(v.assetId)) imgs[k] = { assetId: v.assetId, source: v.source === 'photo' ? 'photo' : 'user' };
      }
    }
    const hidden = {};
    if (d.hidden && typeof d.hidden === 'object') for (const t of TYPE_SET) if (d.hidden[t]) hidden[t] = true;
    const m = d.market && typeof d.market === 'object' ? d.market : {};
    return {
      blocks, imgs, hidden,
      market: { name: S(m.name, 200), price: S(m.price, 200), shipping: S(m.shipping, 500), promo: S(m.promo, 500), buyUrl: S(m.buyUrl, 500), notes: S(m.notes, 1000) },
      reviewer: S(d.reviewer, 60),
    };
  }
  function sanitizeI18n(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const langs = [];
    for (const c of Array.isArray(raw.langs) ? raw.langs : []) if (LANG_BY[c] && !LANG_BY[c].source && !langs.includes(c)) langs.push(c);
    const data = {};
    for (const c of langs) data[c] = sanitizeLangData(raw.data && raw.data[c]);
    const glossary = list(raw.glossary, 200, (g) => {
      if (!g || typeof g !== 'object') return null;
      const ko = S(g.ko, 80);
      if (!ko) return null;
      const tr = {};
      for (const l of TARGET_LANGS) { const v = S(g.tr && g.tr[l.code], 120); if (v) tr[l.code] = v; }
      return { id: typeof g.id === 'string' && ID_RE.test(g.id) ? g.id : newId('g'), ko, dnt: !!g.dnt, tr };
    });
    return { langs, data, glossary, strict: !!raw.strict };
  }

  // ───────────── 기본 구성(AI 없이도 만들 수 있다) ─────────────
  function parsePairs(text, max) {
    const out = [];
    for (const line of str(text, 4000).split('\n')) {
      const m = /^\s*[·•\-*]?\s*([^:：]{1,30})[:：]\s*(.+)$/.exec(line);
      if (m) out.push({ label: m[1].trim(), value: m[2].trim() });
      if (out.length >= max) break;
    }
    return out;
  }

  function buildBlocks(product, photos, briefIn) {
    product = sanitizeProduct(product);
    photos = Array.isArray(photos) ? photos : [];
    const sents = splitSentences(product.description);
    const photoAt = (i) => (photos[i] ? photos[i].assetId : null);
    const mk = (type, fields, hidden) => {
      const id = newId('b');
      return { id, type, hidden: !!hidden, fields: normalizeFields(type, fields), images: makeSlots(type, id) };
    };
    const seed = (block, assets) => {
      block.images.forEach((s, i) => {
        const a = assets[i];
        if (a) { s.assetId = a; s.source = 'photo'; }
      });
      return block;
    };
    const rows = [];
    if (product.price) rows.push({ label: '가격', value: product.price });
    const specPairs = parsePairs(product.spec, 3);
    if (specPairs.length) rows.push(...specPairs.slice(0, 2));
    else if (product.spec) rows.push({ label: '구성·규격', value: firstSentence(product.spec, 80) });
    if (product.shipping) rows.push({ label: '배송', value: firstSentence(product.shipping, 80) });

    const blocks = [
      mk('info', { title: product.name, subtitle: firstSentence(product.description, 90), rows }),
      mk('promo', { badge: '프로모션', title: firstSentence(product.promo, 60), desc: splitSentences(product.promo).slice(1).join(' ') }, !product.promo),
      seed(mk('hero', { title: product.name, subtitle: firstSentence(product.description, 90) }), [photoAt(0)]),
      mk('headline', { kicker: product.target ? '이런 분께' : '', title: product.target ? firstSentence(product.target, 60) : '', points: sents.slice(0, 3) }, !product.target && sents.length === 0),
      seed(mk('mood', { title: '', text: sents[1] || '' }), [photoAt(1)]),
      mk('intro', { title: product.name, body: product.description }),
      seed(mk('features', { title: '', items: sents.slice(0, 4).map((s) => ({ title: s.length > 22 ? s.slice(0, 22).trim() + '…' : s, desc: s.length > 22 ? s : '' })) }), [photoAt(2)]),
      seed(mk('gallery', { title: '', caption: '' }), [photoAt(0), photoAt(1), photoAt(2)]),
      mk('usage', { title: '사용 방법', steps: [] }, true),
      seed(mk('detail', { title: '', items: [] }), [photoAt(3), photoAt(4)]),
      mk('faq', { title: '', faqs: [], specTitle: '규격', specs: parsePairs(product.spec, LIMITS.specs) }),
      mk('cta', { title: '', desc: '', buttonLabel: '', buttonUrl: '' }, true),
    ];
    for (const b of blocks) if (!b.hidden && !blockHasContent(b)) b.hidden = true;
    const brief = sanitizeBrief(briefIn, product);
    return { blocks, brief };
  }

  return {
    SCHEMA_VERSION, BLOCK_TYPES, LABELS, SLOT_DEFS, LIMITS, ID_RE, PALETTES,
    newId, str, splitSentences, firstSentence, pickPalette, mergePalette, contrast, isHex,
    normalizeFields, emptyFields, makeSlots, blockHasContent,
    sanitizeBlock, sanitizeBrief, sanitizeProduct, sanitizeProject, buildBlocks, parsePairs,
    LANGS, LANG_BY, TARGET_LANGS, TR_STATUS, STATUS_LABEL, TR_SCALE,
    flatten, getPath, setPath, applyTr, prettyPath, fieldsHash, needsTranslation, getLangData, getTr, trStatus, localizeBlock, qaCheck, langSummary, sanitizeI18n, sanitizeTr,
  };
});
