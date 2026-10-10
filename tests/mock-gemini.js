'use strict';
/* 테스트 전용 모의 Gemini 서버. 실제 Google API 가 아니다. 키 값에 따라 상황을 흉내 낸다. */
const http = require('http');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const f = 0.6 + 0.4 * (y / h);
      raw[o] = Math.round(rgb[0] * f); raw[o + 1] = Math.round(rgb[1] * f); raw[o + 2] = Math.round(rgb[2] * f);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-embedding-001', 'gemma-3-27b-it']
  .map((id) => ({ name: 'models/' + id, supportedGenerationMethods: id.includes('embedding') ? ['embedContent'] : ['generateContent'] }));

function productName(text) {
  const m = /상품명:\s*(.+)/.exec(text);
  return m ? m[1].trim() : '상품';
}

function planFor(name, variant) {
  const hex = (n) => n;
  const blocks = [
    { type: 'info', fields: { eyebrow: '모의 카테고리', title: name, subtitle: `${name}를 위한 한 줄 소개`, rows: [{ label: '가격', value: '29,900원' }, { label: '구성', value: '본품 1개' }] } },
    { type: 'promo', fields: { badge: '이벤트', title: '모의 프로모션', desc: '입력된 프로모션 문구' } },
    { type: 'hero', fields: { title: name, subtitle: '모의 대표 문구' }, imagePrompts: ['hero scene'] },
    { type: 'headline', fields: { kicker: '이런 분께', title: '모의 고객 고민 제목', points: ['고민 하나', '고민 둘', '고민 셋'] } },
    { type: 'mood', fields: { title: '모의 감성 제목', text: '모의 감성 문장입니다.' }, imagePrompts: ['mood scene'] },
    { type: 'intro', fields: { title: `${name} 소개`, body: '모의 상품 소개 본문입니다.\n두 번째 문단입니다.' } },
    { type: 'features', fields: { title: '핵심 특징', items: [{ title: '특징 하나', desc: '설명 하나' }, { title: '특징 둘', desc: '설명 둘' }, { title: '특징 셋', desc: '설명 셋' }] }, imagePrompts: ['feature scene'] },
    { type: 'gallery', fields: { title: '화보', caption: '모의 캡션' }, imagePrompts: ['gallery one', variant === 'partial' ? 'FAILME gallery two' : 'gallery two', 'gallery three'] },
    { type: 'usage', fields: { title: '사용 방법', steps: [{ title: '첫째', desc: '준비합니다' }, { title: '둘째', desc: '사용합니다' }, { title: '셋째', desc: '보관합니다' }] }, imagePrompts: ['usage scene'] },
    { type: 'detail', fields: { title: '디테일', items: [{ title: '소재', desc: '입력된 정보 기준' }, { title: '마감', desc: '꼼꼼하게' }] }, imagePrompts: ['detail one', 'detail two'] },
    { type: 'faq', fields: { title: '자주 묻는 질문', faqs: [{ q: '배송은 얼마나 걸리나요?', a: '입력된 배송 조건을 확인해 주세요.' }], specTitle: '규격', specs: [{ label: '구성', value: '본품 1개' }] } },
    { type: 'cta', fields: { title: '지금 만나보세요', desc: `${name}와 함께하세요`, buttonLabel: '자세히 보기' } },
  ];
  return { brief: { category: '모의', mood: '차분하고 따뜻한', tone: '친근한', imageStyle: 'soft natural light', palette: { bg: '#FFF8EE', surface: '#FFFFFF', tint: '#FBE9CF', ink: '#2D2013', sub: '#6B5842', accent: '#D4701F', accent2: '#F2B66B', onAccent: '#FFFFFF' } }, blocks };
}

function createMock() {
  const log = [];
  let imgCount = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const key = req.headers['x-goog-api-key'] || '';
      const url = new URL(req.url, 'http://x');
      const out = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      if (url.pathname === '/__log') return out(200, log);
      if (url.searchParams.get('key')) return out(400, { error: { message: 'key in URL not allowed in this test' } });
      if (key.startsWith('BAD_KEY')) return out(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
      if (!key) return out(403, { error: { message: 'missing key', status: 'PERMISSION_DENIED' } });
      if (url.pathname.endsWith('/models')) return out(200, { models: MODELS });

      const m = /\/models\/([^:]+):generateContent$/.exec(url.pathname);
      if (!m) return out(404, { error: { message: 'not found' } });
      let j = {};
      try { j = JSON.parse(body); } catch { return out(400, { error: { message: 'bad json' } }); }
      const parts = (j.contents && j.contents[0] && j.contents[0].parts) || [];
      const text = parts.map((p) => p.text || '').join('\n');
      const isImage = !!(j.generationConfig && j.generationConfig.responseModalities);
      const inline = parts.filter((p) => p.inlineData).length;
      log.push({ model: m[1], image: isImage, search: !!j.tools, inlineImages: inline, task: (/\[TASK:([a-z-]+)\]/.exec(text) || [])[1] || '', textLen: text.length, keyHeader: !!key, aspect: j.generationConfig && j.generationConfig.imageConfig && j.generationConfig.imageConfig.aspectRatio, text: text.slice(0, 6000) });

      if (key.startsWith('QUOTA_KEY')) return out(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
      if (key.startsWith('SLOW_KEY')) await new Promise((r) => setTimeout(r, 4000));
      if (key.startsWith('PERM_KEY')) return out(403, { error: { code: 403, message: 'permission denied', status: 'PERMISSION_DENIED' } });

      const wrap = (t) => out(200, { candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] });

      if (isImage) {
        if (key.startsWith('GARBAGE_KEY')) return wrap('이미지 대신 글자만 보냅니다');
        if (/FAILME/.test(text)) return out(503, { error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } });
        imgCount += 1;
        const colors = [[200, 120, 90], [90, 150, 200], [120, 190, 130], [190, 150, 210], [220, 190, 90]];
        const data = png(256, 320, colors[imgCount % colors.length]).toString('base64');
        return out(200, { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data } }] }, finishReason: 'STOP' }] });
      }
      if (key.startsWith('GARBAGE_KEY') && !j.tools) return wrap('죄송하지만 JSON을 만들 수 없습니다.');

      const task = (/\[TASK:([a-z-]+)\]/.exec(text) || [])[1];
      const name = productName(text);
      if (task === 'organize') {
        const base = {
          sections: { overview: `${name}은(는) 모의 정리 결과입니다.`, features: ['특징 A', '특징 B'], spec: '구성: 본품 1개', usage: '서늘한 곳에 보관', purchase: '배송 조건은 원문을 따릅니다', checks: ['인증 여부 확인 필요'] },
        };
        if (key.startsWith('WEIRD_KEY')) {
          // 다양한 응답 형식: 고객층이 객체/배열/누락, 코드펜스, 마지막 쉼표
          const variant = (log.filter((l) => l.task === 'organize').length) % 4;
          if (variant === 1) return wrap('```json\n' + JSON.stringify({ ...base, target: { age: '20~30대', interests: ['캠핑', '요리'], needs: '간편함' } }) + '\n```');
          if (variant === 2) return wrap(JSON.stringify({ ...base, target: ['직장인', '1인 가구'] }));
          if (variant === 3) return wrap('{"sections":{"overview":"끝 쉼표 응답","features":"한 줄"},}');
          return wrap(JSON.stringify({ ...base, target: '30대 직장인' }));
        }
        return wrap(JSON.stringify({ ...base, target: '30대 직장인' }));
      }
      if (task === 'plan') {
        const variant = key.startsWith('PARTIAL_KEY') ? 'partial' : '';
        return wrap(JSON.stringify(planFor(name, variant)));
      }
      if (task === 'edit-text') {
        const cur = /현재 문구\(JSON\): (.+)/.exec(text);
        let fields = {};
        try { fields = JSON.parse(cur[1]); } catch { /* 무시 */ }
        if (fields.title !== undefined) fields.title = '수정된 ' + (fields.title || '제목');
        return wrap(JSON.stringify({ fields }));
      }
      if (task === 'photos') return wrap('사진 분석 결과: 흰 배경 위의 제품입니다. 확인 불가: 인증.');
      if (task === 'research') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '검색 결과 요약: 모의 정보입니다.' }] }, finishReason: 'STOP', groundingMetadata: key.startsWith('NOSRC_KEY') ? {} : { groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }, { web: { uri: 'https://example.org/b', title: 'example.org' } }] } }] }));
      }
      return wrap('{}');
    });
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 47999;
  createMock().listen(port, '127.0.0.1', () => console.log('mock gemini on ' + port));
}

module.exports = { createMock, png };
