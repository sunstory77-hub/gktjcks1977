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
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source TEXT NOT NULL,    -- upload | ai
  ratio TEXT,              -- AI 생성 비율(9:16·4:5·1:1), 업로드는 NULL
  style TEXT,
  prompt TEXT,
  file TEXT NOT NULL,      -- 캠페인 폴더 기준 상대 경로
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS images_campaign ON images(campaign_id, created_at);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id),
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
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

// 기존 DB에 새 열을 더한다
const ADDED_COLUMNS = [
  ['campaigns', 'ad_copy', 'TEXT'], // 5~8주: 인스타 광고 문구
  ['campaigns', 'detail', 'TEXT'], // 5~8주: 상세페이지 문안
  ['campaigns', 'outputs', 'TEXT'], // 만든 결과물 목록(서버를 다시 켜도 유지)
  ['campaigns', 'vertical_image', 'TEXT'], // 세로(9:16) 자리: 릴스·스토리 광고
  ['campaigns', 'feed_image', 'TEXT'], // 피드 자리: 카드뉴스·피드 광고·상세페이지 표지
  ['companies', 'plan', "TEXT NOT NULL DEFAULT 'trial'"],
  ['companies', 'plan_until', 'TEXT'],
  ['users', 'agreed_at', 'TEXT'], // 이용약관·개인정보처리방침 동의 시각
  ['users', 'terms_version', 'TEXT'],
];

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  for (const [table, col, type] of ADDED_COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
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
