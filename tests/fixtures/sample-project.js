'use strict';
/* i18n 시험용 표본 프로젝트(결정적). 블록 id 는 무작위지만 번역·검수 키는 type|path 라 파일과 대응된다. */
const S = require('../../public/js/schema.js');

function makeProject(opts) {
  opts = opts || {};
  const product = { name: '한라봉 주스 200ml 12입', description: '제주 한라봉 100% 착즙. 설탕을 넣지 않았습니다. 냉장 보관하세요.', target: '30대 직장인', price: '29,900원', spec: '용량: 200ml\n구성: 12입', shipping: '3,000원', promo: '' };
  const { blocks, brief } = S.buildBlocks(product, []);
  const proj = S.sanitizeProject({ name: '한라봉 주스', product, blocks, brief, i18n: { langs: opts.langs || ['en', 'ja'], data: {}, glossary: opts.glossary || [{ ko: '한라봉', tr: { en: 'Hallabong', ja: 'ハルラボン', 'zh-CN': '汉拿峰' } }] } });
  if (opts.translate !== false) {
    for (const lang of proj.i18n.langs) {
      const data = (proj.i18n.data[lang] = proj.i18n.data[lang] || S.sanitizeI18n({ langs: [lang] }).data[lang]);
      for (const b of proj.blocks) {
        if (!S.needsTranslation(b)) continue;
        const t = {};
        for (const { path, text } of S.flatten(b.fields)) t[path] = `${lang.toUpperCase()}: ${text.replace(/[가-힣]+/g, (w) => (w === '한라봉' ? 'Hallabong' : 'x'))}`;
        data.blocks[b.type] = { t, ai: { ...t }, status: 'ai', srcHash: S.fieldsHash(b.type, b.fields), note: '', by: '', at: '', updatedAt: '' };
      }
    }
  }
  return proj;
}
module.exports = { makeProject };
