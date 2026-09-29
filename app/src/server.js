// 홍보공장 앱 서버
// 회원·회사·팀원·요금제 + 브랜드 킷·API 키(암호화) + 캠페인(업종별 팩트 시트 → 카피·카드뉴스·인스타 광고·상세페이지·릴스·이미지 보관함)
// 모든 회사 데이터는 세션의 회사 ID로만 조회한다. 다른 회사의 ID로 요청하면 404.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

import { buildSlides } from '../../poc/src/content.js';
import { renderCards } from '../../poc/src/cards.js';
import { renderReel } from '../../poc/src/reel.js';
import { TEMPLATE_NAMES, TEMPLATE_LABELS } from '../../poc/src/templates.js';
import { generateCopy, anthropicClient, offlineCopy, applyCopy, copyToMarkdown, DEFAULT_MODEL } from '../../poc/src/ai.js';
import { normalizeImage, normalizeLogo, IMAGE_EXTS, MAX_IMAGE_BYTES } from '../../poc/src/images.js';
import { generateCoverImage, IMAGE_STYLES, STYLE_BY_KIND, IMAGE_RATIOS, MAX_EXTRA, DEFAULT_IMAGE_STYLE, DEFAULT_IMAGE_MODEL } from '../../poc/src/imagegen.js';
import { sanitizeBrief } from '../../poc/src/server.js';
import { generateAdCopy, offlineAdCopy, generateDetail, offlineDetail } from '../../poc/src/formats.js';
import { renderAdImages } from '../../poc/src/adimage.js';
import { renderDetailPage } from '../../poc/src/detailpage.js';
import { importFacts, IMPORT_TYPES, MAX_IMPORT_BYTES } from '../../poc/src/importer.js';
import { reviewTexts, formatHit } from '../../poc/src/review.js';
import { labelPng, labelMp4 } from '../../poc/src/ailabel.js';
import { KINDS, KIND_NAMES, DEFAULT_KIND } from '../../poc/src/kinds.js';

import { openDb, now, json, parse } from './db.js';
import { hashPassword, verifyPassword, newToken, tokenHash, loadMasterKey, encryptSecret, decryptSecret } from './security.js';
import { PROVIDERS, testKey } from './providers.js';
import { DEFAULT_BRAND, sanitizeProfile, sanitizeBrand, copyEntries, adEntries, detailEntries } from './brand.js';
import { editCopy, editAds, editDetail } from './edits.js';
import { PLANS, planStatus, monthStart } from './plans.js';
import { HttpError, readBody, readJson, sendJson, parseCookies, cookie, sendFile, router } from './http.js';

const require = createRequire(import.meta.url);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const FONT_DIR = path.join(path.dirname(require.resolve('../../poc/node_modules/pretendard/package.json')), 'dist/public/static');
const SAMPLE_FACTS = JSON.parse(fs.readFileSync(path.join(APP_ROOT, '..', 'poc', 'brief.sample.json'), 'utf8'));

export const TERMS_VERSION = '2026-09-29';
const SESSION_DAYS = 14;
const INVITE_DAYS = 7;
const MAX_IMAGES = 12; // 캠페인당 이미지 보관 수
const ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^(card_\d{2}_[a-z]+\.png|reel\.mp4|ad_(square|portrait|story)\.png|detail_\d{2}_[a-z]+\.png)$/;
const GROUPS = new Set(['ads', 'detail']); // 템플릿 폴더 외 결과물 폴더
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 보안 헤더: 앱은 같은 출처의 스크립트·스타일·이미지만 쓴다
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// 기본 생성기: 회사 키로 호출. 테스트에서는 가짜 생성기를 주입한다.
const defaultCopyGenerator = (facts, { apiKey, model, voice }) => generateCopy(facts, { client: anthropicClient(apiKey), model, voice });
const defaultImageGenerator = (facts, dest, { apiKey, model, style, extra, aspectRatio, reference }) => generateCoverImage(facts, dest, { apiKey, model, style, extra, aspectRatio, reference });
const defaultAdGenerator = (facts, { apiKey, model, voice }) => generateAdCopy(facts, { client: anthropicClient(apiKey), model, voice });
const defaultDetailGenerator = (facts, { apiKey, model, voice }) => generateDetail(facts, { client: anthropicClient(apiKey), model, voice });
const defaultImporter = (buf, type, { apiKey, model, kind }) => importFacts(buf, type, { client: anthropicClient(apiKey), model, kind });

function adCopyMarkdown(adCopy, chosen) {
  const out = ['# 인스타그램 광고 문구', '', { offline: '작성: 입력 문구 기반', edited: '작성: 직접 수정' }[adCopy.source] ?? '작성: 생성형 AI 활용', ''];
  adCopy.ads.forEach((a, i) => {
    out.push(`## ${i + 1}안 · ${a.angle}${i === chosen ? ' (이미지에 사용)' : ''}`, '', '**본문**', '', a.primaryText, '', `**제목** ${a.headline}`, '', `**설명** ${a.description}`, '', `**이미지 문구** ${a.overlay} / ${a.overlaySub}`, '');
  });
  return out.join('\n');
}

export function createApp({
  dataDir = path.join(APP_ROOT, 'data'),
  env = process.env,
  copyGenerator = defaultCopyGenerator,
  imageGenerator = defaultImageGenerator,
  reelRenderer = renderReel,
  keyTester = testKey,
  adGenerator = defaultAdGenerator,
  detailGenerator = defaultDetailGenerator,
  importer = defaultImporter,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'app.db'));
  const masterKey = loadMasterKey(dataDir, env);
  const secureCookie = env.COOKIE_SECURE === '1';
  const trustProxy = env.TRUST_PROXY === '1';
  const localMode = env.PROMO_LOCAL === '1';
  const reels = new Map(); // campaignId → { status, error } (진행 중 상태만 메모리에, 완료는 DB outputs)
  let reelQueue = Promise.resolve();
  const loginAttempts = new Map();

  // ── 조회 헬퍼 ──
  const q = (sql) => db.prepare(sql);
  const companyDir = (cid) => path.join(dataDir, 'companies', cid);
  const campaignDir = (cid, id) => path.join(companyDir(cid), 'campaigns', id);
  const clientIp = (req) => (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress;

  function loadCompany(cid) {
    const row = q('SELECT * FROM companies WHERE id = ?').get(cid);
    return { id: row.id, name: row.name, profile: parse(row.profile), brand: { ...DEFAULT_BRAND, ...parse(row.brand) }, logoFile: row.logo_file, plan: row.plan, planUntil: row.plan_until };
  }

  function sessionFrom(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const row = q(
      `SELECT s.user_id, s.expires_at, u.email, u.name, m.company_id, m.role
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN memberships m ON m.user_id = u.id
       WHERE s.token_hash = ?`,
    ).get(tokenHash(token));
    if (!row || row.expires_at < now()) return null;
    return { userId: row.user_id, email: row.email, name: row.name, companyId: row.company_id, role: row.role, token };
  }

  function startSession(userId) {
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires);
    return cookie('sid', token, { maxAge: SESSION_DAYS * 86400, secure: secureCookie });
  }

  const ownerOnly = (s) => {
    if (s.role !== 'owner') throw new HttpError(403, '회사 소유자만 할 수 있습니다');
  };

  // ── 요금제 ──
  function planOf(cid) {
    const company = loadCompany(cid);
    const used = q("SELECT COUNT(*) AS n FROM usage_log WHERE company_id = ? AND provider = 'app' AND kind = 'campaign' AND created_at >= ?").get(cid, monthStart()).n;
    const members = q('SELECT COUNT(*) AS n FROM memberships WHERE company_id = ?').get(cid).n;
    return planStatus(company, used, members);
  }
  // 이용 기간이 끝나면 새로 만들기·생성은 막고, 이미 만든 결과물 보기·내려받기는 허용한다
  function requireActive(cid) {
    const p = planOf(cid);
    if (p.expired) throw new HttpError(402, `${p.label} 이용 기간이 끝났습니다. 요금제를 연장하면 다시 만들 수 있습니다 (만든 결과물은 계속 내려받을 수 있습니다)`);
    return p;
  }

  // 키 확인 때 저장한 모델보다 엔진의 현재 기본 모델을 우선한다(그 키로 쓸 수 있을 때). 화면 표시와 실제 호출이 같은 값을 쓴다.
  function effectiveMeta(provider, meta) {
    const m = { ...meta };
    if (provider === 'anthropic' && m.models?.includes(DEFAULT_MODEL)) m.textModel = DEFAULT_MODEL;
    if (provider === 'gemini' && m.models?.includes(DEFAULT_IMAGE_MODEL)) m.imageModel = DEFAULT_IMAGE_MODEL;
    return m;
  }

  function getKey(cid, provider) {
    const row = q('SELECT ciphertext, meta FROM api_keys WHERE company_id = ? AND provider = ?').get(cid, provider);
    if (!row) return null;
    return { apiKey: decryptSecret(masterKey, row.ciphertext, cid, provider), meta: effectiveMeta(provider, parse(row.meta)) };
  }

  function logUsage(cid, provider, kind, ok, ms) {
    q('INSERT INTO usage_log (company_id, provider, kind, ok, ms, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, provider, kind, ok ? 1 : 0, Math.round(ms), now());
  }

  // ── 캠페인 ──
  function getCampaign(cid, id) {
    const row = ID_RE.test(id) && q('SELECT * FROM campaigns WHERE id = ? AND company_id = ?').get(id, cid);
    if (!row) throw new HttpError(404, '캠페인을 찾을 수 없습니다');
    // 이전 버전의 표지 사진(cover.jpg)은 이미지 보관함으로 옮긴다
    if (row.cover_file && !row.vertical_image && !row.feed_image) {
      const imgId = crypto.randomUUID();
      q('INSERT INTO images (id, company_id, campaign_id, source, file, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(imgId, cid, id, 'upload', row.cover_file, now());
      q('UPDATE campaigns SET cover_file = NULL, vertical_image = ?, feed_image = ? WHERE id = ?').run(imgId, imgId, id);
      return getCampaign(cid, id);
    }
    return {
      id: row.id,
      title: row.title,
      facts: parse(row.facts),
      copy: parse(row.copy, null),
      adCopy: parse(row.ad_copy, null),
      detail: parse(row.detail, null),
      outputs: parse(row.outputs, {}),
      verticalImage: row.vertical_image,
      feedImage: row.feed_image,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const listImages = (cid, id) => q('SELECT * FROM images WHERE campaign_id = ? AND company_id = ? ORDER BY created_at').all(id, cid);
  const imageFile = (cid, id, imgId) => {
    const row = imgId && q('SELECT file FROM images WHERE id = ? AND campaign_id = ? AND company_id = ?').get(imgId, id, cid);
    return row ? path.join(campaignDir(cid, id), row.file) : undefined;
  };
  // 자리별 사진: 피드(카드뉴스 4:5·피드 광고·상세 표지)와 세로(릴스·스토리). 한쪽만 있으면 그 사진을 같이 쓴다.
  function photosFor(cid, c) {
    const feed = imageFile(cid, c.id, c.feedImage);
    const vertical = imageFile(cid, c.id, c.verticalImage);
    return { feed: feed ?? vertical, vertical: vertical ?? feed };
  }

  function saveOutputs(id, patch) {
    const row = q('SELECT outputs FROM campaigns WHERE id = ?').get(id);
    const out = { ...parse(row?.outputs, {}), ...patch };
    for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
    q('UPDATE campaigns SET outputs = ? WHERE id = ?').run(json(out), id);
  }
  // 이미지·문안이 바뀌면 그것을 쓰는 결과물은 다시 만들어야 한다
  const clearOutputs = (id, ...keys) => saveOutputs(id, Object.fromEntries(keys.map((k) => [k, null])));

  const fileUrl = (id, group, f) => `/files/campaigns/${id}/${group}/${f}`;
  const exists = (cid, id, group, f) => fs.existsSync(path.join(campaignDir(cid, id), group, f));

  function campaignView(cid, c) {
    const o = c.outputs;
    const cards = o.cards?.files.every((f) => exists(cid, c.id, o.cards.template, f)) && o.cards;
    const reel = reels.get(c.id) ?? (cards && o.reel && exists(cid, c.id, cards.template, 'reel.mp4') ? { status: 'done' } : { status: 'idle' });
    const ads = o.ads && Object.values(o.ads.files).every((f) => exists(cid, c.id, 'ads', f)) && o.ads;
    const detail = o.detail?.files.every((f) => exists(cid, c.id, 'detail', f)) && o.detail;
    return {
      id: c.id,
      title: c.title,
      facts: c.facts,
      copy: c.copy,
      adCopy: c.adCopy,
      detail: c.detail,
      images: listImages(cid, c.id).map((im) => ({ id: im.id, source: im.source, ratio: im.ratio, style: im.style, url: `/files/campaigns/${c.id}/images/${im.id}`, createdAt: im.created_at })),
      slots: { vertical: c.verticalImage ?? null, feed: c.feedImage ?? null },
      updatedAt: c.updatedAt,
      render: cards
        ? {
            template: cards.template,
            variant: cards.variant,
            cards: cards.files.map((f) => fileUrl(c.id, cards.template, f)),
            reel: { status: reel.status, error: reel.error, url: reel.status === 'done' ? fileUrl(c.id, cards.template, 'reel.mp4') : null },
          }
        : undefined,
      ads: ads ? { variant: ads.variant, images: Object.fromEntries(Object.entries(ads.files).map(([k, f]) => [k, fileUrl(c.id, 'ads', f)])) } : undefined,
      detailImages: detail ? detail.files.map((f) => fileUrl(c.id, 'detail', f)) : undefined,
    };
  }
  const view = (cid, id) => campaignView(cid, getCampaign(cid, id));

  // 팩트 시트: PoC 브리프 검증 + 회사 기본값(SNS 계정·해시태그)
  function factsFor(company, raw) {
    const merged = { ...raw, handle: raw?.handle || company.profile.handle, hashtags: raw?.hashtags?.length ? raw.hashtags : company.brand.hashtags };
    return sanitizeBrief(merged);
  }

  const brandForEngine = (company) => ({ colors: company.brand.colors });

  // 회사 Claude 키로 생성 → 실패·키 없음이면 입력 문구로 대체. 광고 표현 검수 경고를 함께 돌려준다.
  async function generateWithKey(cid, { ai, kind, label, generate, offline, entries }) {
    const company = loadCompany(cid);
    const warnings = [];
    let out;
    const key = ai ? getKey(cid, 'anthropic') : null;
    if (ai && !key) warnings.push(`Claude API 키가 등록되지 않아 입력 문구로 ${label}을 만들었습니다 (설정 → API 키)`);
    if (key) {
      const t = Date.now();
      try {
        out = await generate({ apiKey: key.apiKey, model: key.meta.textModel, voice: { brandName: company.name, tone: company.brand.tone } });
        logUsage(cid, 'anthropic', kind, true, Date.now() - t);
        warnings.push(...(out.warnings ?? []));
      } catch (err) {
        logUsage(cid, 'anthropic', kind, false, Date.now() - t);
        warnings.push(`AI ${label} 생성 실패 → 입력 문구로 대체: ${err.message}`);
      }
    }
    out ??= offline();
    return withReview(cid, { ...out, warnings }, entries);
  }
  // 광고 표현 검수(생성·직접 수정 공통)
  function withReview(cid, out, entries) {
    const review = reviewTexts(entries(out), { forbidden: loadCompany(cid).brand.forbidden });
    const base = (out.warnings ?? []).filter((w) => !/^광고 표현|^회사 금지/.test(w));
    return { ...out, warnings: [...base, ...review.map(formatHit)], review };
  }

  // 결과물에 AI 생성 표시(메타데이터)를 넣는다
  const labelAll = (files) => files.forEach((f) => labelPng(f));
  const logoPath = (company) => (company.logoFile ? path.join(companyDir(company.id), company.logoFile) : undefined);

  // 회사와 그 데이터 전체 삭제(소유자 탈퇴). 팀원 계정도 함께 지운다.
  function deleteCompany(cid) {
    const users = q('SELECT user_id FROM memberships WHERE company_id = ?').all(cid).map((r) => r.user_id);
    const campaigns = q('SELECT id FROM campaigns WHERE company_id = ?').all(cid).map((r) => r.id);
    db.exec('BEGIN');
    try {
      for (const t of ['images', 'campaigns', 'api_keys', 'usage_log', 'invites']) q(`DELETE FROM ${t} WHERE company_id = ?`).run(cid);
      q('DELETE FROM memberships WHERE company_id = ?').run(cid);
      for (const u of users) deleteUserRows(u);
      q('DELETE FROM companies WHERE id = ?').run(cid);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    fs.rmSync(companyDir(cid), { recursive: true, force: true });
    for (const id of campaigns) reels.delete(id);
  }
  function deleteUserRows(userId) {
    q('DELETE FROM sessions WHERE user_id = ?').run(userId);
    q('DELETE FROM reset_tokens WHERE user_id = ?').run(userId);
    q('DELETE FROM memberships WHERE user_id = ?').run(userId);
    q('DELETE FROM users WHERE id = ?').run(userId);
  }

  function findInvite(token) {
    const row = token && q('SELECT * FROM invites WHERE token_hash = ?').get(tokenHash(String(token)));
    if (!row || row.accepted_at || row.expires_at < now()) throw new HttpError(400, '초대 링크가 만료됐거나 이미 사용됐습니다');
    return row;
  }

  function checkPassword(pw) {
    if (String(pw ?? '').length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다');
    return String(pw);
  }

  // ── 공개 라우트 ──
  const pub = router({
    'POST /api/auth/signup': async (req) => {
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const name = String(b.name ?? '').trim().slice(0, 40);
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '이메일 형식이 아닙니다');
      const password = checkPassword(b.password);
      if (b.agree !== true) throw new HttpError(400, '이용약관과 개인정보처리방침에 동의해야 가입할 수 있습니다');
      const invite = b.invite ? findInvite(b.invite) : null;
      if (invite && invite.email !== email) throw new HttpError(400, '초대받은 이메일로 가입해 주세요');
      const companyName = String(b.companyName ?? '').trim().slice(0, 60);
      if (!name || (!invite && !companyName)) throw new HttpError(400, '이름과 회사명을 입력하세요');
      if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, '이미 가입된 이메일입니다');
      if (invite) {
        const p = planOf(invite.company_id);
        if (p.members.used >= p.members.limit) throw new HttpError(402, `${p.label} 요금제의 팀원 수(${p.members.limit}명)를 넘었습니다. 회사 소유자에게 문의하세요`);
      }
      const userId = crypto.randomUUID();
      const t = now();
      q('INSERT INTO users (id, email, name, password_hash, created_at, agreed_at, terms_version) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, email, name, hashPassword(password), t, t, TERMS_VERSION);
      if (invite) {
        q("INSERT INTO memberships (user_id, company_id, role) VALUES (?, ?, 'member')").run(userId, invite.company_id);
        q('UPDATE invites SET accepted_at = ? WHERE id = ?').run(t, invite.id);
      } else {
        const companyId = crypto.randomUUID();
        // 내 PC 설치형(PROMO_LOCAL=1)은 요금제 한도 없이 쓴다
        const [plan, until] = localMode ? ['pro', null] : ['trial', new Date(Date.now() + PLANS.trial.days * 864e5).toISOString()];
        q('INSERT INTO companies (id, name, profile, brand, created_at, plan, plan_until) VALUES (?, ?, ?, ?, ?, ?, ?)').run(companyId, companyName, json({}), json(DEFAULT_BRAND), t, plan, until);
        q("INSERT INTO memberships (user_id, company_id, role) VALUES (?, ?, 'owner')").run(userId, companyId);
      }
      return { status: 201, body: { ok: true }, headers: { 'set-cookie': startSession(userId) } };
    },

    'POST /api/auth/login': async (req) => {
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const k = `${clientIp(req)}|${email}`;
      const recent = (loginAttempts.get(k) ?? []).filter((t) => Date.now() - t < 15 * 60_000);
      if (recent.length >= 10) throw new HttpError(429, '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요');
      const user = q('SELECT id, password_hash FROM users WHERE email = ?').get(email);
      if (!user || !verifyPassword(String(b.password ?? ''), user.password_hash)) {
        loginAttempts.set(k, [...recent, Date.now()]);
        throw new HttpError(401, '이메일 또는 비밀번호가 맞지 않습니다');
      }
      loginAttempts.delete(k);
      return { body: { ok: true }, headers: { 'set-cookie': startSession(user.id) } };
    },

    'POST /api/auth/logout': async (req) => {
      const token = parseCookies(req.headers.cookie).sid;
      if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      return { body: { ok: true }, headers: { 'set-cookie': cookie('sid', '', { maxAge: 0, secure: secureCookie }) } };
    },

    // 비밀번호 재설정: 관리자 도구(admin.js reset-link)가 만든 1회용 링크로
    'POST /api/auth/reset': async (req) => {
      const b = await readJson(req);
      const row = b.token && q('SELECT * FROM reset_tokens WHERE token_hash = ?').get(tokenHash(String(b.token)));
      if (!row || row.used_at || row.expires_at < now()) throw new HttpError(400, '재설정 링크가 만료됐거나 이미 사용됐습니다');
      const password = checkPassword(b.password);
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
      q('UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?').run(now(), row.token_hash);
      q('DELETE FROM sessions WHERE user_id = ?').run(row.user_id); // 다른 기기 로그인 모두 끊기
      return { body: { ok: true } };
    },

    'GET /api/invites/:token': async (req, s, res, { token }) => {
      const inv = findInvite(token);
      return { body: { email: inv.email, companyName: loadCompany(inv.company_id).name } };
    },

    // 로그인 여부만 알려 준다(첫 화면에서 401 오류 없이 분기하기 위해)
    'GET /api/session': async (req) => ({ body: { loggedIn: Boolean(sessionFrom(req)) } }),

    'GET /api/meta': async () => ({
      body: {
        templates: TEMPLATE_NAMES.map((name) => ({ name, label: TEMPLATE_LABELS[name] })),
        imageStyles: Object.entries(IMAGE_STYLES).map(([name, s]) => ({ name, label: s.label })),
        stylesByKind: STYLE_BY_KIND,
        imageRatios: Object.entries(IMAGE_RATIOS).map(([name, label]) => ({ name, label })),
        maxImageExtra: MAX_EXTRA,
        maxImages: MAX_IMAGES,
        kinds: Object.entries(KINDS).map(([name, k]) => ({ name, label: k.label, labels: k.labels, required: k.required })),
        providers: Object.entries(PROVIDERS).map(([name, p]) => ({ name, label: p.label, use: p.use })),
        plans: Object.entries(PLANS).map(([name, p]) => ({ name, ...p })),
        termsVersion: TERMS_VERSION,
        sampleFacts: SAMPLE_FACTS,
      },
    }),

    'GET /healthz': async () => {
      q('SELECT 1').get();
      return { body: { ok: true } };
    },
  });

  // ── 로그인 필요 라우트 (s = 세션) ──
  const priv = router({
    'GET /api/me': async (req, s) => {
      const company = loadCompany(s.companyId);
      const keys = Object.fromEntries(
        Object.keys(PROVIDERS).map((p) => {
          const row = q('SELECT last4, meta, updated_at FROM api_keys WHERE company_id = ? AND provider = ?').get(s.companyId, p);
          return [p, row ? { last4: row.last4, ...effectiveMeta(p, parse(row.meta)), updatedAt: row.updated_at } : null];
        }),
      );
      return {
        body: {
          user: { email: s.email, name: s.name, role: s.role },
          company: { id: company.id, name: company.name, profile: company.profile, brand: company.brand, hasLogo: Boolean(company.logoFile) },
          plan: planOf(s.companyId),
          keys,
        },
      };
    },

    'PUT /api/me/password': async (req, s) => {
      const b = await readJson(req);
      const user = q('SELECT password_hash FROM users WHERE id = ?').get(s.userId);
      if (!verifyPassword(String(b.current ?? ''), user.password_hash)) throw new HttpError(400, '현재 비밀번호가 맞지 않습니다');
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(checkPassword(b.next)), s.userId);
      q('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(s.userId, tokenHash(s.token)); // 다른 기기 로그아웃
      return { body: { ok: true } };
    },

    // 탈퇴: 소유자는 회사 전체(캠페인·파일·키·팀원) 삭제, 팀원은 본인 계정만 삭제
    'DELETE /api/me': async (req, s) => {
      const b = await readJson(req);
      const user = q('SELECT password_hash FROM users WHERE id = ?').get(s.userId);
      if (!verifyPassword(String(b.password ?? ''), user.password_hash)) throw new HttpError(400, '비밀번호가 맞지 않습니다');
      if (s.role === 'owner') deleteCompany(s.companyId);
      else deleteUserRows(s.userId);
      return { body: { ok: true }, headers: { 'set-cookie': cookie('sid', '', { maxAge: 0, secure: secureCookie }) } };
    },

    'PUT /api/company': async (req, s) => {
      ownerOnly(s);
      const b = await readJson(req);
      const name = String(b.name ?? '').trim().slice(0, 60);
      if (!name) throw new HttpError(400, '회사명을 입력하세요');
      q('UPDATE companies SET name = ?, profile = ? WHERE id = ?').run(name, json(sanitizeProfile(b.profile)), s.companyId);
      return { body: { ok: true } };
    },

    'PUT /api/company/brand': async (req, s) => {
      ownerOnly(s);
      const { brand, adjusted } = sanitizeBrand(await readJson(req));
      q('UPDATE companies SET brand = ? WHERE id = ?').run(json(brand), s.companyId);
      return { body: { brand, adjusted } };
    },

    'POST /api/company/logo': async (req, s) => {
      ownerOnly(s);
      const buf = await readBody(req, MAX_IMAGE_BYTES);
      if (!buf.length) throw new HttpError(400, '빈 파일입니다');
      const dir = companyDir(s.companyId);
      fs.mkdirSync(dir, { recursive: true });
      const raw = path.join(dir, `logo.upload.${crypto.randomUUID()}`);
      fs.writeFileSync(raw, buf);
      try {
        await normalizeLogo(raw, path.join(dir, 'logo.png'));
      } catch (err) {
        throw new HttpError(400, err.message);
      } finally {
        fs.rmSync(raw, { force: true });
      }
      q("UPDATE companies SET logo_file = 'logo.png' WHERE id = ?").run(s.companyId);
      return { body: { ok: true } };
    },

    'GET /api/company/logo': async (req, s, res) => {
      const company = loadCompany(s.companyId);
      if (!company.logoFile) throw new HttpError(404, '로고가 없습니다');
      sendFile(req, res, logoPath(company));
    },

    'DELETE /api/company/logo': async (req, s) => {
      ownerOnly(s);
      fs.rmSync(path.join(companyDir(s.companyId), 'logo.png'), { force: true });
      q('UPDATE companies SET logo_file = NULL WHERE id = ?').run(s.companyId);
      return { body: { ok: true } };
    },

    // API 키: 연결 테스트를 통과해야 저장. 저장 후에는 끝 4자리만 보여 준다.
    'PUT /api/keys/:provider': async (req, s, res, { provider }) => {
      ownerOnly(s);
      if (!PROVIDERS[provider]) throw new HttpError(404, '알 수 없는 공급자');
      const apiKey = String((await readJson(req)).apiKey ?? '').trim();
      const t = Date.now();
      let meta;
      try {
        meta = await keyTester(provider, apiKey);
      } catch (err) {
        logUsage(s.companyId, provider, 'key_test', false, Date.now() - t);
        throw new HttpError(400, err.message);
      }
      logUsage(s.companyId, provider, 'key_test', true, Date.now() - t);
      q(
        `INSERT INTO api_keys (company_id, provider, ciphertext, last4, meta, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (company_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext, last4 = excluded.last4, meta = excluded.meta, updated_at = excluded.updated_at`,
      ).run(s.companyId, provider, encryptSecret(masterKey, apiKey, s.companyId, provider), apiKey.slice(-4), json(meta), now());
      return { body: { last4: apiKey.slice(-4), ...meta } };
    },

    'DELETE /api/keys/:provider': async (req, s, res, { provider }) => {
      ownerOnly(s);
      q('DELETE FROM api_keys WHERE company_id = ? AND provider = ?').run(s.companyId, provider);
      return { body: { ok: true } };
    },

    'GET /api/usage': async (req, s) => {
      const since = monthStart();
      const rows = q(
        "SELECT provider, kind, SUM(ok) AS ok, COUNT(*) AS total FROM usage_log WHERE company_id = ? AND created_at >= ? AND provider != 'app' GROUP BY provider, kind",
      ).all(s.companyId, since);
      return { body: { since, rows } };
    },

    // ── 팀원 ──
    'GET /api/members': async (req, s) => ({
      body: {
        members: q('SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY m.role DESC, u.created_at').all(s.companyId),
        invites:
          s.role === 'owner'
            ? q('SELECT id, email, expires_at FROM invites WHERE company_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(s.companyId, now()).map((r) => ({ id: r.id, email: r.email, expiresAt: r.expires_at }))
            : [],
      },
    }),

    // 초대 링크 만들기(메일 발송 대신 링크를 복사해 전달). 링크는 7일, 1회용.
    'POST /api/invites': async (req, s) => {
      ownerOnly(s);
      const email = String((await readJson(req)).email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '이메일 형식이 아닙니다');
      if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, '이미 가입된 이메일입니다');
      const p = planOf(s.companyId);
      const pending = q('SELECT COUNT(*) AS n FROM invites WHERE company_id = ? AND accepted_at IS NULL AND expires_at > ?').get(s.companyId, now()).n;
      if (p.members.used + pending >= p.members.limit) throw new HttpError(402, `${p.label} 요금제는 팀원 ${p.members.limit}명까지입니다`);
      const token = newToken();
      q('DELETE FROM invites WHERE company_id = ? AND email = ? AND accepted_at IS NULL').run(s.companyId, email);
      q('INSERT INTO invites (id, token_hash, company_id, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), tokenHash(token), s.companyId, email, new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(), now());
      return { status: 201, body: { email, path: `/#/invite/${token}` } };
    },

    'DELETE /api/invites/:id': async (req, s, res, { id }) => {
      ownerOnly(s);
      q('DELETE FROM invites WHERE id = ? AND company_id = ?').run(id, s.companyId);
      return { body: { ok: true } };
    },

    'DELETE /api/members/:id': async (req, s, res, { id }) => {
      ownerOnly(s);
      const m = q("SELECT role FROM memberships WHERE user_id = ? AND company_id = ?").get(id, s.companyId);
      if (!m) throw new HttpError(404, '팀원을 찾을 수 없습니다');
      if (m.role === 'owner') throw new HttpError(400, '소유자는 내보낼 수 없습니다');
      deleteUserRows(id);
      return { body: { ok: true } };
    },

    // ── 캠페인 ──
    'GET /api/campaigns': async (req, s) => ({
      body: q('SELECT id, title, facts, updated_at FROM campaigns WHERE company_id = ? ORDER BY updated_at DESC LIMIT 200')
        .all(s.companyId)
        .map((r) => ({ id: r.id, title: r.title, kind: parse(r.facts).kind ?? DEFAULT_KIND, updatedAt: r.updated_at })),
    }),

    'POST /api/campaigns': async (req, s) => {
      const p = requireActive(s.companyId);
      if (p.campaigns.used >= p.campaigns.limit) throw new HttpError(402, `${p.label} 요금제는 한 달에 캠페인 ${p.campaigns.limit}개까지입니다. 다음 달 1일에 다시 만들 수 있습니다`);
      const facts = factsFor(loadCompany(s.companyId), (await readJson(req)).facts);
      const id = crypto.randomUUID();
      const t = now();
      q('INSERT INTO campaigns (id, company_id, title, facts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, s.companyId, facts.title.replace(/\n/g, ' '), json(facts), t, t);
      logUsage(s.companyId, 'app', 'campaign', true, 0);
      return { status: 201, body: view(s.companyId, id) };
    },

    'GET /api/campaigns/:id': async (req, s, res, { id }) => ({ body: view(s.companyId, id) }),

    'PUT /api/campaigns/:id': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const facts = factsFor(loadCompany(s.companyId), (await readJson(req)).facts);
      // 팩트가 바뀌면 이전 문안·결과물은 무효(이미지는 유지)
      q("UPDATE campaigns SET title = ?, facts = ?, copy = NULL, ad_copy = NULL, detail = NULL, outputs = '{}', updated_at = ? WHERE id = ? AND company_id = ?").run(facts.title.replace(/\n/g, ' '), json(facts), now(), id, s.companyId);
      reels.delete(id);
      return { body: view(s.companyId, id) };
    },

    'DELETE /api/campaigns/:id': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      q('DELETE FROM images WHERE campaign_id = ? AND company_id = ?').run(id, s.companyId);
      q('DELETE FROM campaigns WHERE id = ? AND company_id = ?').run(id, s.companyId);
      fs.rmSync(campaignDir(s.companyId, id), { recursive: true, force: true });
      reels.delete(id);
      return { body: { ok: true } };
    },

    // 카피: 회사 Claude 키로 3안. 키가 없거나 실패하면 입력 문구로 대체하고 이유를 알린다.
    'POST /api/campaigns/:id/copy': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const { ai = true } = await readJson(req);
      const copy = await generateWithKey(s.companyId, { ai, kind: 'copy', label: '카피', generate: (opts) => copyGenerator(c.facts, opts), offline: () => offlineCopy(c.facts), entries: copyEntries });
      q('UPDATE campaigns SET copy = ?, updated_at = ? WHERE id = ?').run(json(copy), now(), id);
      clearOutputs(id, 'cards', 'reel');
      return { body: { ...view(s.companyId, id), warnings: copy.warnings } };
    },

    // 직접 수정: 글자 수만 검사하고 광고 표현 검수는 다시 한다
    'PUT /api/campaigns/:id/copy': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const copy = withReview(s.companyId, editCopy((await readJson(req)).copy, c.copy), copyEntries);
      q('UPDATE campaigns SET copy = ?, updated_at = ? WHERE id = ?').run(json(copy), now(), id);
      clearOutputs(id, 'cards', 'reel');
      return { body: { ...view(s.companyId, id), warnings: copy.warnings } };
    },

    // 인스타 광고 문구 3안
    'POST /api/campaigns/:id/ads/copy': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const { ai = true } = await readJson(req);
      const adCopy = await generateWithKey(s.companyId, { ai, kind: 'ads', label: '광고 문구', generate: (opts) => adGenerator(c.facts, opts), offline: () => offlineAdCopy(c.facts), entries: adEntries });
      q('UPDATE campaigns SET ad_copy = ?, updated_at = ? WHERE id = ?').run(json(adCopy), now(), id);
      clearOutputs(id, 'ads');
      return { body: { ...view(s.companyId, id), warnings: adCopy.warnings } };
    },

    'PUT /api/campaigns/:id/ads/copy': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      const adCopy = withReview(s.companyId, editAds((await readJson(req)).adCopy), adEntries);
      q('UPDATE campaigns SET ad_copy = ?, updated_at = ? WHERE id = ?').run(json(adCopy), now(), id);
      clearOutputs(id, 'ads');
      return { body: { ...view(s.companyId, id), warnings: adCopy.warnings } };
    },

    // 인스타 광고 이미지 1:1 · 4:5 · 9:16
    'POST /api/campaigns/:id/ads/render': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const company = loadCompany(s.companyId);
      const b = await readJson(req);
      const adCopy = c.adCopy ?? offlineAdCopy(c.facts);
      const variant = Math.min(Math.max(Number(b.variant) || 0, 0), adCopy.ads.length - 1);
      const template = TEMPLATE_NAMES.includes(b.template) ? b.template : 'bold';
      const dir = path.join(campaignDir(s.companyId, id), 'ads');
      fs.rmSync(dir, { recursive: true, force: true });
      const photos = photosFor(s.companyId, c);
      const files = await renderAdImages(adCopy.ads[variant], c.facts, brandForEngine(company), dir, template, { coverImage: photos.feed, storyImage: photos.vertical, logo: logoPath(company), aiBadge: company.brand.aiBadge });
      labelAll(Object.values(files));
      saveOutputs(id, { ads: { variant, template, files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, path.basename(f)])) } });
      return { body: view(s.companyId, id) };
    },

    // 상세페이지 6블록 문안
    'POST /api/campaigns/:id/detail/copy': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const { ai = true } = await readJson(req);
      const detail = await generateWithKey(s.companyId, { ai, kind: 'detail', label: '상세페이지', generate: (opts) => detailGenerator(c.facts, opts), offline: () => offlineDetail(c.facts), entries: detailEntries });
      q('UPDATE campaigns SET detail = ?, updated_at = ? WHERE id = ?').run(json(detail), now(), id);
      clearOutputs(id, 'detail');
      return { body: { ...view(s.companyId, id), warnings: detail.warnings } };
    },

    'PUT /api/campaigns/:id/detail/copy': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      const detail = withReview(s.companyId, editDetail((await readJson(req)).detail), detailEntries);
      q('UPDATE campaigns SET detail = ?, updated_at = ? WHERE id = ?').run(json(detail), now(), id);
      clearOutputs(id, 'detail');
      return { body: { ...view(s.companyId, id), warnings: detail.warnings } };
    },

    'POST /api/campaigns/:id/detail/render': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const company = loadCompany(s.companyId);
      const detail = c.detail ?? offlineDetail(c.facts);
      const dir = path.join(campaignDir(s.companyId, id), 'detail');
      fs.rmSync(dir, { recursive: true, force: true });
      let files;
      try {
        files = await renderDetailPage(detail, c.facts, brandForEngine(company), dir, { coverImage: photosFor(s.companyId, c).feed, logo: logoPath(company), aiBadge: company.brand.aiBadge });
      } catch (err) {
        throw new HttpError(422, err.message);
      }
      labelAll(files);
      saveOutputs(id, { detail: { files: files.map((f) => path.basename(f)) } });
      return { body: view(s.companyId, id) };
    },

    // ── 이미지 보관함: 사진 올리기·AI 생성(여러 장) → 자리(세로·피드)에 배정 ──
    'POST /api/campaigns/:id/images': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      if (listImages(s.companyId, id).length >= MAX_IMAGES) throw new HttpError(400, `이미지는 캠페인당 ${MAX_IMAGES}장까지입니다. 안 쓰는 이미지를 지워 주세요`);
      const ext = String(req.headers['x-file-ext'] ?? '').toLowerCase();
      if (!IMAGE_EXTS.has(ext)) throw new HttpError(400, 'JPG 또는 PNG 사진만 사용할 수 있습니다');
      const buf = await readBody(req, MAX_IMAGE_BYTES);
      if (!buf.length) throw new HttpError(400, '빈 파일입니다');
      const imgId = crypto.randomUUID();
      const dir = path.join(campaignDir(s.companyId, id), 'images');
      fs.mkdirSync(dir, { recursive: true });
      const raw = path.join(dir, `${imgId}.upload${ext}`);
      fs.writeFileSync(raw, buf);
      try {
        await normalizeImage(raw, path.join(dir, `${imgId}.jpg`));
      } catch (err) {
        throw new HttpError(400, err.message);
      } finally {
        fs.rmSync(raw, { force: true });
      }
      q('INSERT INTO images (id, company_id, campaign_id, source, file, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(imgId, s.companyId, id, 'upload', `images/${imgId}.jpg`, now());
      // 비어 있는 자리에 먼저 넣는다
      q('UPDATE campaigns SET vertical_image = COALESCE(vertical_image, ?), feed_image = COALESCE(feed_image, ?), updated_at = ? WHERE id = ?').run(imgId, imgId, now(), id);
      if (!c.verticalImage || !c.feedImage) clearOutputs(id, 'cards', 'ads', 'detail', 'reel');
      return { status: 201, body: { ...view(s.companyId, id), imageId: imgId } };
    },

    'POST /api/campaigns/:id/images/generate': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      if (listImages(s.companyId, id).length >= MAX_IMAGES) throw new HttpError(400, `이미지는 캠페인당 ${MAX_IMAGES}장까지입니다. 안 쓰는 이미지를 지워 주세요`);
      const key = getKey(s.companyId, 'gemini');
      if (!key) throw new HttpError(400, 'Gemini API 키가 등록되지 않았습니다 (설정 → API 키)');
      const b = await readJson(req);
      const style = Object.hasOwn(IMAGE_STYLES, b.style) ? b.style : DEFAULT_IMAGE_STYLE;
      const aspectRatio = Object.hasOwn(IMAGE_RATIOS, b.ratio) ? b.ratio : '9:16';
      const extra = String(b.extra ?? '').slice(0, MAX_EXTRA);
      let reference;
      if (b.referenceId) {
        const ref = q("SELECT file FROM images WHERE id = ? AND campaign_id = ? AND company_id = ? AND source = 'upload'").get(String(b.referenceId), id, s.companyId);
        if (!ref) throw new HttpError(400, '참고 사진은 이 캠페인에 올린 사진만 쓸 수 있습니다');
        reference = { buffer: fs.readFileSync(path.join(campaignDir(s.companyId, id), ref.file)), mimeType: 'image/jpeg' };
      }
      const imgId = crypto.randomUUID();
      const dest = path.join(campaignDir(s.companyId, id), 'images', `${imgId}.jpg`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const t = Date.now();
      let out;
      try {
        out = await imageGenerator(c.facts, dest, { apiKey: key.apiKey, model: key.meta.imageModel, style, extra, aspectRatio, reference });
        logUsage(s.companyId, 'gemini', 'image', true, Date.now() - t);
      } catch (err) {
        logUsage(s.companyId, 'gemini', 'image', false, Date.now() - t);
        fs.rmSync(dest, { force: true });
        throw new HttpError(502, err.message);
      }
      q('INSERT INTO images (id, company_id, campaign_id, source, ratio, style, prompt, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(imgId, s.companyId, id, 'ai', aspectRatio, style, out?.prompt ?? null, `images/${imgId}.jpg`, now());
      // 만든 비율의 자리에 바로 넣고, 다른 자리가 비어 있으면 거기에도 넣는다
      const slot = aspectRatio === '9:16' ? 'vertical_image' : 'feed_image';
      const other = slot === 'vertical_image' ? 'feed_image' : 'vertical_image';
      q(`UPDATE campaigns SET ${slot} = ?, ${other} = COALESCE(${other}, ?), updated_at = ? WHERE id = ?`).run(imgId, imgId, now(), id);
      clearOutputs(id, 'cards', 'ads', 'detail', 'reel');
      return { status: 201, body: { ...view(s.companyId, id), imageId: imgId, style, ratio: aspectRatio } };
    },

    'PUT /api/campaigns/:id/images/slots': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      const b = await readJson(req);
      const pick = (v) => {
        if (v === null || v === undefined || v === '') return null;
        if (!q('SELECT 1 FROM images WHERE id = ? AND campaign_id = ? AND company_id = ?').get(String(v), id, s.companyId)) throw new HttpError(400, '없는 이미지입니다');
        return String(v);
      };
      q('UPDATE campaigns SET vertical_image = ?, feed_image = ?, updated_at = ? WHERE id = ?').run(pick(b.vertical), pick(b.feed), now(), id);
      clearOutputs(id, 'cards', 'ads', 'detail', 'reel');
      return { body: view(s.companyId, id) };
    },

    'DELETE /api/campaigns/:id/images/:img': async (req, s, res, { id, img }) => {
      getCampaign(s.companyId, id);
      const row = q('SELECT file FROM images WHERE id = ? AND campaign_id = ? AND company_id = ?').get(img, id, s.companyId);
      if (!row) throw new HttpError(404, '없는 이미지입니다');
      q('DELETE FROM images WHERE id = ?').run(img);
      fs.rmSync(path.join(campaignDir(s.companyId, id), row.file), { force: true });
      const c = getCampaign(s.companyId, id);
      if (c.verticalImage === img || c.feedImage === img) {
        q('UPDATE campaigns SET vertical_image = NULLIF(vertical_image, ?), feed_image = NULLIF(feed_image, ?), updated_at = ? WHERE id = ?').run(img, img, now(), id);
        clearOutputs(id, 'cards', 'ads', 'detail', 'reel');
      }
      return { body: view(s.companyId, id) };
    },

    'GET /files/campaigns/:id/images/:img': async (req, s, res, { id, img }) => {
      getCampaign(s.companyId, id);
      const file = ID_RE.test(img) && imageFile(s.companyId, id, img);
      if (!file) throw new HttpError(404, '없는 파일');
      sendFile(req, res, file);
    },

    // 카드뉴스 렌더 (1초 안팎)
    'POST /api/campaigns/:id/render': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const company = loadCompany(s.companyId);
      const b = await readJson(req);
      const template = TEMPLATE_NAMES.includes(b.template) ? b.template : 'bold';
      const copy = c.copy ?? offlineCopy(c.facts);
      const variant = Math.min(Math.max(Number(b.variant) || 0, 0), copy.variants.length - 1);
      const slides = buildSlides(applyCopy(c.facts, copy, variant));
      const dir = path.join(campaignDir(s.companyId, id), template);
      fs.rmSync(dir, { recursive: true, force: true });
      const files = await renderCards(slides, brandForEngine(company), c.facts.handle, dir, template, { coverImage: photosFor(s.companyId, c).feed, logo: logoPath(company), aiBadge: company.brand.aiBadge });
      labelAll(files);
      saveOutputs(id, { cards: { template, variant, files: files.map((f) => path.basename(f)) }, reel: null });
      reels.delete(id);
      return { body: view(s.companyId, id) };
    },

    // 릴스 렌더 (30초 안팎, 순서대로 하나씩)
    'POST /api/campaigns/:id/reel': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      requireActive(s.companyId);
      const cards = campaignView(s.companyId, c).render;
      if (!cards) throw new HttpError(409, '카드뉴스를 먼저 만드세요');
      if (['queued', 'rendering'].includes(reels.get(id)?.status)) return { status: 202, body: view(s.companyId, id) };
      const company = loadCompany(s.companyId);
      const copy = c.copy ?? offlineCopy(c.facts);
      const slides = buildSlides(applyCopy(c.facts, copy, cards.variant));
      const dir = path.join(campaignDir(s.companyId, id), cards.template);
      const coverImage = photosFor(s.companyId, c).vertical;
      const state = { status: 'queued' };
      reels.set(id, state);
      reelQueue = reelQueue.then(async () => {
        state.status = 'rendering';
        try {
          const out = path.join(dir, 'reel.mp4');
          await reelRenderer(slides, brandForEngine(company), c.facts.handle, out, { template: cards.template, coverImage, projectDir: path.join(dir, 'project') });
          await labelMp4(out);
          fs.rmSync(path.join(dir, 'project'), { recursive: true, force: true });
          if (reels.get(id) === state) {
            saveOutputs(id, { reel: true });
            reels.delete(id);
          }
        } catch (err) {
          Object.assign(state, { status: 'error', error: err.message });
        }
      });
      return { status: 202, body: view(s.companyId, id) };
    },

    'GET /api/campaigns/:id/zip': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const v = campaignView(s.companyId, c);
      if (!v.render) throw new HttpError(409, '카드뉴스를 먼저 만드세요');
      const o = c.outputs;
      const dir = campaignDir(s.companyId, id);
      const copy = c.copy ?? offlineCopy(c.facts);
      const entries = {};
      const add = (name, file) => (entries[name] = [fs.readFileSync(file), { level: 0 }]);
      if (v.ads) {
        for (const f of Object.values(o.ads.files)) add(`인스타광고/${f}`, path.join(dir, 'ads', f));
        entries['인스타광고/광고문구.md'] = Buffer.from(adCopyMarkdown(c.adCopy ?? offlineAdCopy(c.facts), o.ads.variant));
      }
      if (v.detailImages) for (const f of o.detail.files) add(`상세페이지/${f}`, path.join(dir, 'detail', f));
      for (const f of o.cards.files) add(`카드뉴스/${f}`, path.join(dir, o.cards.template, f));
      entries['홍보카피.md'] = Buffer.from(copyToMarkdown(copy, c.facts));
      entries['팩트시트.json'] = Buffer.from(JSON.stringify(c.facts, null, 2));
      if (v.render.reel.status === 'done') add('릴스_15초.mp4', path.join(dir, o.cards.template, 'reel.mp4'));
      const zip = Buffer.from(zipSync(entries));
      const day = now().slice(0, 10).replace(/-/g, '');
      const name = `${loadCompany(s.companyId).name}_홍보키트_${day}.zip`;
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': zip.length,
        'content-disposition': `attachment; filename="promo-kit_${day}.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
      });
      res.end(zip);
    },

    'GET /files/campaigns/:id/:group/:name': async (req, s, res, { id, group, name }) => {
      getCampaign(s.companyId, id);
      if (!(TEMPLATE_NAMES.includes(group) || GROUPS.has(group)) || !FILE_RE.test(name)) throw new HttpError(404, '없는 파일');
      sendFile(req, res, path.join(campaignDir(s.companyId, id), group, name));
    },

    // 자료(PDF·PPTX·DOCX) → 팩트 시트 초안 (저장하지 않음 — 사용자가 확인 후 저장)
    'POST /api/import': async (req, s) => {
      requireActive(s.companyId);
      const ext = String(req.headers['x-file-ext'] ?? '').toLowerCase();
      const type = IMPORT_TYPES[ext];
      if (!type) throw new HttpError(400, 'PDF, PPTX, DOCX 자료만 올릴 수 있습니다');
      const kind = KIND_NAMES.includes(req.headers['x-kind']) ? req.headers['x-kind'] : DEFAULT_KIND;
      const key = getKey(s.companyId, 'anthropic');
      if (!key) throw new HttpError(400, '자료에서 초안을 만들려면 Claude API 키가 필요합니다 (설정 → API 키)');
      const buf = await readBody(req, MAX_IMPORT_BYTES);
      if (!buf.length) throw new HttpError(400, '빈 파일입니다');
      const t = Date.now();
      try {
        const out = await importer(buf, type, { apiKey: key.apiKey, model: key.meta.textModel, kind });
        logUsage(s.companyId, 'anthropic', 'import', true, Date.now() - t);
        return { body: { ...out, facts: { ...out.facts, kind } } };
      } catch (err) {
        logUsage(s.companyId, 'anthropic', 'import', false, Date.now() - t);
        throw new HttpError(422, err.message);
      }
    },
  });

  function serveStatic(req, res, pathname) {
    if (pathname.startsWith('/fonts/')) {
      const name = pathname.slice(7);
      if (!/^Pretendard-(Regular|SemiBold|Bold|ExtraBold)\.otf$/.test(name)) throw new HttpError(404, '없는 파일');
      return sendFile(req, res, path.join(FONT_DIR, name), { 'cache-control': 'public, max-age=86400' });
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^[a-z0-9-]+\.(html|js|css)$/.test(rel)) throw new HttpError(404, '없는 파일');
    return sendFile(req, res, path.join(PUBLIC_DIR, rel));
  }

  // 만료된 세션·초대·재설정 링크 정리(시작 시 + 1시간마다)
  const cleanup = () => {
    const t = now();
    q('DELETE FROM sessions WHERE expires_at < ?').run(t);
    q('DELETE FROM invites WHERE accepted_at IS NULL AND expires_at < ?').run(t);
    q('DELETE FROM reset_tokens WHERE expires_at < ?').run(t);
  };
  cleanup();
  const cleanupTimer = setInterval(cleanup, 3600_000).unref();

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (secureCookie) res.setHeader('strict-transport-security', 'max-age=31536000');
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const method = req.method === 'HEAD' ? 'GET' : req.method; // HEAD는 GET처럼(본문은 Node가 생략)
      // CSRF: 상태를 바꾸는 API 요청은 앱이 붙이는 헤더가 있어야 한다(다른 사이트의 폼 전송 차단)
      if (method !== 'GET' && pathname.startsWith('/api/') && req.headers['x-requested-with'] !== 'fetch') {
        throw new HttpError(403, '허용되지 않은 요청입니다');
      }
      const send = (out) => out && !res.headersSent && sendJson(res, out.status ?? 200, out.body ?? {}, out.headers);
      const p = pub(method, pathname);
      if (p) return send(await p.handler(req, null, res, p.params));
      const m = priv(method, pathname);
      if (m) {
        const s = sessionFrom(req);
        if (!s) throw new HttpError(401, '로그인이 필요합니다');
        return send(await m.handler(req, s, res, m.params));
      }
      if (method === 'GET' && !pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
      throw new HttpError(404, '없는 경로');
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? '서버 오류가 발생했습니다' : err.message });
      else res.end();
    }
  });
  let closed = false;
  server.on('close', () => {
    clearInterval(cleanupTimer);
    if (!closed) db.close();
    closed = true;
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5180;
  const host = process.env.HOST || '127.0.0.1';
  const server = createApp({ dataDir: process.env.DATA_DIR || undefined });
  server.listen(port, host, () => console.log(`홍보공장 앱 실행 중: http://${host}:${port}`));
  // 배포 환경의 종료 신호: 새 요청을 받지 않고 진행 중인 요청을 마친 뒤 종료
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`${sig} 받음 — 종료 중`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
