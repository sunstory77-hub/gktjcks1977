// AI 공급자 키 연결 테스트. 등록 전에 실제로 모델 목록을 조회해 키가 유효한지, 어떤 모델을 쓸 수 있는지 확인한다.
// (PoC에서 Gemini 키에 Imagen 권한이 없다는 사실을 이 방식으로 발견했다.)
import { DEFAULT_MODEL } from '../../poc/src/ai.js';
import { DEFAULT_IMAGE_MODEL } from '../../poc/src/imagegen.js';

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', use: '카피 생성', keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
  gemini: { label: 'Gemini (Google)', use: 'AI 배경 이미지', keyPattern: /^AIza[A-Za-z0-9_-]{30,}$/ },
};

async function getJson(fetchImpl, url, headers) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`연결 실패: ${err.name === 'TimeoutError' ? '시간 초과' : err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error('키가 유효하지 않거나 권한이 없습니다');
  if (!res.ok) throw new Error(`확인 실패 (${res.status}): ${data.error?.message ?? '알 수 없는 오류'}`);
  return data;
}

// 반환: { models: [...], textModel?, imageModel? } — 모델이 없으면 오류
export async function testKey(provider, apiKey, { fetchImpl = fetch } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`알 수 없는 공급자: ${provider}`);
  const key = String(apiKey ?? '').trim();
  if (!p.keyPattern.test(key)) throw new Error(`${p.label} 키 형식이 아닙니다`);

  if (provider === 'anthropic') {
    const data = await getJson(fetchImpl, 'https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    const models = (data.data ?? []).map((m) => m.id);
    if (!models.length) throw new Error('사용 가능한 Claude 모델이 없습니다');
    return { models, textModel: models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0] };
  }

  const data = await getJson(fetchImpl, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key });
  const models = (data.models ?? []).map((m) => m.name.replace(/^models\//, '')).filter((n) => /image/.test(n) && !/imagen/.test(n));
  if (!models.length) throw new Error('이 키로 쓸 수 있는 Gemini 이미지 모델이 없습니다');
  return { models, imageModel: models.includes(DEFAULT_IMAGE_MODEL) ? DEFAULT_IMAGE_MODEL : models[0] };
}
