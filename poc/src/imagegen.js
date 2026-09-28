// AI 배경 이미지 생성 (Google Gemini 이미지 모델).
// 표지 사진 칸(coverImage)에 들어갈 "배경"만 만든다. 글자는 템플릿이 그리므로 이미지 안에 글자를 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeImage } from './images.js';

export const DEFAULT_IMAGE_MODEL = process.env.PROMO_IMAGE_MODEL || 'gemini-3.1-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const IMAGE_STYLES = {
  classroom: {
    label: '강의 현장',
    scene: 'A bright, candid photograph of Korean adult learners in a modern classroom, working on laptops. The people sit in the upper half of the frame; the lower half is an empty wooden tabletop. Soft natural window light, warm tones, shallow depth of field.',
  },
  workspace: {
    label: '책상 위 소품',
    scene: 'A clean top-down photograph of a tidy desk: laptop, notebook, pen and a coffee cup. Soft daylight, warm neutral tones. No people.',
  },
  abstract: {
    label: '추상 그래픽',
    scene: 'A minimal abstract background of soft overlapping shapes and gentle gradients in navy, warm orange and cream. Calm, modern, lots of empty space. No people, no objects, no devices — shapes only.',
  },
};
export const DEFAULT_IMAGE_STYLE = 'classroom';

// 강의 주제만 넘긴다. 일시·가격·강사명 같은 사실 정보는 이미지에 필요 없으므로 보내지 않는다.
export function buildImagePrompt(brief, style = DEFAULT_IMAGE_STYLE) {
  const preset = IMAGE_STYLES[style];
  if (!preset) throw new Error(`알 수 없는 이미지 스타일: ${style}`);
  const topic = [String(brief.title ?? '').replace(/\n/g, ' '), brief.subtitle].filter(Boolean).join(' — ');
  return [
    `Background image for a Korean lecture promotion. Lecture topic (in Korean): "${topic}".`,
    brief.target ? `Audience (in Korean): "${brief.target}".` : '',
    preset.scene,
    'Vertical composition. Keep the lower half calm and uncluttered because text will be placed there later.',
    'Absolutely no text, letters, numbers, logos, brand marks or signage anywhere in the image. Laptops and devices are plain and unbranded.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const imageApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// 프롬프트 → 이미지 1장 { buffer, mimeType, model }
export async function generateImage(prompt, { apiKey = imageApiKey(), model = DEFAULT_IMAGE_MODEL, aspectRatio = '9:16', fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 없습니다 (GEMINI_API_KEY 설정 필요)');
  let res;
  try {
    // 키는 URL이 아니라 헤더로 보낸다 (로그·프록시에 남지 않도록)
    res = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
export async function generateCoverImage(brief, dest, { style = DEFAULT_IMAGE_STYLE, prompt, ...opts } = {}) {
  const finalPrompt = prompt || buildImagePrompt(brief, style);
  const { buffer, mimeType, model } = await generateImage(finalPrompt, opts);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = `${dest}.raw${mimeType === 'image/png' ? '.png' : '.jpg'}`;
  fs.writeFileSync(raw, buffer);
  try {
    await normalizeImage(raw, dest);
  } finally {
    fs.rmSync(raw, { force: true });
  }
  return { file: dest, prompt: finalPrompt, model };
}
