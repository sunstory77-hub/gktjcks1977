// 표지 사진 처리: 올린 사진을 ffmpeg로 다시 인코딩해 크기를 맞추고 메타데이터(촬영 위치 등)를 지운다.
// 이미지가 아닌 파일은 여기서 걸러진다. 결과는 JPEG 한 종류로 통일한다.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 릴스(1080×1920)와 카드(1080×1350)를 모두 덮을 수 있는 최대 크기
const MAX_W = 1600;
const MAX_H = 2400;

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

// src(사진 파일) → dest(정규화된 JPEG). 실패하면 사람이 읽을 수 있는 한국어 오류를 던진다.
export async function normalizeImage(src, dest) {
  const stat = fs.statSync(src);
  if (stat.size === 0) throw new Error('빈 사진 파일입니다');
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`사진이 너무 큽니다 (최대 ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`);
  const head = Buffer.alloc(8);
  const fd = fs.openSync(src, 'r');
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  if (!sniff(head)) throw new Error('JPG 또는 PNG 사진만 사용할 수 있습니다');

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ffmpeg = require('ffmpeg-static');
  try {
    await execFileAsync(ffmpeg, [
      '-v', 'error', '-y', '-i', src,
      '-vf', `scale='min(${MAX_W},iw)':'min(${MAX_H},ih)':force_original_aspect_ratio=decrease,format=yuvj420p`,
      '-frames:v', '1', '-map_metadata', '-1', '-q:v', '3', dest,
    ]);
  } catch {
    throw new Error('사진을 읽을 수 없습니다. 다른 파일로 시도해 주세요');
  }
  return dest;
}

export function imageDataUri(file) {
  const buf = fs.readFileSync(file);
  const mime = sniff(buf) === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 회사 로고: 투명 배경을 살리기 위해 PNG로 정규화한다(JPEG 변환 시 투명 영역이 검게 변함).
export async function normalizeLogo(src, dest) {
  const stat = fs.statSync(src);
  if (stat.size === 0) throw new Error('빈 로고 파일입니다');
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`로고가 너무 큽니다 (최대 ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`);
  const head = Buffer.alloc(8);
  const fd = fs.openSync(src, 'r');
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  if (!sniff(head)) throw new Error('로고는 PNG 또는 JPG만 사용할 수 있습니다');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ffmpeg = require('ffmpeg-static');
  try {
    await execFileAsync(ffmpeg, ['-v', 'error', '-y', '-i', src, '-vf', "scale='min(800,iw)':'min(400,ih)':force_original_aspect_ratio=decrease", '-frames:v', '1', '-map_metadata', '-1', '-pix_fmt', 'rgba', dest]);
  } catch {
    throw new Error('로고를 읽을 수 없습니다. 다른 파일로 시도해 주세요');
  }
  return dest;
}
