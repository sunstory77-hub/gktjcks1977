'use strict';
/* 외부 라이브러리 없는 최소 XLSX 생성·읽기 (검수 패키지용). 압축은 Node 기본 zlib 만 사용한다. */
const zlib = require('zlib');

// ───────────── ZIP ─────────────
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date();
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const MAX_ENTRIES = 300, MAX_UNCOMPRESSED = 60 * 1024 * 1024;
function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('ZIP(XLSX) 파일이 아닙니다.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP(XLSX) 구조를 읽을 수 없습니다.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error('파일 안의 항목이 너무 많습니다.');
  const entries = new Map();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 구조가 손상되었습니다.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    total += usize;
    if (total > MAX_UNCOMPRESSED) throw new Error('압축을 풀면 너무 큰 파일입니다.');
    entries.set(name, { method, csize, usize, lho });
    p += 46 + nlen + elen + clen;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const nlen = buf.readUInt16LE(e.lho + 26), elen = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + nlen + elen;
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNCOMPRESSED });
      throw new Error('지원하지 않는 압축 방식입니다.');
    },
  };
}

// ───────────── XML 도우미 ─────────────
const escXml = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function unescXml(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (letters) => { let n = 0; for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

// 스타일 번호: 0 기본, 1 머리글, 2 본문(줄바꿈), 3 읽기 전용(회색), 4 입력(노랑), 5 굵게
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCD6FF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F1F4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8DC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC8C8D0"/></left><right style="thin"><color rgb="FFC8C8D0"/></right><top style="thin"><color rgb="FFC8C8D0"/></top><bottom style="thin"><color rgb="FFC8C8D0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * sheets: [{ name, rows:[[cell,...]], cols:[width,...], validations:[{ range:'G2:G500', list:['a','b'] }] }]
 * cell: 문자열 | 숫자 | { v, s } (s: 스타일 번호)
 */
function buildXlsx(sheets) {
  const files = [];
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: STYLES_XML });
  sheets.forEach((sh, i) => {
    const rowsXml = sh.rows.map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell == null || cell === '') return '';
        const obj = typeof cell === 'object' ? cell : { v: cell };
        const ref = colName(c) + (r + 1);
        const st = obj.s ? ` s="${obj.s}"` : '';
        if (typeof obj.v === 'number') return `<c r="${ref}"${st}><v>${obj.v}</v></c>`;
        return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${escXml(obj.v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    const cols = sh.cols ? `<cols>${sh.cols.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const dv = sh.validations && sh.validations.length
      ? `<dataValidations count="${sh.validations.length}">${sh.validations.map((v) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>"${escXml(v.list.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>` : '';
    const frozen = sh.freezeRow ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozen}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData>${dv}</worksheet>` });
  });
  return makeZip(files);
}

// ───────────── 읽기 ─────────────
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unescXml(m[2]);
  return out;
}
function textOf(xml) {
  let t = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) t += unescXml(m[1] || '');
  return t;
}

/** XLSX → { sheetName: [[셀 문자열...], ...] } (빈 셀은 '') */
function parseXlsx(buf) {
  const zip = readZip(buf);
  const wb = zip.read('xl/workbook.xml');
  if (!wb) throw new Error('엑셀(XLSX) 파일이 아닙니다.');
  const rels = {};
  const relXml = (zip.read('xl/_rels/workbook.xml.rels') || Buffer.alloc(0)).toString('utf8');
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) { const a = attrs(m[0]); if (a.Id) rels[a.Id] = a.Target; }
  const shared = [];
  const ss = zip.read('xl/sharedStrings.xml');
  if (ss) for (const m of ss.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(textOf(m[1] || ''));
  const out = {};
  for (const m of wb.toString('utf8').matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a['r:id'] || a.id;
    let target = rels[rid];
    if (!a.name || !target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.?\//, '');
    const sx = zip.read(target);
    if (!sx) continue;
    const rows = [];
    for (const rm of sx.toString('utf8').matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rnum = parseInt(attrs(rm[1]).r, 10) || rows.length + 1;
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(cm[1]);
        const ci = ca.r ? colIndex(ca.r.replace(/\d+/g, '')) : row.length;
        const inner = cm[2] || '';
        let val = '';
        if (ca.t === 's') { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); val = v ? shared[parseInt(v[1], 10)] || '' : ''; }
        else if (ca.t === 'inlineStr') val = textOf(inner);
        else { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); val = v ? unescXml(v[1]) : ''; }
        row[ci] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
      rows[rnum - 1] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out[a.name] = rows;
  }
  return out;
}

module.exports = { buildXlsx, parseXlsx, makeZip, readZip, escXml, unescXml, crc32 };
