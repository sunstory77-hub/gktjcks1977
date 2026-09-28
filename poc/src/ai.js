// AI 카피 생성: 브리프 → Claude가 홍보 카피 3안 + 인스타 캡션·해시태그를 JSON으로 작성.
// 날짜·장소·가격·커리큘럼·혜택 같은 사실 정보는 AI에 맡기지 않고 브리프 값을 그대로 쓴다.
// API 키가 없거나 호출이 실패하면 브리프 문구로 대체(offlineCopy)한다.
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5';
export const VARIANT_COUNT = 3;

// 카드·릴스 레이아웃에 들어가는 글자 수 한도(공백 포함). 넘치면 줄바꿈이 깨진다.
export const LIMITS = { tag: 12, titleLine: 10, titleLines: 2, subtitle: 20, promise: 26, cta: 16, painPoint: 22 };

const variantSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['angle', 'tag', 'title', 'subtitle', 'promise', 'cta'],
  properties: {
    angle: { type: 'string', description: '이 안의 소구 포인트 한 줄 (예: 시간 절약, 불안 해소)' },
    tag: { type: 'string' },
    title: { type: 'string', description: '줄바꿈(\\n)으로 나눈 최대 2줄' },
    subtitle: { type: 'string' },
    promise: { type: 'string' },
    cta: { type: 'string' },
  },
};

export const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['variants', 'painPoints', 'caption', 'hashtags'],
  properties: {
    variants: { type: 'array', items: variantSchema },
    painPoints: { type: 'array', items: { type: 'string' } },
    caption: { type: 'string', description: '인스타그램 본문 캡션. 사실 정보는 브리프 값 그대로.' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `당신은 교육 강의 홍보 전문 카피라이터입니다. 강사 브랜드 "긍정하쌤"의 톤(밝고 긍정적, 과장 없이 구체적)으로 한국어 카피를 씁니다.

규칙:
- 카피 ${VARIANT_COUNT}안을 서로 다른 소구 포인트(angle)로 작성합니다.
- 브리프에 없는 사실(날짜, 가격, 할인율, 수강생 수, 성과 수치, 기관명)을 만들지 않습니다.
- 글자 수 한도(공백 포함)를 반드시 지킵니다. 카드뉴스 레이아웃에 들어가야 하기 때문입니다.
  tag ${LIMITS.tag}자, title 한 줄 ${LIMITS.titleLine}자 × 최대 ${LIMITS.titleLines}줄(줄바꿈은 \\n), subtitle ${LIMITS.subtitle}자, promise ${LIMITS.promise}자, cta ${LIMITS.cta}자, painPoints 각 ${LIMITS.painPoint}자.
- painPoints는 수강 대상이 실제로 겪는 고민 정확히 3개입니다.
- hashtags는 '#' 없이 5~10개입니다.
- 이모지는 caption에서만 쓸 수 있습니다.`;

// 사실 정보를 뺀 브리프만 AI에 보낸다(사실은 어차피 덮어쓰지 않지만, 캡션 작성에는 필요).
function briefForPrompt(brief) {
  const { _note, handle, ...rest } = brief;
  return rest;
}

const len = (s) => [...String(s)].length;

export function validateCopy(copy) {
  const errors = [];
  if (!Array.isArray(copy.variants) || copy.variants.length !== VARIANT_COUNT) errors.push(`variants는 ${VARIANT_COUNT}개여야 함`);
  if (!Array.isArray(copy.painPoints) || copy.painPoints.length !== 3) errors.push('painPoints는 3개여야 함');
  (copy.variants ?? []).forEach((v, i) => {
    const lines = String(v.title).split('\n');
    if (lines.length > LIMITS.titleLines) errors.push(`${i + 1}안 title ${lines.length}줄 (최대 ${LIMITS.titleLines})`);
    lines.forEach((l) => len(l) > LIMITS.titleLine && errors.push(`${i + 1}안 title 한 줄 "${l}" ${len(l)}자 (최대 ${LIMITS.titleLine})`));
    for (const k of ['tag', 'subtitle', 'promise', 'cta']) {
      if (len(v[k]) > LIMITS[k]) errors.push(`${i + 1}안 ${k} ${len(v[k])}자 (최대 ${LIMITS[k]})`);
    }
  });
  (copy.painPoints ?? []).forEach((p, i) => len(p) > LIMITS.painPoint && errors.push(`painPoints[${i}] ${len(p)}자 (최대 ${LIMITS.painPoint})`));
  return errors;
}

export async function generateCopy(brief, { client = new Anthropic(), model = process.env.PROMO_MODEL || DEFAULT_MODEL } = {}) {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: COPY_SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `다음 강의 브리프로 홍보 카피를 작성해 주세요.\n\n${JSON.stringify(briefForPrompt(brief), null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude가 요청을 거절했습니다 (${response.stop_details?.category ?? '사유 미상'})`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('응답이 max_tokens에서 잘렸습니다');

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let copy;
  try {
    copy = JSON.parse(text);
  } catch {
    throw new Error('AI 응답을 JSON으로 해석하지 못했습니다');
  }
  const errors = validateCopy(copy);
  if (errors.length) throw new Error(`AI 카피가 레이아웃 한도를 넘었습니다: ${errors.join('; ')}`);
  return { ...copy, source: `ai:${response.model}` };
}

// API 없이 브리프 문구로 카피 1안을 만든다.
export function offlineCopy(brief) {
  // 브리프에 hashtags가 있으면 그것을 쓰고, 없으면 기본 태그를 쓴다.
  const base = brief.hashtags?.length ? brief.hashtags : ['AI활용', '업무자동화', '원데이클래스', '직장인공부'];
  const tags = [...base, brief.instructor].map((t) => String(t).replace(/[\s#@]/g, ''));
  return {
    source: 'offline',
    variants: [
      {
        angle: '브리프 원문',
        tag: brief.tag ?? '',
        title: brief.title,
        subtitle: brief.subtitle ?? '',
        promise: brief.promise ?? brief.title,
        cta: brief.cta,
      },
    ],
    painPoints: brief.painPoints.slice(0, 3),
    caption: [
      `${String(brief.title).replace(/\n/g, ' ')} ${brief.subtitle ?? ''}`.trim(),
      '',
      ...brief.painPoints.slice(0, 3).map((p) => `✔ ${p}`),
      '',
      `📅 ${brief.date}`,
      `📍 ${brief.place}`,
      brief.price ? `💰 ${brief.price}` : '',
      '',
      `👉 ${brief.cta}`,
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n'),
    hashtags: [...new Set(tags.filter(Boolean))],
  };
}

// 선택한 카피 안을 브리프에 반영한다. 사실 필드는 절대 바꾸지 않는다.
export function applyCopy(brief, copy, variantIndex = 0) {
  const v = copy.variants[variantIndex];
  if (!v) throw new Error(`카피 ${variantIndex + 1}안이 없습니다 (총 ${copy.variants.length}안)`);
  return { ...brief, tag: v.tag, title: v.title, subtitle: v.subtitle, promise: v.promise, cta: v.cta, painPoints: copy.painPoints };
}

export function copyToMarkdown(copy, brief) {
  const out = [`# 홍보 카피 — ${String(brief.title).replace(/\n/g, ' ')}`, '', `생성: ${copy.source}`, ''];
  copy.variants.forEach((v, i) => {
    out.push(`## ${i + 1}안 · ${v.angle}`, '', `- 태그: ${v.tag}`, `- 제목: ${v.title.replace(/\n/g, ' / ')}`, `- 부제: ${v.subtitle}`, `- 약속: ${v.promise}`, `- CTA: ${v.cta}`, '');
  });
  out.push('## 고민 포인트', '', ...copy.painPoints.map((p) => `- ${p}`), '');
  out.push('## 인스타그램 캡션', '', '```', copy.caption, '', copy.hashtags.map((t) => `#${t}`).join(' '), '```', '');
  return out.join('\n');
}
