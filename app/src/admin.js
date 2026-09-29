// 운영자 도구 (결제·메일 연동 전 수동 운영용)
//   node src/admin.js list                         회사·요금제·이번 달 캠페인 수
//   node src/admin.js set-plan <이메일> <trial|basic|pro> [개월]   요금제 지정(개월 생략 시 기간 없음)
//   node src/admin.js reset-link <이메일>           1시간짜리 비밀번호 재설정 링크 출력
//   node src/admin.js backup <저장 폴더>            DB 온라인 백업 + 회사 파일 복사
// 데이터 폴더: DATA_DIR (기본 app/data), 링크 주소: APP_URL (기본 http://127.0.0.1:5180)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, now } from './db.js';
import { newToken, tokenHash } from './security.js';
import { PLANS, PLAN_NAMES, monthStart } from './plans.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runAdmin(args, { dataDir = process.env.DATA_DIR || path.join(APP_ROOT, 'data'), appUrl = process.env.APP_URL || 'http://127.0.0.1:5180', at = new Date() } = {}) {
  const [cmd, ...rest] = args;
  const dbFile = path.join(dataDir, 'app.db');
  if (!fs.existsSync(dbFile)) throw new Error(`DB가 없습니다: ${dbFile}`);
  const db = openDb(dbFile);
  const ownerCompany = (email) => {
    const row = db
      .prepare("SELECT c.id, c.name FROM users u JOIN memberships m ON m.user_id = u.id JOIN companies c ON c.id = m.company_id WHERE u.email = ? AND m.role = 'owner'")
      .get(String(email ?? '').trim().toLowerCase());
    if (!row) throw new Error(`회사 소유자 계정을 찾을 수 없습니다: ${email}`);
    return row;
  };
  try {
    switch (cmd) {
      case 'list': {
        const rows = db
          .prepare(
            `SELECT c.name, c.plan, c.plan_until, u.email,
               (SELECT COUNT(*) FROM usage_log l WHERE l.company_id = c.id AND l.provider = 'app' AND l.kind = 'campaign' AND l.created_at >= ?) AS used
             FROM companies c JOIN memberships m ON m.company_id = c.id AND m.role = 'owner' JOIN users u ON u.id = m.user_id ORDER BY c.created_at`,
          )
          .all(monthStart(at));
        return rows.map((r) => `${r.name}\t${r.email}\t${r.plan}\t${r.plan_until ? r.plan_until.slice(0, 10) : '기간 없음'}\t이번 달 캠페인 ${r.used}`).join('\n') || '(회사 없음)';
      }
      case 'set-plan': {
        const [email, plan, months] = rest;
        if (!PLAN_NAMES.includes(plan)) throw new Error(`요금제는 ${PLAN_NAMES.join(', ')} 중 하나입니다`);
        const c = ownerCompany(email);
        let until = null;
        if (months !== undefined) {
          const n = Number(months);
          if (!Number.isInteger(n) || n < 1 || n > 36) throw new Error('개월은 1~36 사이 정수입니다');
          const d = new Date(at);
          d.setMonth(d.getMonth() + n);
          until = d.toISOString();
        }
        db.prepare('UPDATE companies SET plan = ?, plan_until = ? WHERE id = ?').run(plan, until, c.id);
        return `${c.name}: ${PLANS[plan].label}${until ? ` (~${until.slice(0, 10)})` : ' (기간 없음)'}`;
      }
      case 'reset-link': {
        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(String(rest[0] ?? '').trim().toLowerCase());
        if (!user) throw new Error(`가입된 이메일이 아닙니다: ${rest[0]}`);
        const token = newToken();
        db.prepare('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), user.id, new Date(at.getTime() + 3600_000).toISOString());
        return `${appUrl.replace(/\/$/, '')}/#/reset/${token}  (1시간, 1회용)`;
      }
      case 'backup': {
        if (!rest[0]) throw new Error('저장 폴더를 지정하세요');
        const dest = path.resolve(rest[0], `backup_${now().replace(/[:.]/g, '-')}`);
        fs.mkdirSync(dest, { recursive: true });
        db.exec(`VACUUM INTO '${path.join(dest, 'app.db').replace(/'/g, "''")}'`); // 실행 중에도 일관된 사본
        const companies = path.join(dataDir, 'companies');
        if (fs.existsSync(companies)) fs.cpSync(companies, path.join(dest, 'companies'), { recursive: true });
        return `백업 완료: ${dest}\n※ 마스터 키(APP_MASTER_KEY 또는 data/.master_key)는 따로 보관하세요. 없으면 API 키를 복호화할 수 없습니다.`;
      }
      default:
        throw new Error('사용법: list | set-plan <이메일> <trial|basic|pro> [개월] | reset-link <이메일> | backup <폴더>');
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(runAdmin(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
