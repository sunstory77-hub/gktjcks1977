// 비밀번호 해시, 세션 토큰, API 키 암호화.
// API 키는 AES-256-GCM으로 암호화하고, 회사 ID·공급자를 AAD로 묶어 다른 회사 행에 복사해도 복호화되지 않게 한다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ── 비밀번호 (scrypt) ──
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(expected, actual);
}

// ── 세션 토큰: 쿠키에는 원문, DB에는 SHA-256만 저장 ──
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ── 마스터 키 ──
// 운영: APP_MASTER_KEY(32바이트 base64) 필수. 개발: 데이터 폴더에 자동 생성(권한 600).
export function loadMasterKey(dataDir, env = process.env) {
  if (env.APP_MASTER_KEY) {
    const key = Buffer.from(env.APP_MASTER_KEY, 'base64');
    if (key.length !== 32) throw new Error('APP_MASTER_KEY는 32바이트 base64여야 합니다');
    return key;
  }
  if (env.NODE_ENV === 'production') throw new Error('운영 환경에서는 APP_MASTER_KEY 환경변수가 필요합니다');
  const file = path.join(dataDir, '.master_key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
}

// ── API 키 암호화 ──
const aad = (companyId, provider) => Buffer.from(`${companyId}:${provider}`);

export function encryptSecret(masterKey, plaintext, companyId, provider) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(aad(companyId, provider));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(masterKey, blob, companyId, provider) {
  const [ver, ivB64, tagB64, ctB64] = String(blob).split('.');
  if (ver !== 'v1') throw new Error('지원하지 않는 암호문 형식');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivB64, 'base64'));
  decipher.setAAD(aad(companyId, provider));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// 화면에는 끝 4자리만
export const maskKey = (key) => `••••${String(key).slice(-4)}`;
