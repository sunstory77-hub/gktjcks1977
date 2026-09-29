// AI 생성물 표시 (인공지능기본법 대응): 기계가 읽을 수 있는 표시를 모든 결과물에 넣는다.
// - PNG: XMP(iTXt) — IPTC DigitalSourceType "compositeWithTrainedAlgorithmicMedia"(AI 생성 요소를 포함한 합성물)
// - MP4: 컨테이너 메타데이터(comment) — ffmpeg로 재인코딩 없이 다시 묶기
// 사람이 보는 표시(배지)는 렌더러의 aiBadge 옵션이 담당한다. [기준: 2026-09 / 확인 필요 — 표시 방식 세부 기준은 시행령·고시 확인]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

export const AI_SOURCE_TYPE = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
export const AI_NOTICE = '생성형 AI를 활용해 제작한 콘텐츠입니다';
const XMP_KEY = 'XML:com.adobe.xmp';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const xmp = (tool) => `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<Iptc4xmpExt:DigitalSourceType>${AI_SOURCE_TYPE}</Iptc4xmpExt:DigitalSourceType>
<xmp:CreatorTool>${tool}</xmp:CreatorTool>
<dc:description><rdf:Alt><rdf:li xml:lang="ko">${AI_NOTICE}</rdf:li></rdf:Alt></dc:description>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="r"?>`;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// PNG 버퍼의 청크 목록 [{ type, start, end, data }]
function chunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('PNG 파일이 아닙니다');
  const out = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    out.push({ type, start: i, end: i + 12 + len, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
  }
  return out;
}

// PNG에 XMP를 넣는다(이미 있으면 교체). IHDR 바로 뒤에 둔다.
export function labelPng(file, { tool = '홍보공장' } = {}) {
  const buf = fs.readFileSync(file);
  const list = chunks(buf).filter((c) => !(c.type === 'iTXt' && c.data.toString('latin1', 0, XMP_KEY.length) === XMP_KEY));
  const itxt = chunk('iTXt', Buffer.concat([Buffer.from(`${XMP_KEY}\0\0\0\0\0`, 'latin1'), Buffer.from(xmp(tool), 'utf8')]));
  const parts = [PNG_SIG];
  for (const c of list) {
    parts.push(buf.subarray(c.start, c.end));
    if (c.type === 'IHDR') parts.push(itxt);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

// 테스트·검수용: PNG에 AI 표시가 있는지
export function readPngLabel(file) {
  const c = chunks(fs.readFileSync(file)).find((x) => x.type === 'iTXt' && x.data.toString('latin1', 0, XMP_KEY.length) === XMP_KEY);
  if (!c) return null;
  const text = c.data.subarray(XMP_KEY.length + 5).toString('utf8');
  return { sourceType: /<Iptc4xmpExt:DigitalSourceType>([^<]+)</.exec(text)?.[1], xmp: text };
}

// MP4에 표시 메타데이터 (영상·음성은 그대로 복사)
export async function labelMp4(file, { tool = '홍보공장' } = {}) {
  const tmp = `${file}.label.mp4`;
  const ffmpeg = require('ffmpeg-static');
  await execFileAsync(ffmpeg, ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', '-metadata', `comment=${AI_NOTICE} (${AI_SOURCE_TYPE})`, '-metadata', `description=${tool}`, '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, file);
  return file;
}
