'use strict';
/* 실제 Gemini 키로 API 경로(고품질 정리·문구 수정·이미지 다시 생성/수정)를 점검한다. 브라우저 불필요.
   사용: GEMINI_API_KEY=... PHOTO=사진.png node tests/e2e/real-gemini-api.js  (비용 발생: 호출 약 5회) */
const fs = require('fs');
const { startApp, tmpDir, getToken, apiClient } = require('../harness.js');
const KEY = process.env.GEMINI_API_KEY;
if (!KEY || !process.env.PHOTO) { console.error('GEMINI_API_KEY 와 PHOTO 가 필요합니다.'); process.exit(2); }
const mask = (s) => String(s).split(KEY).join('[키]');
(async () => {
  const app = await startApp({ dataDir: tmpDir('realapi') });
  try {
    const api = apiClient(app.port, await getToken(app.port));
    const c = await api.post('/api/connect', { key: KEY });
    console.log('connect', c.status, JSON.stringify(c.json.models));
    await api.post('/api/consent', { agree: true });
    const proj = (await api.post('/api/projects', {})).json.project;
    const up = await api.call('POST', `/api/projects/${proj.id}/assets`, fs.readFileSync(process.env.PHOTO), { 'content-type': 'image/png' });
    const product = { name: '제주 한라봉 주스 200ml 12입', description: '제주 한라봉을 껍질째 착즙한 100% 주스. 냉장 보관.', target: '30대 직장인', price: '29,900원', spec: '용량: 200ml\n구성: 12입', shipping: '3,000원', promo: '' };
    const photoAssetIds = [up.json.id];
    const t = Date.now(); const lap = (s) => console.log(`[${((Date.now() - t) / 1000).toFixed(0)}s] ${s}`);

    const o = await api.post('/api/ai/organize', { projectId: proj.id, product, photoAssetIds, mode: 'high' });
    lap(`고품질 정리 ${o.status}: ` + mask(o.text).replace(/\n+/g, ' ').slice(0, 200));

    const fields = { title: '제주 한라봉 100% 착즙', subtitle: '껍질째 담았습니다', rows: [] };
    const e = await api.post('/api/ai/edit-text', { type: 'hero', fields, instruction: '더 짧고 담백하게', product, brief: {}, mode: 'normal' });
    lap(`문구 수정 ${e.status}: ` + JSON.stringify(e.json.fields || e.json));

    const slotId = 'b_aaaaaaaaaaaaaaaa_main';
    const job = async (items) => { const r = await api.post('/api/ai/images', { projectId: proj.id, product, brief: {}, photoAssetIds, mode: 'normal', items }); for (let i = 0; i < 90; i++) { await new Promise((x) => setTimeout(x, 2000)); const v = (await api.get(`/api/jobs/${r.json.jobId}`)).json; if (v.status !== 'running') return v; } throw new Error('시간 초과'); };
    const v1 = await job([{ slotId, prompt: 'Product hero shot on a wooden table, morning light', aspect: '4:5', baseAssetId: null, instruction: '' }]);
    lap('이미지 다시 생성: ' + JSON.stringify(v1.images));
    const a1 = v1.images[slotId] && v1.images[slotId].assetId;
    if (a1) {
      const v2 = await job([{ slotId, prompt: '', aspect: '4:5', baseAssetId: a1, instruction: '배경을 밝은 흰색 스튜디오로 바꿔줘' }]);
      lap('이미지 수정: ' + JSON.stringify(v2.images));
    }
  } finally { await app.stop(); }
})().catch((e) => { console.error('실패:', mask(e.message)); process.exit(1); });
