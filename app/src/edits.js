// 사용자가 직접 고친 문안(카피·광고 문구·상세페이지) 검사.
// 사람이 쓴 문장은 사실 검사 대신 레이아웃 글자 수만 지킨다(넘치면 카드·광고 이미지가 깨짐). 광고 표현 검수는 서버에서 다시 한다.
import { LIMITS } from '../../poc/src/ai.js';
import { AD_LIMITS, DETAIL_LIMITS } from '../../poc/src/formats.js';
import { HttpError } from './http.js';

const len = (s) => [...String(s ?? '')].length;
const text = (v) => String(v ?? '').replace(/\r/g, '').trim();

function fail(errors) {
  if (errors.length) throw new HttpError(400, `글자 수를 줄여 주세요: ${errors.slice(0, 6).join(', ')}`);
}
function limit(errors, where, value, max) {
  const n = len(value);
  if (n > max) errors.push(`${where} ${n}자(최대 ${max})`);
  return value;
}

export function editCopy(raw, prev) {
  const errors = [];
  const variants = (Array.isArray(raw?.variants) ? raw.variants : []).slice(0, 3).map((v, i) => {
    const title = text(v?.title).split('\n').slice(0, LIMITS.titleLines).map((l) => limit(errors, `${i + 1}안 제목 한 줄`, l.trim(), LIMITS.titleLine)).join('\n');
    if (!title) errors.push(`${i + 1}안 제목이 비어 있음`);
    const out = { angle: text(v?.angle).slice(0, 40) || prev?.variants?.[i]?.angle || '직접 작성', title };
    for (const k of ['tag', 'subtitle', 'promise', 'cta']) out[k] = limit(errors, `${i + 1}안 ${k}`, text(v?.[k]), LIMITS[k]);
    if (!out.cta) errors.push(`${i + 1}안 신청 문구가 비어 있음`);
    return out;
  });
  if (!variants.length) errors.push('카피가 없음');
  const painPoints = (Array.isArray(raw?.painPoints) ? raw.painPoints : []).map(text).filter(Boolean).slice(0, 3).map((p, i) => limit(errors, `고민 ${i + 1}`, p, LIMITS.painPoint));
  if (!painPoints.length) errors.push('고민이 비어 있음');
  const caption = limit(errors, '캡션', text(raw?.caption), 2200); // 인스타그램 캡션 최대 [기준: 2026-09 / 확인 필요]
  const hashtags = (Array.isArray(raw?.hashtags) ? raw.hashtags : String(raw?.hashtags ?? '').split(/[\s,]+/)).map((t) => text(t).replace(/^#/, '')).filter(Boolean).slice(0, 30);
  fail(errors);
  return { source: 'edited', variants, painPoints, caption, hashtags };
}

export function editAds(raw) {
  const errors = [];
  const ads = (Array.isArray(raw?.ads) ? raw.ads : []).slice(0, 3).map((a, i) => {
    const out = { angle: text(a?.angle).slice(0, 40) || '직접 작성' };
    for (const k of Object.keys(AD_LIMITS)) out[k] = limit(errors, `${i + 1}안 ${k}`, text(a?.[k]), AD_LIMITS[k]);
    if (!out.overlay) errors.push(`${i + 1}안 이미지 문구가 비어 있음`);
    return out;
  });
  if (!ads.length) errors.push('광고 문구가 없음');
  fail(errors);
  return { source: 'edited', ads };
}

export function editDetail(raw) {
  const errors = [];
  const L = DETAIL_LIMITS;
  const pair = (o, where) => ({ title: limit(errors, `${where} 제목`, text(o?.title), L.title), body: limit(errors, `${where} 본문`, text(o?.body), L.body) });
  const arr = (v) => (Array.isArray(v) ? v : []);
  const d = {
    source: 'edited',
    hook: pair(raw?.hook, '문제공감'),
    value: pair(raw?.value, '핵심가치'),
    features: arr(raw?.features).slice(0, 3).map((f, i) => ({ title: limit(errors, `특징${i + 1} 제목`, text(f?.title), L.featureTitle), body: limit(errors, `특징${i + 1} 본문`, text(f?.body), L.featureBody) })),
    proof: { title: limit(errors, '근거 제목', text(raw?.proof?.title), L.title), items: arr(raw?.proof?.items).map(text).filter(Boolean).slice(0, 4).map((t, i) => limit(errors, `근거${i + 1}`, t, L.proofItem)) },
    faq: arr(raw?.faq).slice(0, 3).map((f, i) => ({ q: limit(errors, `질문${i + 1}`, text(f?.q), L.q), a: limit(errors, `답${i + 1}`, text(f?.a), L.a) })),
    cta: pair(raw?.cta, '신청'),
  };
  if (d.features.length !== 3) errors.push('특징은 3개');
  if (!d.proof.items.length) errors.push('근거가 비어 있음');
  if (!d.faq.length) errors.push('질문이 비어 있음');
  fail(errors);
  return d;
}
