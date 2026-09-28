// 추가 포맷의 AI 문안: 인스타 광고 문구 3안, 상세페이지 6블록.
// 사실 정보는 AI가 직접 쓰지 않고 {{일시}}·{{장소}}·{{수강료}}·{{강사}}·{{신청}} 자리표시자로 쓰면 프로그램이 채운다.
// 팩트 시트에 없는 숫자, 빈 사실을 가리키는 자리표시자, 라벨 뒤 직접 작성은 오류 → 해당 결과는 입력 문구로 대체.
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL, DEFAULT_VOICE, structuredCall } from './ai.js';

// ── 사실 자리표시자 ──
const FACT_FIELDS = { 일시: 'date', 장소: 'place', 수강료: 'price', 강사: 'instructor', 신청: 'cta' };
const TOKEN_RE = /\{\{([^}]+)\}\}/g;

// 조사 짝: 받침 있을 때 / 없을 때
const PARTICLES = [['으로', '로'], ['과', '와'], ['은', '는'], ['이', '가'], ['을', '를']];

// 값의 마지막 글자에 맞춰 조사를 고른다. 한글이 아니면(숫자·괄호 등) 모델이 쓴 조사를 그대로 둔다.
function particleFor(value, written) {
  const last = String(value).trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return written;
  const jong = code % 28;
  const pair = PARTICLES.find((p) => p.includes(written));
  if (!pair) return written;
  if (pair[0] === '으로') return jong === 0 || jong === 8 ? '로' : '으로'; // ㄹ 받침은 '로'
  return jong ? pair[0] : pair[1];
}

export function fillFacts(text, facts) {
  // 조사 뒤에 한글이 이어지면(예: '이라는', '이에요') 조사가 아니라 서술어이므로 건드리지 않는다
  return String(text ?? '').replace(/\{\{([^}]+)\}\}(?:(으로|로|과|와|은|는|이|가|을|를)(?![가-힣]))?/g, (m, name, particle) => {
    if (!FACT_FIELDS[name]) return m;
    const value = facts[FACT_FIELDS[name]] ?? '';
    return particle ? value + particleFor(value, particle) : value;
  });
}

// 문장 하나 검사 → 오류 목록
export function checkFactText(text, facts, where) {
  const errors = [];
  const t = String(text ?? '');
  for (const [, name] of t.matchAll(TOKEN_RE)) {
    if (!FACT_FIELDS[name]) errors.push(`${where}: 알 수 없는 자리표시자 {{${name}}}`);
    else if (!String(facts[FACT_FIELDS[name]] ?? '').trim()) errors.push(`${where}: 팩트 시트에 ${name} 값이 없는데 {{${name}}}를 씀`);
  }
  const body = t.replace(TOKEN_RE, '');
  const label = /(일시|날짜|장소|수강료|가격|강사)\s*[:：]\s*(?!\s*\{\{)\S/.exec(t);
  if (label) errors.push(`${where}: 사실 정보를 직접 씀 "${label[0]}"`);
  const known = JSON.stringify(facts);
  for (const m of body.matchAll(/\d[\d,.:~]*/g)) {
    const core = m[0].replace(/[,.:~]+$/, '');
    // 한 자리 순서·개수(3가지, 2단계)는 허용. 단 %·배·명·위·원 같은 단위가 붙으면 주장이므로 검사
    const unit = body.slice(m.index + m[0].length).trimStart()[0] ?? '';
    if (/^\d$/.test(core) && !/[%배명위만천원점]/.test(unit)) continue;
    if (!known.includes(core)) errors.push(`${where}: 팩트 시트에 없는 숫자 "${core}"`);
  }
  return errors;
}

const len = (s) => [...String(s ?? '')].length;
const voiceLine = (voice) => `브랜드 "${voice.brandName || DEFAULT_VOICE.brandName}"의 톤(${voice.tone || DEFAULT_VOICE.tone})으로 한국어로 씁니다.`;
const FACT_RULE = `사실 정보(일시·장소·수강료·강사명·신청 방법)는 직접 쓰지 말고 {{일시}} {{장소}} {{수강료}} {{강사}} {{신청}} 자리표시자로 씁니다. 팩트 시트에 값이 없는 항목의 자리표시자는 쓰지 않습니다. 숫자는 팩트 시트에 있는 숫자만 씁니다. 팩트 시트에 없는 사실(할인율, 수강생 수, 만족도, 순위, 후기)을 만들지 않습니다. "최고", "1위", "100%", "보장" 같은 근거 없는 최상급·보장 표현을 쓰지 않습니다.`;
const factsForPrompt = ({ _note, handle, hashtags, ...rest }) => JSON.stringify(rest, null, 2);

// 자리표시자가 채워지면 몇 자가 되는지 알려 준다(글자 수 한도 계산용)
const tokenLengths = (facts) =>
  Object.entries(FACT_FIELDS)
    .filter(([, f]) => String(facts[f] ?? '').trim())
    .map(([name, f]) => `{{${name}}}=${len(facts[f])}자`)
    .join(', ');

// 생성 → 검사 → 실패하면 오류를 알려 주고 한 번 더. 두 번째도 실패하면 오류.
async function generateChecked({ client, model, system, schema, content, validate, label }) {
  let prompt = content;
  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, model: used } = await structuredCall({ client, model, system, schema, content: prompt });
    lastErrors = validate(data);
    if (!lastErrors.length) return { data, used, attempts: attempt };
    prompt = `${content}\n\n이전 결과가 다음 규칙을 어겼습니다. 고쳐서 다시 작성해 주세요:\n- ${lastErrors.slice(0, 10).join('\n- ')}`;
  }
  throw new Error(`AI ${label} 검사 실패: ${lastErrors.slice(0, 5).join('; ')}`);
}

// ── 인스타 광고 문구 ──
// 한도는 메타 광고 권장 길이를 한국어 기준으로 보수적으로 잡은 값 [기준: 2026-09 / 확인 필요]
export const AD_LIMITS = { primaryText: 150, headline: 20, description: 25, overlay: 14, overlaySub: 22 };
const PRIMARY_TARGET = 125; // 메타 권장(더보기 전에 보이는 길이). 150까지는 허용
const adSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ads'],
  properties: {
    ads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['angle', 'primaryText', 'headline', 'description', 'overlay', 'overlaySub'],
        properties: {
          angle: { type: 'string', description: '소구 포인트 한 줄' },
          primaryText: { type: 'string', description: '광고 본문(피드 위쪽 글). 자리표시자 사용 가능' },
          headline: { type: 'string', description: '광고 제목(이미지 아래 굵은 글)' },
          description: { type: 'string', description: '광고 설명(제목 아래 작은 글)' },
          overlay: { type: 'string', description: '이미지 위 큰 문구. 자리표시자 금지' },
          overlaySub: { type: 'string', description: '이미지 위 보조 문구. 자리표시자 사용 가능' },
        },
      },
    },
  },
};

export function validateAds(data, facts) {
  const errors = [];
  if (!Array.isArray(data.ads) || data.ads.length !== 3) errors.push('광고 문구는 3안이어야 함');
  (data.ads ?? []).forEach((a, i) => {
    // 길이는 자리표시자를 채운 뒤의 실제 글자로 잰다(채우면 길어질 수 있음)
    for (const k of Object.keys(AD_LIMITS)) {
      const n = len(fillFacts(a[k], facts));
      if (n > AD_LIMITS[k]) errors.push(`${i + 1}안 ${k} ${n}자 (최대 ${AD_LIMITS[k]})`);
    }
    if (/\{\{/.test(a.overlay)) errors.push(`${i + 1}안 overlay에 자리표시자`);
    for (const k of ['primaryText', 'headline', 'description', 'overlay', 'overlaySub']) errors.push(...checkFactText(a[k], facts, `${i + 1}안 ${k}`));
  });
  return errors;
}

const fillAd = (a, facts) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, fillFacts(v, facts)]));

export async function generateAdCopy(facts, { client = new Anthropic(), model = process.env.PROMO_MODEL || DEFAULT_MODEL, voice = DEFAULT_VOICE } = {}) {
  const { data, used, attempts } = await generateChecked({
    client,
    model,
    schema: adSchema,
    label: '광고 문구',
    validate: (d) => validateAds(d, facts),
    system: `당신은 인스타그램 광고 카피라이터입니다. ${voiceLine(voice)}
규칙:
- 광고 3안을 서로 다른 소구 포인트로 씁니다.
- 글자 수 한도(공백 포함, 자리표시자는 채워진 길이로 계산: ${tokenLengths(facts)}): primaryText ${PRIMARY_TARGET}자, headline ${AD_LIMITS.headline}자, description ${AD_LIMITS.description}자, overlay ${AD_LIMITS.overlay}자, overlaySub ${AD_LIMITS.overlaySub}자.
- overlay는 이미지 위에 크게 들어가는 한 줄로, 짧고 강하게 씁니다(자리표시자 금지).
- primaryText 첫 문장은 스크롤을 멈추게 하는 문제 제기로 시작합니다. 이모지는 primaryText에서 2개까지.
- ${FACT_RULE}`,
    content: `다음 팩트 시트로 인스타그램 광고 문구 3안을 써 주세요.\n\n${factsForPrompt(facts)}`,
  });
  return { source: `ai:${used}`, attempts, ads: data.ads.map((a) => fillAd(a, facts)) };
}

const cut = (s, n) => ([...String(s ?? '')].length > n ? [...String(s)].slice(0, n - 1).join('') + '…' : String(s ?? ''));

export function offlineAdCopy(facts) {
  const title = String(facts.title).replace(/\n/g, ' ');
  const when = [facts.date, facts.place].filter(Boolean).join(' · ');
  return {
    source: 'offline',
    ads: [
      {
        angle: '팩트 시트 원문',
        primaryText: cut([facts.painPoints?.[0] && `${facts.painPoints[0]}?`, facts.promise, when, facts.cta].filter(Boolean).join('\n'), AD_LIMITS.primaryText),
        headline: cut(title, AD_LIMITS.headline),
        description: cut(facts.subtitle || when, AD_LIMITS.description),
        overlay: cut(String(facts.title).split('\n')[0], AD_LIMITS.overlay),
        overlaySub: cut(String(facts.title).split('\n')[1] || facts.subtitle || '', AD_LIMITS.overlaySub),
      },
    ],
  };
}

// ── 상세페이지 6블록 (문제공감 → 핵심가치 → 특징 → 근거 → FAQ → 신청) ──
export const DETAIL_LIMITS = { title: 24, body: 160, featureTitle: 16, featureBody: 70, proofItem: 40, q: 40, a: 120 };
const detailSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'value', 'features', 'proof', 'faq', 'cta'],
  properties: {
    hook: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string', description: '독자의 상황을 공감하는 3문장' } } },
    value: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string' } } },
    features: {
      type: 'array',
      description: '특징 정확히 3개',
      items: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string' } } },
    },
    proof: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'items'],
      properties: { title: { type: 'string' }, items: { type: 'array', description: '팩트 시트의 커리큘럼·혜택·강사에서만 뽑은 근거 3~4개', items: { type: 'string' } } },
    },
    faq: {
      type: 'array',
      description: '자주 묻는 질문 3개',
      items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: { type: 'string' }, a: { type: 'string' } } },
    },
    cta: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string' } } },
  },
};

export function validateDetail(d, facts) {
  const errors = [];
  const L = DETAIL_LIMITS;
  const check = (where, text, max) => {
    const n = len(fillFacts(text, facts)); // 채운 뒤 길이
    if (n > max) errors.push(`${where} ${n}자 (최대 ${max})`);
    errors.push(...checkFactText(text, facts, where));
  };
  for (const k of ['hook', 'value', 'cta']) {
    check(`${k}.title`, d[k]?.title, L.title);
    check(`${k}.body`, d[k]?.body, L.body);
  }
  if (d.features?.length !== 3) errors.push('특징은 3개여야 함');
  (d.features ?? []).forEach((f, i) => (check(`특징${i + 1}.title`, f.title, L.featureTitle), check(`특징${i + 1}.body`, f.body, L.featureBody)));
  check('proof.title', d.proof?.title, L.title);
  if (!(d.proof?.items?.length >= 3 && d.proof.items.length <= 4)) errors.push('근거는 3~4개여야 함');
  (d.proof?.items ?? []).forEach((t, i) => check(`근거${i + 1}`, t, L.proofItem));
  if (d.faq?.length !== 3) errors.push('FAQ는 3개여야 함');
  (d.faq ?? []).forEach((f, i) => (check(`FAQ${i + 1}.q`, f.q, L.q), check(`FAQ${i + 1}.a`, f.a, L.a)));
  return errors;
}

function mapDetail(d, fn) {
  return {
    hook: { title: fn(d.hook.title), body: fn(d.hook.body) },
    value: { title: fn(d.value.title), body: fn(d.value.body) },
    features: d.features.map((f) => ({ title: fn(f.title), body: fn(f.body) })),
    proof: { title: fn(d.proof.title), items: d.proof.items.map(fn) },
    faq: d.faq.map((f) => ({ q: fn(f.q), a: fn(f.a) })),
    cta: { title: fn(d.cta.title), body: fn(d.cta.body) },
  };
}

export async function generateDetail(facts, { client = new Anthropic(), model = process.env.PROMO_MODEL || DEFAULT_MODEL, voice = DEFAULT_VOICE } = {}) {
  const L = DETAIL_LIMITS;
  const { data, used, attempts } = await generateChecked({
    client,
    model,
    schema: detailSchema,
    label: '상세페이지',
    validate: (d) => validateDetail(d, facts),
    system: `당신은 상세페이지 전문 카피라이터입니다. ${voiceLine(voice)}
상세페이지는 6블록 순서로 독자의 질문에 답합니다: 문제공감(hook) → 핵심가치(value) → 특징 3개(features) → 근거(proof) → 자주 묻는 질문 3개(faq) → 신청(cta).
규칙:
- 글자 수 한도(공백 포함, 자리표시자는 채워진 길이로 계산: ${tokenLengths(facts)}): 블록 제목 ${L.title}자, 블록 본문 ${L.body}자, 특징 제목 ${L.featureTitle}자·본문 ${L.featureBody}자, 근거 항목 ${L.proofItem}자, 질문 ${L.q}자, 답 ${L.a}자.
- 근거(proof)는 팩트 시트의 커리큘럼·혜택·강사 정보를 다시 쓴 것만 허용합니다. 후기·수치·수상 경력을 지어내지 않습니다.
- FAQ 답은 팩트 시트로 답할 수 있는 질문만 고르고, 사실은 자리표시자로 씁니다.
- 쉬운 문장으로, 같은 장점을 반복하지 않습니다.
- ${FACT_RULE}`,
    content: `다음 팩트 시트로 상세페이지 6블록을 써 주세요.\n\n${factsForPrompt(facts)}`,
  });
  return { source: `ai:${used}`, attempts, ...mapDetail(data, (t) => fillFacts(t, facts)) };
}

// API 없이 팩트 시트만으로 만드는 상세페이지 (FAQ 답은 사실 그대로)
export function offlineDetail(facts) {
  const title = String(facts.title).replace(/\n/g, ' ');
  const faq = [
    ['언제, 어디서 진행하나요?', `${facts.date} · ${facts.place}`],
    facts.target && ['누구에게 맞나요?', facts.target],
    facts.price ? ['수강료는 얼마인가요?', facts.price] : ['어떻게 신청하나요?', facts.cta],
  ].filter(Boolean);
  while (faq.length < 3) faq.push(['어떻게 신청하나요?', facts.cta]);
  return {
    source: 'offline',
    hook: { title: '이런 고민 있으신가요?', body: facts.painPoints.join('\n') },
    value: { title, body: facts.promise || facts.subtitle || title },
    features: facts.curriculum.slice(0, 3).map((c, i) => ({ title: `${i + 1}단계`, body: c })),
    proof: { title: '이렇게 준비했습니다', items: [...facts.benefits, facts.instructor && `강사 ${facts.instructor}`].filter(Boolean).slice(0, 4) },
    faq: faq.slice(0, 3).map(([q, a]) => ({ q, a })),
    cta: { title: '지금 신청하세요', body: facts.cta },
  };
}
