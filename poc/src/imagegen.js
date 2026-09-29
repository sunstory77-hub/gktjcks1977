// AI 배경 이미지 생성 (Google Gemini 이미지 모델).
// 표지 사진 칸(coverImage)에 들어갈 "배경"만 만든다. 글자는 템플릿이 그리므로 이미지 안에 글자를 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeImage } from './images.js';

export const DEFAULT_IMAGE_MODEL = process.env.PROMO_IMAGE_MODEL || 'gemini-3.1-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 업종 공통 스타일. 사실과 다를 수 있는 구체적 상품·메뉴·매장은 그리지 않는다(실물과 다른 이미지는 표시광고 문제가 될 수 있음).
export const IMAGE_STYLES = {
  classroom: {
    label: '강의·교육 현장',
    scene: 'A bright, candid photograph of Korean adult learners in a modern classroom, working on laptops. The people sit in the upper half of the frame; the lower half is an empty wooden tabletop. Soft natural window light, warm tones, shallow depth of field.',
  },
  seminar: {
    label: '행사·세미나',
    scene: 'A candid photograph of a small Korean seminar or networking event seen from the back of the room: blurred audience silhouettes and a soft-focus stage with a blank screen. Warm ambient lighting, gentle bokeh.',
  },
  workspace: {
    label: '책상 위 소품',
    scene: 'A clean top-down photograph of a tidy desk: laptop, notebook, pen and a coffee cup. Soft daylight, warm neutral tones. No people.',
  },
  stage: {
    label: '상품 연출 무대(빈 받침대)',
    scene: 'A minimal studio product-photography set with an empty round podium in the upper-middle of the frame, soft seamless backdrop, gentle shadows and a few simple props (leaves, stones) at the edges. The podium is empty — no product on it.',
  },
  lifestyle: {
    label: '일상·라이프스타일',
    scene: 'A candid lifestyle photograph of a Korean adult relaxing at home in morning light, seen from a distance, face not prominent. Airy, warm, natural colors, lots of calm space.',
  },
  store: {
    label: '매장·공간 분위기',
    scene: 'A soft-focus photograph of a cozy, modern small-shop interior with warm lighting, plants and wooden shelves, heavily blurred so no specific goods are identifiable. No people.',
  },
  cafe: {
    label: '카페·휴식 분위기',
    scene: 'A soft-focus photograph of a sunny cafe table by a window with a plain ceramic cup, heavily blurred background, warm afternoon light. No identifiable menu items, no people.',
  },
  nature: {
    label: '계절·자연',
    scene: 'A calm nature photograph: soft morning light over a meadow and distant trees, gentle seasonal colors, lots of open sky. No people, no buildings.',
  },
  abstract: {
    label: '추상 그래픽',
    scene: 'A minimal abstract background of soft overlapping shapes and gentle gradients in navy, warm orange and cream. Calm, modern, lots of empty space. No people, no objects, no devices — shapes only.',
  },
};
export const DEFAULT_IMAGE_STYLE = 'classroom';
// 업종별 추천 순서(화면에서 먼저 보여 줌)
export const STYLE_BY_KIND = {
  edu: ['classroom', 'seminar', 'workspace', 'abstract'],
  product: ['stage', 'lifestyle', 'nature', 'abstract'],
  service: ['store', 'cafe', 'lifestyle', 'abstract'],
};
export const IMAGE_RATIOS = { '9:16': '세로 9:16 → 세로 자리 (릴스·스토리 광고)', '4:5': '4:5 → 피드 자리 (카드뉴스·피드 광고)', '1:1': '1:1 → 피드 자리 (피드 광고·상세페이지)' };
export const MAX_EXTRA = 150;
const SUBJECT_EN = { edu: 'lecture or event', product: 'product', service: 'service or local shop' };

// 주제(제목·부제)만 넘긴다. 일시·가격·강사명 같은 사실 정보는 이미지에 필요 없으므로 보내지 않는다.
// extra: 사용자가 덧붙인 장면 설명, withReference: 첨부한 상품 사진을 그대로 살려 연출
export function buildImagePrompt(brief, style = DEFAULT_IMAGE_STYLE, { extra = '', ratio = '9:16', withReference = false } = {}) {
  const preset = IMAGE_STYLES[style];
  if (!preset) throw new Error(`알 수 없는 이미지 스타일: ${style}`);
  const topic = [String(brief.title ?? '').replace(/\n/g, ' '), brief.subtitle].filter(Boolean).join(' — ');
  const note = String(extra ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_EXTRA);
  return [
    `Background image for a Korean ${SUBJECT_EN[brief.kind] ?? SUBJECT_EN.edu} promotion. Topic (in Korean): "${topic}".`,
    brief.target ? `Audience (in Korean): "${brief.target}".` : '',
    withReference
      ? 'Use the product in the attached photo exactly as it is — same shape, colors, proportions and printed label. Do not add, remove or redesign any part of it. Place it naturally in the scene below as the hero object, in the upper half of the frame.'
      : '',
    preset.scene.replace(withReference ? 'The podium is empty — no product on it.' : '', withReference ? 'The attached product stands on the podium.' : ''),
    note ? `Additional direction from the client (in Korean, follow it only if it does not conflict with the rules): "${note}".` : '',
    `${ratio === '9:16' ? 'Vertical' : ratio === '1:1' ? 'Square' : 'Portrait 4:5'} composition. Keep the lower half calm and uncluttered because text will be placed there later.`,
    withReference
      ? 'No added text, letters, numbers, logos or signage anywhere in the image, except what is already printed on the product itself.'
      : 'Absolutely no text, letters, numbers, logos, brand marks or signage anywhere in the image. Laptops and devices are plain and unbranded.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const imageApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// 프롬프트 → 이미지 1장 { buffer, mimeType, model }
// reference: 참고 사진 { buffer, mimeType } — 상품 사진을 장면에 넣을 때
export async function generateImage(prompt, { apiKey = imageApiKey(), model = DEFAULT_IMAGE_MODEL, aspectRatio = '9:16', reference, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 없습니다 (GEMINI_API_KEY 설정 필요)');
  let res;
  try {
    // 키는 URL이 아니라 헤더로 보낸다 (로그·프록시에 남지 않도록)
    res = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [...(reference ? [{ inlineData: { mimeType: reference.mimeType, data: reference.buffer.toString('base64') } }] : []), { text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`이미지 API 연결 실패: ${err.name === 'TimeoutError' ? '시간 초과' : err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`이미지 생성 실패 (${res.status}): ${data.error?.message ?? '알 수 없는 오류'}`);
  if (data.promptFeedback?.blockReason) throw new Error(`이미지 생성이 차단됐습니다 (${data.promptFeedback.blockReason}). 문구를 바꿔 다시 시도하세요`);
  const candidate = data.candidates?.[0];
  const part = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error(`이미지가 생성되지 않았습니다 (${candidate?.finishReason ?? '응답 없음'})`);
  return { buffer: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType, model };
}

// 브리프 → 표지 배경 JPEG(dest). 업로드 사진과 같은 정규화를 거친다.
export async function generateCoverImage(brief, dest, { style = DEFAULT_IMAGE_STYLE, prompt, extra, aspectRatio = '9:16', reference, ...opts } = {}) {
  if (!IMAGE_RATIOS[aspectRatio]) throw new Error(`지원하지 않는 비율: ${aspectRatio}`);
  const finalPrompt = prompt || buildImagePrompt(brief, style, { extra, ratio: aspectRatio, withReference: Boolean(reference) });
  const { buffer, mimeType, model } = await generateImage(finalPrompt, { ...opts, aspectRatio, reference });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = `${dest}.raw${mimeType === 'image/png' ? '.png' : '.jpg'}`;
  fs.writeFileSync(raw, buffer);
  try {
    await normalizeImage(raw, dest);
  } finally {
    fs.rmSync(raw, { force: true });
  }
  return { file: dest, prompt: finalPrompt, model, aspectRatio };
}
