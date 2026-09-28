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
    caption: { type: 'string', description: '인스타그램 본문 캡션. 일시·장소·가격·강사는 직접 쓰지 말고 {{사실정보}} 자리표시자 한 줄로 둡니다.' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};

// 브랜드명·톤은 회사별로 다르다(판매용 앱). 기본값은 PoC 브랜드.
export const DEFAULT_VOICE = { brandName: '긍정하쌤', tone: '밝고 긍정적, 과장 없이 구체적' };

export function systemPrompt({ brandName, tone } = DEFAULT_VOICE) {
  return `당신은 교육·강의·행사 홍보 전문 카피라이터입니다. 브랜드 "${brandName || DEFAULT_VOICE.brandName}"의 톤(${tone || DEFAULT_VOICE.tone})으로 한국어 카피를 씁니다.

규칙:
- 카피 ${VARIANT_COUNT}안을 서로 다른 소구 포인트(angle)로 작성합니다.
- 브리프에 없는 사실(날짜, 가격, 할인율, 수강생 수, 성과 수치, 기관명)을 만들지 않습니다.
- 글자 수 한도(공백 포함)를 반드시 지킵니다. 카드뉴스 레이아웃에 들어가야 하기 때문입니다.
  tag ${LIMITS.tag}자, title 한 줄 ${LIMITS.titleLine}자 × 최대 ${LIMITS.titleLines}줄(줄바꿈은 \\n), subtitle ${LIMITS.subtitle}자, promise ${LIMITS.promise}자, cta ${LIMITS.cta}자, painPoints 각 ${LIMITS.painPoint}자.
- painPoints는 수강 대상이 실제로 겪는 고민 정확히 3개입니다.
- hashtags는 '#' 없이 5~10개입니다.
- 이모지는 caption에서만 쓸 수 있습니다.
- caption에는 일시·장소·가격·강사명을 직접 쓰지 않습니다. 그 자리에 {{사실정보}} 한 줄을 정확히 한 번 넣으면 프로그램이 브리프 값으로 채웁니다.
- caption에 숫자를 쓸 때는 브리프에 있는 숫자만 씁니다.`;
}

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

// ── 캡션의 사실 정보 ──
// 캡션은 자유 문장이라 AI가 사실을 바꿔 쓸 수 있다(실사용 테스트에서 "일시 확인 필요"를 "별도 안내 예정"으로 바꾼 사례).
// 그래서 AI는 {{사실정보}} 자리표시자만 쓰고, 일시·장소·가격·강사 줄은 프로그램이 브리프 값으로 채운다.
export const FACT_TOKEN = '{{사실정보}}';

export function factLines(brief) {
  return [
    `🗓 ${brief.date}`,
    `📍 ${brief.place}`,
    brief.price ? `💰 ${brief.price}` : '',
    brief.instructor ? `🙋 강사 ${brief.instructor}` : '',
  ].filter(Boolean);
}

// AI 캡션 검사: 자리표시자 1회, 사실 라벨 직접 작성 금지, 브리프에 없는 숫자 금지
export function checkCaption(caption, brief) {
  const errors = [];
  const text = String(caption ?? '');
  const n = text.split(FACT_TOKEN).length - 1;
  if (n !== 1) errors.push(`${FACT_TOKEN} 자리표시자 ${n}회 (정확히 1회여야 함)`);
  const body = text.replaceAll(FACT_TOKEN, '');
  const label = /(일시|날짜|장소|수강료|가격|강사)\s*[:：]/.exec(body);
  if (label) errors.push(`사실 정보를 직접 씀: "${label[0]}"`);
  const known = JSON.stringify(brief);
  for (const num of body.match(/\d[\d,.:~]*/g) ?? []) {
    const core = num.replace(/[,.:~]+$/, '');
    if (!known.includes(core)) errors.push(`브리프에 없는 숫자: "${core}"`);
  }
  return errors;
}

export const fillCaption = (caption, brief) => String(caption).replace(FACT_TOKEN, factLines(brief).join('\n'));

// 고객이 등록한 API 키로 클라이언트를 만든다(판매용 앱: 키는 서버에서만 복호화해 넘긴다)
export const anthropicClient = (apiKey) => new Anthropic({ apiKey });

export async function generateCopy(brief, { client = new Anthropic(), model = process.env.PROMO_MODEL || DEFAULT_MODEL, voice = DEFAULT_VOICE } = {}) {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: COPY_SCHEMA } },
    system: systemPrompt(voice),
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
  // 캡션만 문제면 카피 3안은 살리고 캡션은 브리프 문구로 대체한다
  const captionErrors = checkCaption(copy.caption, brief);
  const caption = captionErrors.length ? offlineCopy(brief).caption : fillCaption(copy.caption, brief);
  return {
    ...copy,
    caption,
    source: `ai:${response.model}`,
    ...(captionErrors.length && { warnings: [`AI 캡션을 브리프 문구로 대체했습니다: ${captionErrors.join('; ')}`] }),
  };
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
      ...factLines(brief),
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
