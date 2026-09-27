// 렌더 도구 환경: npm으로 설치한 ffmpeg/ffprobe를 PATH에 넣고,
// 시스템에 Chromium이 있으면 HyperFrames가 그것을 쓰게 한다(없으면 HyperFrames가 직접 받는다).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CHROMIUM_CANDIDATES = [
  process.env.HYPERFRAMES_BROWSER_PATH,
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
].filter(Boolean);

export function toolEnv() {
  const ffmpeg = require('ffmpeg-static');
  const ffprobe = require('ffprobe-static').path;
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1' };
  env.PATH = [path.dirname(ffmpeg), path.dirname(ffprobe), env.PATH].join(path.delimiter);
  const browser = CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p));
  if (browser) env.HYPERFRAMES_BROWSER_PATH = browser;
  return env;
}
