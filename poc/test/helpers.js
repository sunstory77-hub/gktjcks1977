// 테스트용 이미지 생성·픽셀 읽기 (ffmpeg-static 사용)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');

export function makeImage(file, { color = 'white', size = '1200x1600' } = {}) {
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', file]);
  return file;
}

// PNG/JPG의 (x, y) 픽셀 RGB
export function pixel(file, x, y) {
  const out = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-']);
  return [...out.subarray(0, 3)];
}
