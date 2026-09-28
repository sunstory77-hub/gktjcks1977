// 데이터 저장소 (node:sqlite). 모든 회사 데이터 조회는 company_id로 범위를 좁힌다.
// 운영 배포(M3) 때 Postgres로 옮길 수 있도록 SQL은 표준 문법만 쓴다.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile TEXT NOT NULL,   -- JSON: 사업자번호·연락처·홈페이지·SNS·소개
  brand TEXT NOT NULL,     -- JSON: 색상·톤·금지 표현·기본 해시태그
  logo_file TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL,      -- owner | member
  PRIMARY KEY (user_id, company_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  company_id TEXT NOT NULL REFERENCES companies(id),
  provider TEXT NOT NULL,  -- anthropic | gemini
  ciphertext TEXT NOT NULL,
  last4 TEXT NOT NULL,
  meta TEXT NOT NULL,      -- JSON: 연결 테스트 결과(사용 가능 모델)
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, provider)
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  facts TEXT NOT NULL,     -- JSON 팩트 시트 (AI가 바꾸지 못하는 값)
  copy TEXT,               -- JSON 카피 3안
  cover_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS campaigns_company ON campaigns(company_id, updated_at);
CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,      -- copy | image | key_test
  ok INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export const now = () => new Date().toISOString();
export const json = (v) => JSON.stringify(v ?? {});
export const parse = (s, fallback = {}) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
