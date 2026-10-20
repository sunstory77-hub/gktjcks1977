'use strict';
/* XLIFF 1.2 생성·읽기 (번역 도구(CAT)로 검수할 때 사용). 외부 라이브러리 없음. */
const { escXml, unescXml } = require('./xlsx.js');

// units: [{ id, resname, source, target, state, notes:[{from,text}] }]
function buildXliff({ original, sourceLang, targetLang, units }) {
  const body = units.map((u) => `    <trans-unit id="${escXml(u.id)}" resname="${escXml(u.resname || '')}" xml:space="preserve">
      <source xml:lang="${escXml(sourceLang)}">${escXml(u.source)}</source>
      <target xml:lang="${escXml(targetLang)}" state="${escXml(u.state || 'needs-review-translation')}">${escXml(u.target || '')}</target>${(u.notes || []).filter((n) => n.text).map((n) => `
      <note from="${escXml(n.from)}">${escXml(n.text)}</note>`).join('')}
    </trans-unit>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file original="${escXml(original)}" source-language="${escXml(sourceLang)}" target-language="${escXml(targetLang)}" datatype="plaintext">
    <body>
${body}
    </body>
  </file>
</xliff>
`;
}

// 인라인 태그(<x/>, <g>, <bpt> 등)는 제거하고 줄바꿈 표시는 \n 으로 바꾼다. CDATA 지원.
function cleanInline(inner) {
  let s = String(inner || '');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  s = s.replace(/<x\b[^>]*ctype="lb"[^>]*\/>/g, '\n').replace(/<(?:ph|x|bx|ex)\b[^>]*\/>/g, '').replace(/<\/?(?:g|bpt|ept|ph|it|mrk|sub)\b[^>]*>/g, '');
  return unescXml(s);
}

/** XLIFF → { sourceLang, targetLang, units:[{ id, source, target, state, notes }] } */
function parseXliff(text) {
  const s = String(text || '').replace(/^﻿/, '');
  if (!/<xliff\b/.test(s)) throw new Error('XLIFF 파일이 아닙니다.');
  const f = /<file\b([^>]*)>/.exec(s);
  const fa = {};
  if (f) for (const m of f[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) fa[m[1]] = unescXml(m[2]);
  const units = [];
  for (const m of s.matchAll(/<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/g)) {
    const ua = {};
    for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) ua[a[1]] = unescXml(a[2]);
    const src = /<source\b[^>]*>([\s\S]*?)<\/source>/.exec(m[2]);
    const tgt = /<target\b([^>]*)>([\s\S]*?)<\/target>|<target\b[^>]*\/>/.exec(m[2]);
    const state = tgt && tgt[1] ? ((/state="([^"]*)"/.exec(tgt[1]) || [])[1] || '') : '';
    const notes = [];
    for (const n of m[2].matchAll(/<note\b([^>]*)>([\s\S]*?)<\/note>/g)) notes.push({ from: ((/from="([^"]*)"/.exec(n[1]) || [])[1]) || '', text: cleanInline(n[2]) });
    if (ua.id) units.push({ id: ua.id, source: src ? cleanInline(src[1]) : '', target: tgt && tgt[2] != null ? cleanInline(tgt[2]) : '', state, notes });
  }
  return { sourceLang: fa['source-language'] || '', targetLang: fa['target-language'] || '', original: fa.original || '', units };
}

module.exports = { buildXliff, parseXliff };
