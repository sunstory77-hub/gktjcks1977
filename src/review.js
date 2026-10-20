'use strict';
/* 전문 번역 검수 패키지: 프로젝트 → XLSX/XLIFF 내보내기, 검수 결과 파일 → 변경 목록 가져오기 */
const S = require('../public/js/schema.js');
const { buildXlsx, parseXlsx, makeZip } = require('./xlsx.js');
const { buildXliff, parseXliff } = require('./xliff.js');

const HDR = { id: 'ID', block: '블록', item: '항목', ko: '원문 (한국어)', ai: 'AI 번역 (초안)', tr: '번역 (검수본)', status: '검수 상태', note: '검수 메모', qa: '자동 점검', cur: '현재 상태' };
const OK_LABEL = '검수 완료', FIX_LABEL = '수정 필요';

const prettyPath = S.prettyPath;

const nl = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').normalize('NFC').trim();

// 한 언어의 번역 대상 행(블록 순서대로)
function segments(project, lang, opts) {
  const rows = [];
  const pendingOnly = !!(opts && opts.pending);
  for (const b of project.blocks) {
    if (!S.needsTranslation(b)) continue;
    const lb = S.localizeBlock(project, lang, b);
    if (lb.hidden) continue;
    const rec = S.getTr(project, lang, b.type) || { t: {}, ai: null, note: '' };
    const status = S.trStatus(project, lang, b);
    if (pendingOnly && status === 'approved') continue;
    const qa = S.qaCheck(project, lang, b);
    for (const { path, text } of S.flatten(b.fields)) {
      rows.push({
        id: `${b.type}|${path}`, type: b.type, path, block: S.LABELS[b.type], item: prettyPath(path), source: text,
        ai: (rec.ai && rec.ai[path]) || '', current: rec.t[path] || '', status, note: rec.note || '',
        qa: qa.filter((w) => w.path === path).map((w) => w.msg).join(' / '),
      });
    }
  }
  return rows;
}

function guideRows(project, langs) {
  const L = (c) => (S.LANG_BY[c] ? `${S.LANG_BY[c].name}(${c})` : c);
  return [
    [{ v: 'DETAIL PAGE AI 번역 검수 요청서', s: 5 }],
    [`상품: ${project.product.name || project.name}   |   원문 언어: 한국어   |   검수 언어: ${langs.map(L).join(', ')}`],
    [''],
    [{ v: '검수 방법 (Instructions for reviewers)', s: 5 }],
    ['1. 각 언어 시트의 노란색 칸만 수정해 주세요: [번역 (검수본)], [검수 상태], [검수 메모].'],
    ['   Edit only the yellow cells: reviewed translation, status and memo. Do not change ID or source columns.'],
    ['2. ID 열과 원문(한국어) 열은 절대 수정하거나 행을 삭제·이동하지 마세요. (되돌려 받을 때 이 ID로 대조합니다)'],
    ['3. 번역이 맞으면 [검수 상태]를 "검수 완료"로, 질문·보류가 있으면 "수정 필요"로 선택하고 [검수 메모]에 사유를 적어 주세요.'],
    ['4. 숫자·단위·상품명은 원문과 같아야 합니다. 번역 금지 용어와 용어집 시트의 번역어를 지켜 주세요.'],
    ['5. 줄바꿈은 셀 안에서 Alt+Enter 로 넣으며, 한 칸의 길이는 원문과 비슷하게 유지해 주세요(이미지 레이아웃에 들어갑니다).'],
    ['6. 효능·성분·인증 표현은 현지 광고 규정에 맞는지 확인해 주세요. 원문에 없는 주장을 추가하지 마세요.'],
    ['7. 작업이 끝나면 이 파일을 그대로 저장해 보내 주세요. (XLSX 형식 유지)'],
    [''],
    [{ v: '시트 안내', s: 5 }],
    ['• 언어별 시트(EN/JA/ZH-CN): 검수할 문장 목록   • 용어집: 번역어 통일·번역 금지 용어   • 시장정보: 국가별 가격·상품명 등 참고 정보'],
  ];
}

function buildReviewXlsx(project, langs, opts) {
  const sheets = [{ name: '안내', rows: guideRows(project, langs), cols: [120] }];
  for (const lang of langs) {
    const rows = [[HDR.id, HDR.block, HDR.item, HDR.ko, HDR.ai, HDR.tr, HDR.status, HDR.note, HDR.qa, HDR.cur].map((v) => ({ v, s: 1 }))];
    for (const r of segments(project, lang, opts)) {
      rows.push([
        { v: r.id, s: 3 }, { v: r.block, s: 3 }, { v: r.item, s: 3 }, { v: r.source, s: 3 }, { v: r.ai || r.current, s: 3 },
        { v: r.current, s: 4 }, { v: '', s: 4 }, { v: '', s: 4 }, { v: r.qa, s: 3 }, { v: S.STATUS_LABEL[r.status] || '', s: 3 },
      ]);
    }
    sheets.push({ name: lang.toUpperCase(), rows, cols: [22, 14, 22, 46, 46, 46, 12, 30, 30, 12], freezeRow: true, validations: [{ range: `G2:G${Math.max(rows.length, 2) + 50}`, list: [OK_LABEL, FIX_LABEL] }] });
  }
  const gl = [['한국어 용어', '번역 금지', ...langs.map((c) => c.toUpperCase())].map((v) => ({ v, s: 1 }))];
  for (const g of (project.i18n && project.i18n.glossary) || []) gl.push([{ v: g.ko, s: 3 }, { v: g.dnt ? '예(그대로 사용)' : '', s: 3 }, ...langs.map((c) => ({ v: (g.tr && g.tr[c]) || '', s: 3 }))]);
  sheets.push({ name: '용어집', rows: gl, cols: [24, 16, ...langs.map(() => 26)], freezeRow: true });
  const mk = [['언어', '항목', '내용'].map((v) => ({ v, s: 1 }))];
  for (const c of langs) {
    const m = (S.getLangData(project, c) || {}).market || {};
    for (const [k, label] of [['name', '현지 상품명'], ['price', '현지 가격'], ['shipping', '배송 조건'], ['promo', '프로모션'], ['notes', '메모']]) if (m[k]) mk.push([{ v: c.toUpperCase(), s: 3 }, { v: label, s: 3 }, { v: m[k], s: 3 }]);
  }
  sheets.push({ name: '시장정보', rows: mk, cols: [10, 18, 60], freezeRow: true });
  return buildXlsx(sheets);
}

const STATE_OUT = { ai: 'needs-review-translation', edited: 'translated', review: 'needs-review-translation', approved: 'final', stale: 'needs-adaptation', none: 'new' };
function buildReviewXliff(project, lang, opts) {
  const units = segments(project, lang, opts).map((r) => ({
    id: r.id, resname: `${r.block} › ${r.item}`, source: r.source, target: r.current || r.ai, state: STATE_OUT[r.status] || 'needs-review-translation',
    notes: [{ from: 'auto-qa', text: r.qa }, { from: 'reviewer', text: r.note }],
  }));
  return buildXliff({ original: project.id, sourceLang: 'ko', targetLang: lang, units });
}

function buildPackage(project, langs, format, opts) {
  const list = langs.filter((c) => S.LANG_BY[c] && !S.LANG_BY[c].source);
  if (!list.length) throw new Error('검수할 언어를 선택해 주세요.');
  const base = (project.name || 'project').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 50);
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (format === 'xliff') {
    if (list.length === 1) return { filename: `${base}_검수_${list[0]}_${ymd}.xlf`, mime: 'application/xliff+xml', data: Buffer.from(buildReviewXliff(project, list[0], opts), 'utf8') };
    return { filename: `${base}_검수_XLIFF_${ymd}.zip`, mime: 'application/zip', data: makeZip(list.map((c) => ({ name: `${base}_${c}.xlf`, data: buildReviewXliff(project, c, opts) }))) };
  }
  return { filename: `${base}_검수_${ymd}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buildReviewXlsx(project, list, opts) };
}

// ───────────── 가져오기 ─────────────
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
function langFromName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/_/g, '-');
  for (const l of S.TARGET_LANGS) {
    const c = l.code.toLowerCase();
    if (n === c || n === c.split('-')[0] && !c.includes('-') || n === (l.short || '').toLowerCase() || n.startsWith(c + '-') || (l.code === 'zh-CN' && /^zh(-hans)?(-cn)?$/.test(n))) return l.code;
  }
  return null;
}
function statusFromLabel(v) {
  const t = norm(v);
  if (!t) return '';
  if (['검수완료', '완료', 'ok', 'approved', 'final', 'done', 'reviewed'].includes(t)) return 'approved';
  if (['수정필요', '질문', '보류', 'fix', 'query', 'hold'].includes(t)) return 'flag';
  return '';
}

function makeItem(project, lang, id, fileSource, after, status, note, ai) {
  const m = /^([a-z]+)\|([A-Za-z0-9_.]+)$/.exec(String(id || '').trim());
  const item = { lang, id: String(id || '').trim(), after: nl(after), fileSource: nl(fileSource), status, note: nl(note), unknown: false };
  const block = m && project.blocks.find((b) => b.type === m[1]);
  const ko = block ? S.flatten(block.fields).find((x) => x.path === m[2]) : null;
  if (!m || !block || !ko) { item.unknown = true; item.type = m ? m[1] : ''; item.path = m ? m[2] : ''; item.label = item.id; return item; }
  const rec = S.getTr(project, lang, m[1]);
  item.type = m[1]; item.path = m[2];
  item.label = `${S.LABELS[m[1]]} › ${prettyPath(m[2])}`;
  item.source = ko.text;
  item.srcMatch = !item.fileSource || nl(ko.text) === item.fileSource;
  item.current = (rec && rec.t[m[2]]) || '';
  item.ai = (rec && rec.ai && rec.ai[m[2]]) || ai || '';
  item.changed = !!item.after && nl(item.after) !== nl(item.current);
  return item;
}

/** 검수 결과 파일(XLSX/XLIFF) → 변경 목록. 프로젝트는 바꾸지 않는다(화면에서 확인 후 적용). */
function parseReviewFile(project, filename, buf) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  const items = [];
  const warnings = [];
  if (ext === 'xlf' || ext === 'xliff') {
    const x = parseXliff(buf.toString('utf8'));
    const lang = langFromName(x.targetLang);
    if (!lang) throw new Error(`지원하지 않는 언어입니다(${x.targetLang || '언어 정보 없음'}).`);
    for (const u of x.units) {
      const st = /^(final|signed-off)$/.test(u.state) ? 'approved' : '';
      const note = (u.notes.find((n) => n.from === 'reviewer') || {}).text || '';
      items.push(makeItem(project, lang, u.id, u.source, u.target, st, note));
    }
  } else if (ext === 'xlsx') {
    const book = parseXlsx(buf);
    for (const [name, rows] of Object.entries(book)) {
      const lang = langFromName(name);
      if (!lang) continue;
      let hi = rows.findIndex((r) => r.some((c) => norm(c) === norm(HDR.id)));
      if (hi < 0) { warnings.push(`${name} 시트에서 머리글(ID)을 찾지 못했습니다.`); continue; }
      const head = rows[hi].map(norm);
      const col = (h) => head.indexOf(norm(h));
      const cId = col(HDR.id), cKo = col(HDR.ko), cAi = col(HDR.ai), cTr = col(HDR.tr), cSt = col(HDR.status), cNote = col(HDR.note);
      if (cTr < 0) { warnings.push(`${name} 시트에 '${HDR.tr}' 열이 없습니다.`); continue; }
      for (let r = hi + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        if (!String(row[cId] || '').trim()) continue;
        items.push(makeItem(project, lang, row[cId], cKo >= 0 ? row[cKo] : '', row[cTr], cSt >= 0 ? statusFromLabel(row[cSt]) : '', cNote >= 0 ? row[cNote] : '', cAi >= 0 ? row[cAi] : ''));
      }
    }
    if (!items.length && !warnings.length) warnings.push('언어 시트(EN/JA/ZH-CN)를 찾지 못했습니다. 내보낸 검수 요청서 파일이 맞는지 확인해 주세요.');
  } else {
    throw new Error('XLSX 또는 XLIFF(.xlf) 파일만 가져올 수 있습니다.');
  }
  const summary = { total: items.length, changed: 0, approved: 0, flagged: 0, unknown: 0, srcChanged: 0, empty: 0 };
  for (const it of items) {
    if (it.unknown) { summary.unknown += 1; continue; }
    if (it.changed) summary.changed += 1;
    if (it.status === 'approved') summary.approved += 1;
    if (it.status === 'flag') summary.flagged += 1;
    if (!it.srcMatch) summary.srcChanged += 1;
    if (!it.after) summary.empty += 1;
  }
  return { items, summary, warnings, langs: [...new Set(items.map((i) => i.lang))] };
}

module.exports = { segments, prettyPath, buildPackage, buildReviewXlsx, buildReviewXliff, parseReviewFile, HDR, OK_LABEL, FIX_LABEL, statusFromLabel, langFromName };
