// 자료(PDF·PPTX·DOCX) → 팩트 시트 초안. 저장하지 않고 초안만 돌려주며, 사람이 확인한 뒤 저장한다.
// PPTX·DOCX는 파일 안의 글자를 직접 뽑고, PDF는 Claude에 문서 그대로 넘긴다.
// 자료에 없는 값은 비워 두고 missing 목록으로 알린다(지어내지 않음).
import Anthropic from '@anthropic-ai/sdk';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_MODEL, structuredCall } from './ai.js';
import { KINDS, DEFAULT_KIND, fieldGuide } from './kinds.js';

export const IMPORT_TYPES = { '.pdf': 'pdf', '.pptx': 'pptx', '.docx': 'docx' };
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 60_000; // 글자 수가 이보다 많으면 거절(잘라서 보내지 않음)

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// PPTX: 슬라이드 순서대로 <a:t> 글자 + 발표자 노트
export function pptxText(buf) {
  const files = unzipSync(new Uint8Array(buf));
  const num = (n) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  if (!slides.length) throw new Error('PPTX에서 슬라이드를 찾지 못했습니다');
  return slides
    .map((n) => {
      const xml = strFromU8(files[n]);
      const paras = xml.split(/<\/a:p>/).map((p) => decode([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))).filter((t) => t.trim());
      const notes = files[`ppt/notesSlides/notesSlide${num(n)}.xml`];
      const noteText = notes ? decode([...strFromU8(notes).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ')).trim() : '';
      return [`[슬라이드 ${num(n)}]`, ...paras, noteText && `(노트) ${noteText}`].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

// DOCX: 문단(<w:p>) 단위 <w:t> 글자
export function docxText(buf) {
  const files = unzipSync(new Uint8Array(buf));
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('DOCX 본문을 찾지 못했습니다');
  return strFromU8(doc)
    .split(/<\/w:p>/)
    .map((p) => decode([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')))
    .filter((t) => t.trim())
    .join('\n');
}

const str = { type: 'string' };
const arr = { type: 'array', items: { type: 'string' } };
const FACT_KEYS = ['tag', 'title', 'subtitle', 'instructor', 'target', 'painPoints', 'promise', 'curriculum', 'benefits', 'date', 'place', 'price', 'cta'];
const IMPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts', 'missing', 'notes'],
  properties: {
    facts: {
      type: 'object',
      additionalProperties: false,
      required: FACT_KEYS,
      properties: {
        tag: str, title: str, subtitle: str, instructor: str, target: str, painPoints: arr, promise: str, curriculum: arr, benefits: arr, date: str, place: str, price: str, cta: str,
      },
    },
    missing: { type: 'array', items: { type: 'string', enum: FACT_KEYS }, description: '자료에서 찾지 못해 비워 둔 항목' },
    notes: { type: 'array', items: str, description: '사람이 확인해야 할 점 (예: 날짜가 지났음, 강사명이 두 가지로 나옴)' },
  },
};

function systemFor(kind) {
  const k = KINDS[kind] ?? KINDS[DEFAULT_KIND];
  const L = k.labels;
  return `당신은 ${k.subject} 자료에서 홍보용 팩트 시트를 뽑는 편집자입니다.
${fieldGuide({ kind })}
규칙:
- 자료에 적힌 사실만 옮깁니다. 자료에 없는 ${L.date}·${L.place}·${L.price}·${L.instructor}·${L.cta}는 빈 문자열로 두고 missing에 넣습니다. 추측하지 않습니다.
- title은 홍보용 제목으로 한 줄 10자 안팎 최대 2줄(줄바꿈 \\n), subtitle 20자, tag 12자 이내로 다듬습니다(내용은 자료 그대로).
- painPoints(${L.painPoints})는 자료 내용에서 유추한 3개, curriculum(${L.curriculum})은 핵심 최대 4개, benefits(${L.benefits})는 최대 3개. 각 22자 안팎.
- promise는 자료가 약속하는 결과 한 문장(26자 이내).
- 여러 회차·상품이 섞여 있으면 가장 비중이 큰 하나를 고르고 notes에 적습니다.
- 날짜가 오늘(${new Date().toISOString().slice(0, 10)}) 이전이면 notes에 적습니다.`;
}

// buf: 파일 내용, type: 'pdf'|'pptx'|'docx' → { facts, missing, notes, source }
export async function importFacts(buf, type, { client = new Anthropic(), model = process.env.PROMO_MODEL || DEFAULT_MODEL, kind = DEFAULT_KIND } = {}) {
  if (buf.length > MAX_IMPORT_BYTES) throw new Error(`자료가 너무 큽니다 (최대 ${MAX_IMPORT_BYTES / 1024 / 1024}MB)`);
  let content;
  if (type === 'pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('PDF 파일이 아닙니다');
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
      { type: 'text', text: '이 자료로 홍보용 팩트 시트를 만들어 주세요.' },
    ];
  } else if (type === 'pptx' || type === 'docx') {
    let text;
    try {
      text = type === 'pptx' ? pptxText(buf) : docxText(buf);
    } catch (err) {
      throw new Error(err.message.includes('찾지 못') ? err.message : `${type.toUpperCase()} 파일을 읽을 수 없습니다`);
    }
    if ([...text].length > MAX_TEXT) throw new Error(`자료 글자 수가 너무 많습니다 (최대 ${MAX_TEXT.toLocaleString()}자). 필요한 부분만 남겨 다시 올려 주세요`);
    content = `다음 자료로 홍보용 팩트 시트를 만들어 주세요.\n\n<자료>\n${text}\n</자료>`;
  } else throw new Error('PDF, PPTX, DOCX만 올릴 수 있습니다');

  const { data, model: used } = await structuredCall({ client, model, system: systemFor(kind), content, schema: IMPORT_SCHEMA });
  // 비어 있는데 missing에 없으면 추가(모델이 빠뜨린 경우)
  const required = new Set((KINDS[kind] ?? KINDS[DEFAULT_KIND]).required.concat(['date', 'place', 'price', 'instructor', 'cta']));
  const missing = new Set(data.missing);
  for (const k of FACT_KEYS) {
    if (!required.has(k)) continue;
    const v = data.facts[k];
    if (Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim()) missing.add(k);
  }
  return { facts: data.facts, missing: [...missing], notes: data.notes, source: `ai:${used}` };
}
