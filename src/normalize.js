'use strict';
/* AI 응답 정규화: 문자열·배열·객체로 달라지는 응답을 읽을 수 있는 텍스트/구조로 바꾼다. */
const S = require('../public/js/schema.js');
const { GeminiError } = require('./gemini.js');

const badResponse = (msg) => new GeminiError('bad_response', msg + ' 다시 시도해 주세요. 입력한 내용은 그대로 보존되어 있습니다.');

// 코드펜스·앞뒤 설명·마지막 쉼표가 섞인 JSON 문자열도 최대한 파싱한다.
function parseJsonLoose(text) {
  if (text && typeof text === 'object') return text;
  let t = String(text || '').trim();
  if (!t) return null;
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(t);
  if (v !== undefined) return v;
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    const body = t.slice(a, b + 1);
    v = tryParse(body);
    if (v !== undefined) return v;
    v = tryParse(body.replace(/,\s*([}\]])/g, '$1'));
    if (v !== undefined) return v;
  }
  return null;
}

const LABEL_KO = {
  age: '연령', gender: '성별', interests: '관심사', needs: '필요', pain_points: '고민', painpoints: '고민', occupation: '직업',
  description: '설명', summary: '요약', segment: '고객층', group: '고객층', persona: '페르소나', primary: '주요 고객', secondary: '보조 고객',
  lifestyle: '생활 방식', motivation: '구매 동기', income: '소득', location: '지역',
};

// 값이 문자열·숫자·배열·객체 어느 형태이든 사람이 읽을 수 있는 텍스트로 만든다.
function toReadableText(v, depth = 0) {
  if (v == null) return '';
  if (typeof v === 'string') return v.replace(/\r\n?/g, '\n').trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (depth > 4) return '';
  if (Array.isArray(v)) {
    const parts = v.map((x) => toReadableText(x, depth + 1)).filter(Boolean);
    return parts.length <= 1 ? (parts[0] || '') : parts.map((p) => (p.includes('\n') ? p : '· ' + p)).join('\n');
  }
  if (typeof v === 'object') {
    const lines = [];
    for (const [k, val] of Object.entries(v)) {
      const t = toReadableText(val, depth + 1);
      if (!t) continue;
      const label = LABEL_KO[String(k).toLowerCase()] || String(k).replace(/_/g, ' ');
      lines.push(t.includes('\n') ? `${label}:\n${t}` : `${label}: ${t}`);
    }
    return lines.join('\n');
  }
  return '';
}

const SECTION_DEFS = [
  { key: 'overview', title: '상품 한눈에 보기', aliases: ['overview', 'summary', 'at_a_glance', 'glance', '한눈에 보기', '상품 한눈에 보기'] },
  { key: 'features', title: '핵심 특징', aliases: ['features', 'key_features', 'highlights', '핵심 특징', '특징'] },
  { key: 'spec', title: '구성·규격', aliases: ['spec', 'specs', 'specification', 'composition', '구성·규격', '구성', '규격'] },
  { key: 'usage', title: '사용·보관 방법', aliases: ['usage', 'how_to_use', 'storage', 'use', '사용·보관 방법', '사용 방법', '사용방법'] },
  { key: 'purchase', title: '구매·배송 정보', aliases: ['purchase', 'shipping', 'delivery', 'purchase_info', '구매·배송 정보', '구매 정보', '배송'] },
  { key: 'checks', title: '확인할 사항', aliases: ['checks', 'check', 'to_confirm', 'todo', 'notes', '확인할 사항', '확인 사항'] },
];

function pickKey(obj, aliases) {
  const keys = Object.keys(obj || {});
  for (const a of aliases) {
    const k = keys.find((x) => x.toLowerCase().replace(/\s+/g, '_') === a.toLowerCase().replace(/\s+/g, '_'));
    if (k) return k;
  }
  return null;
}

// 원문에 있던 숫자+단위(가격·수량·규격·기간)를 뽑는다.
const FACT_RE = /\d[\d,.]*\s*(?:원|개입|개|ml|mL|ℓ|L|g|kg|mg|cm|mm|m|매|장|세트|박스|팩|병|캡슐|정|포|봉|%|일|시간|개월|년|인|단|ea|EA)/g;
function extractFacts(...texts) {
  const out = new Set();
  for (const t of texts) {
    const s = String(t || '');
    const m = s.match(FACT_RE);
    if (m) m.forEach((x) => out.add(x.replace(/\s+/g, '')));
  }
  return [...out];
}
const squash = (s) => String(s || '').replace(/[\s,]/g, '');

// AI가 정리한 결과에서 원문 수치가 사라졌다면 '확인할 사항'에 원문 그대로 되돌려 놓는다.
function preserveFacts(result, original) {
  const facts = extractFacts(original.price, original.spec, original.shipping, original.promo, original.description);
  const all = squash(Object.values(result.sections).join('\n'));
  const missing = facts.filter((f) => !all.includes(squash(f)));
  if (missing.length) {
    const note = `원문에 있던 수치가 정리 결과에서 빠져 원문 그대로 남겼습니다: ${missing.join(', ')}`;
    result.sections.checks = [result.sections.checks, note].filter(Boolean).join('\n');
    result.restoredFacts = missing;
  } else {
    result.restoredFacts = [];
  }
  return result;
}

function sectionsToText(sections) {
  return SECTION_DEFS.map((d, i) => {
    const body = (sections[d.key] || '').trim();
    return body ? `${i + 1}. ${d.title}\n${body}` : '';
  }).filter(Boolean).join('\n\n');
}

// '설명 정리' 응답 → { sections, target, text, targetMissing }
function normalizeOrganize(raw, original) {
  const data = parseJsonLoose(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badResponse('AI 응답에서 정리 결과를 읽지 못했습니다.');
  }
  const src = data.sections && typeof data.sections === 'object' ? data.sections : data;
  const sections = {};
  for (const d of SECTION_DEFS) {
    const k = pickKey(src, d.aliases);
    sections[d.key] = k ? toReadableText(src[k]) : '';
  }
  if (!Object.values(sections).some(Boolean)) {
    throw badResponse('AI 응답에 정리된 내용이 없습니다.');
  }
  const tk = pickKey(data, ['target', 'target_customer', 'targetcustomer', 'customer', 'audience', '타겟 고객', '고객층', '타겟']);
  const target = tk ? toReadableText(data[tk]) : '';
  const result = { sections, target, targetMissing: !target };
  preserveFacts(result, original || {});
  result.text = sectionsToText(sections);
  return result;
}

// 문구·이미지 계획(plan) 응답을 블록 구조로 정규화한다.
function normalizePlan(raw, product, photos) {
  const data = parseJsonLoose(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badResponse('AI 응답에서 상세페이지 구성을 읽지 못했습니다.');
  }
  const { blocks, brief } = S.buildBlocks(product, photos, data.brief || {});
  const aiBlocks = Array.isArray(data.blocks) ? data.blocks : (data.blocks && typeof data.blocks === 'object' ? Object.entries(data.blocks).map(([type, v]) => ({ type, ...(v || {}) })) : []);
  let applied = 0;
  for (const base of blocks) {
    const hit = aiBlocks.find((b) => b && b.type === base.type);
    if (!hit) continue;
    const fields = S.normalizeFields(base.type, hit.fields && typeof hit.fields === 'object' ? hit.fields : hit);
    // 모델이 빈 값을 준 필드는 기본 구성의 값을 유지한다.
    const merged = { ...base.fields };
    for (const [k, v] of Object.entries(fields)) {
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (!empty) merged[k] = v;
    }
    base.fields = merged;
    const prompts = hit.imagePrompts || hit.image_prompts || hit.images || [];
    if (Array.isArray(prompts)) {
      base.images.forEach((slot, i) => {
        const p = prompts[i];
        slot.prompt = S.str(typeof p === 'string' ? p : (p && (p.prompt || p.description)), 1200);
      });
    }
    // AI가 내용을 준 블록은 보이게 한다(프로모션·CTA처럼 입력이 없을 때 숨겨진 블록 포함).
    base.hidden = base.type === 'promo' && !S.str(product.promo, 10) ? true : !S.blockHasContent(base);
    applied += 1;
  }
  // 프로모션 입력이 없으면 AI가 만들어도 숨긴다(없는 혜택을 만들어 넣지 않는다).
  const promo = blocks.find((b) => b.type === 'promo');
  if (promo && !S.str(product.promo, 10)) { promo.hidden = true; promo.fields = S.emptyFields('promo'); }
  for (const b of blocks) {
    b.images.forEach((slot) => { if (!slot.prompt) slot.prompt = defaultPrompt(b.type, product); });
  }
  return { brief, blocks, applied };
}

function defaultPrompt(type, product) {
  const n = product.name || 'the product';
  const scenes = {
    hero: `Clean hero product photo of ${n}, centered, soft studio light, generous negative space`,
    mood: `Lifestyle scene showing ${n} being used naturally in a warm everyday setting`,
    features: `Close-up showing the key feature of ${n}`,
    gallery: `Editorial product photo of ${n} on a neutral surface with soft shadows`,
    usage: `Hands using ${n} step by step in a bright, tidy setting`,
    detail: `Macro detail shot of ${n} showing material and finish`,
  };
  return scenes[type] || scenes.gallery;
}

function normalizeEditText(raw, type) {
  const data = parseJsonLoose(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badResponse('AI 응답에서 수정된 문구를 읽지 못했습니다.');
  }
  const fields = S.normalizeFields(type, data.fields && typeof data.fields === 'object' ? data.fields : data);
  return { fields };
}

// 검색·사진 분석 응답에 섞이는 마크다운 기호(**, ###, ---, * 목록)를 화면용 평문으로 바꾼다.
function stripMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '· ')
    .replace(/^\s*[-_*]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { stripMarkdown, parseJsonLoose, toReadableText, extractFacts, preserveFacts, normalizeOrganize, normalizePlan, normalizeEditText, sectionsToText, SECTION_DEFS, defaultPrompt };
