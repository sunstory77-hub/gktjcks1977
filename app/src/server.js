// 홍보공장 앱 서버 (1~4주차: 멀티 테넌트 기반)
// 회원·회사 프로필·브랜드 킷·API 키(암호화)·캠페인(팩트 시트) + PoC 엔진(카피·카드뉴스·릴스·AI 배경)
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
import { generateCopy, anthropicClient, offlineCopy, applyCopy, copyToMarkdown } from '../../poc/src/ai.js';
import { normalizeImage, normalizeLogo, IMAGE_EXTS, MAX_IMAGE_BYTES } from '../../poc/src/images.js';
import { generateCoverImage, IMAGE_STYLES, DEFAULT_IMAGE_STYLE } from '../../poc/src/imagegen.js';
import { sanitizeBrief } from '../../poc/src/server.js';

import { openDb, now, json, parse } from './db.js';
import { hashPassword, verifyPassword, newToken, tokenHash, loadMasterKey, encryptSecret, decryptSecret } from './security.js';
import { PROVIDERS, testKey } from './providers.js';
import { DEFAULT_BRAND, sanitizeProfile, sanitizeBrand, findForbidden } from './brand.js';
import { HttpError, readBody, readJson, sendJson, parseCookies, cookie, sendFile, router } from './http.js';

const require = createRequire(import.meta.url);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const FONT_DIR = path.join(path.dirname(require.resolve('../../poc/node_modules/pretendard/package.json')), 'dist/public/static');
const SAMPLE_FACTS = JSON.parse(fs.readFileSync(path.join(APP_ROOT, '..', 'poc', 'brief.sample.json'), 'utf8'));

const SESSION_DAYS = 14;
const ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^(card_\d{2}_[a-z]+\.png|reel\.mp4)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 기본 생성기: 회사 키로 호출. 테스트에서는 가짜 생성기를 주입한다.
const defaultCopyGenerator = (facts, { apiKey, model, voice }) => generateCopy(facts, { client: anthropicClient(apiKey), model, voice });
const defaultImageGenerator = (facts, dest, { apiKey, model, style }) => generateCoverImage(facts, dest, { apiKey, model, style });

export function createApp({
  dataDir = path.join(APP_ROOT, 'data'),
  env = process.env,
  copyGenerator = defaultCopyGenerator,
  imageGenerator = defaultImageGenerator,
  reelRenderer = renderReel,
  keyTester = testKey,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'app.db'));
  const masterKey = loadMasterKey(dataDir, env);
  const secureCookie = env.COOKIE_SECURE === '1';
  const renders = new Map(); // campaignId → { template, variant, cards, reel }
  let reelQueue = Promise.resolve();
  const loginAttempts = new Map();

  // ── 조회 헬퍼 ──
  const q = (sql) => db.prepare(sql);
  const companyDir = (cid) => path.join(dataDir, 'companies', cid);
  const campaignDir = (cid, id) => path.join(companyDir(cid), 'campaigns', id);

  function loadCompany(cid) {
    const row = q('SELECT * FROM companies WHERE id = ?').get(cid);
    return { id: row.id, name: row.name, profile: parse(row.profile), brand: { ...DEFAULT_BRAND, ...parse(row.brand) }, logoFile: row.logo_file };
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

  function getKey(cid, provider) {
    const row = q('SELECT ciphertext, meta FROM api_keys WHERE company_id = ? AND provider = ?').get(cid, provider);
    if (!row) return null;
    return { apiKey: decryptSecret(masterKey, row.ciphertext, cid, provider), meta: parse(row.meta) };
  }

  function logUsage(cid, provider, kind, ok, ms) {
    q('INSERT INTO usage_log (company_id, provider, kind, ok, ms, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(cid, provider, kind, ok ? 1 : 0, Math.round(ms), now());
  }

  function getCampaign(cid, id) {
    const row = ID_RE.test(id) && q('SELECT * FROM campaigns WHERE id = ? AND company_id = ?').get(id, cid);
    if (!row) throw new HttpError(404, '캠페인을 찾을 수 없습니다');
    return { id: row.id, title: row.title, facts: parse(row.facts), copy: parse(row.copy, null), coverFile: row.cover_file, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  const campaignView = (c) => {
    const r = renders.get(c.id);
    return {
      id: c.id,
      title: c.title,
      facts: c.facts,
      copy: c.copy,
      hasCover: Boolean(c.coverFile),
      updatedAt: c.updatedAt,
      render: r && {
        template: r.template,
        variant: r.variant,
        cards: r.cards.map((f) => `/files/campaigns/${c.id}/${r.template}/${f}`),
        reel: { status: r.reel.status, error: r.reel.error, url: r.reel.status === 'done' ? `/files/campaigns/${c.id}/${r.template}/reel.mp4` : null },
      },
    };
  };

  // 팩트 시트: PoC 브리프 검증 + 회사 기본값(SNS 계정·해시태그)
  function factsFor(company, raw) {
    const merged = { ...raw, handle: raw?.handle || company.profile.handle, hashtags: raw?.hashtags?.length ? raw.hashtags : company.brand.hashtags };
    return sanitizeBrief(merged);
  }

  const brandForEngine = (company) => ({ colors: company.brand.colors });
  const logoPath = (company) => (company.logoFile ? path.join(companyDir(company.id), company.logoFile) : undefined);

  // ── 공개 라우트 ──
  const pub = router({
    'POST /api/auth/signup': async (req) => {
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const name = String(b.name ?? '').trim().slice(0, 40);
      const companyName = String(b.companyName ?? '').trim().slice(0, 60);
      if (!EMAIL_RE.test(email)) throw new HttpError(400, '이메일 형식이 아닙니다');
      if (String(b.password ?? '').length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다');
      if (!name || !companyName) throw new HttpError(400, '이름과 회사명을 입력하세요');
      if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, '이미 가입된 이메일입니다');
      const userId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const t = now();
      q('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, email, name, hashPassword(String(b.password)), t);
      q('INSERT INTO companies (id, name, profile, brand, created_at) VALUES (?, ?, ?, ?, ?)').run(companyId, companyName, json({}), json(DEFAULT_BRAND), t);
      q("INSERT INTO memberships (user_id, company_id, role) VALUES (?, ?, 'owner')").run(userId, companyId);
      return { status: 201, body: { ok: true }, headers: { 'set-cookie': startSession(userId) } };
    },

    'POST /api/auth/login': async (req) => {
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const k = `${req.socket.remoteAddress}|${email}`;
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

    // 로그인 여부만 알려 준다(첫 화면에서 401 오류 없이 분기하기 위해)
    'GET /api/session': async (req) => ({ body: { loggedIn: Boolean(sessionFrom(req)) } }),

    'GET /api/meta': async () => ({
      body: {
        templates: TEMPLATE_NAMES.map((name) => ({ name, label: TEMPLATE_LABELS[name] })),
        imageStyles: Object.entries(IMAGE_STYLES).map(([name, s]) => ({ name, label: s.label })),
        providers: Object.entries(PROVIDERS).map(([name, p]) => ({ name, label: p.label, use: p.use })),
        sampleFacts: SAMPLE_FACTS,
      },
    }),
  });

  // ── 로그인 필요 라우트 (s = 세션) ──
  const priv = router({
    'GET /api/me': async (req, s) => {
      const company = loadCompany(s.companyId);
      const keys = Object.fromEntries(
        Object.keys(PROVIDERS).map((p) => {
          const row = q('SELECT last4, meta, updated_at FROM api_keys WHERE company_id = ? AND provider = ?').get(s.companyId, p);
          return [p, row ? { last4: row.last4, ...parse(row.meta), updatedAt: row.updated_at } : null];
        }),
      );
      return {
        body: {
          user: { email: s.email, name: s.name, role: s.role },
          company: { id: company.id, name: company.name, profile: company.profile, brand: company.brand, hasLogo: Boolean(company.logoFile) },
          keys,
        },
      };
    },

    'PUT /api/company': async (req, s) => {
      const b = await readJson(req);
      const name = String(b.name ?? '').trim().slice(0, 60);
      if (!name) throw new HttpError(400, '회사명을 입력하세요');
      q('UPDATE companies SET name = ?, profile = ? WHERE id = ?').run(name, json(sanitizeProfile(b.profile)), s.companyId);
      return { body: { ok: true } };
    },

    'PUT /api/company/brand': async (req, s) => {
      const { brand, adjusted } = sanitizeBrand(await readJson(req));
      q('UPDATE companies SET brand = ? WHERE id = ?').run(json(brand), s.companyId);
      return { body: { brand, adjusted } };
    },

    'POST /api/company/logo': async (req, s) => {
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
      fs.rmSync(path.join(companyDir(s.companyId), 'logo.png'), { force: true });
      q('UPDATE companies SET logo_file = NULL WHERE id = ?').run(s.companyId);
      return { body: { ok: true } };
    },

    // API 키: 연결 테스트를 통과해야 저장. 저장 후에는 끝 4자리만 보여 준다.
    'PUT /api/keys/:provider': async (req, s, res, { provider }) => {
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
      q('DELETE FROM api_keys WHERE company_id = ? AND provider = ?').run(s.companyId, provider);
      return { body: { ok: true } };
    },

    'GET /api/usage': async (req, s) => {
      const since = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const rows = q(
        'SELECT provider, kind, SUM(ok) AS ok, COUNT(*) AS total FROM usage_log WHERE company_id = ? AND created_at >= ? GROUP BY provider, kind',
      ).all(s.companyId, since);
      return { body: { since, rows } };
    },

    // ── 캠페인 ──
    'GET /api/campaigns': async (req, s) => ({
      body: q('SELECT id, title, updated_at FROM campaigns WHERE company_id = ? ORDER BY updated_at DESC LIMIT 100').all(s.companyId).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })),
    }),

    'POST /api/campaigns': async (req, s) => {
      const facts = factsFor(loadCompany(s.companyId), (await readJson(req)).facts);
      const id = crypto.randomUUID();
      const t = now();
      q('INSERT INTO campaigns (id, company_id, title, facts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, s.companyId, facts.title.replace(/\n/g, ' '), json(facts), t, t);
      return { status: 201, body: campaignView(getCampaign(s.companyId, id)) };
    },

    'GET /api/campaigns/:id': async (req, s, res, { id }) => ({ body: campaignView(getCampaign(s.companyId, id)) }),

    'PUT /api/campaigns/:id': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      const facts = factsFor(loadCompany(s.companyId), (await readJson(req)).facts);
      // 팩트가 바뀌면 이전 카피·렌더는 무효
      q('UPDATE campaigns SET title = ?, facts = ?, copy = NULL, updated_at = ? WHERE id = ? AND company_id = ?').run(facts.title.replace(/\n/g, ' '), json(facts), now(), id, s.companyId);
      renders.delete(id);
      return { body: campaignView(getCampaign(s.companyId, id)) };
    },

    'DELETE /api/campaigns/:id': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      q('DELETE FROM campaigns WHERE id = ? AND company_id = ?').run(id, s.companyId);
      fs.rmSync(campaignDir(s.companyId, id), { recursive: true, force: true });
      renders.delete(id);
      return { body: { ok: true } };
    },

    // 카피: 회사 Claude 키로 3안. 키가 없거나 실패하면 입력 문구로 대체하고 이유를 알린다.
    'POST /api/campaigns/:id/copy': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const company = loadCompany(s.companyId);
      const { ai = true } = await readJson(req);
      const warnings = [];
      let copy;
      const key = ai ? getKey(s.companyId, 'anthropic') : null;
      if (ai && !key) warnings.push('Claude API 키가 등록되지 않아 입력 문구로 만들었습니다 (설정 → API 키)');
      if (key) {
        const t = Date.now();
        try {
          copy = await copyGenerator(c.facts, { apiKey: key.apiKey, model: key.meta.textModel, voice: { brandName: company.name, tone: company.brand.tone } });
          logUsage(s.companyId, 'anthropic', 'copy', true, Date.now() - t);
          warnings.push(...(copy.warnings ?? []));
        } catch (err) {
          logUsage(s.companyId, 'anthropic', 'copy', false, Date.now() - t);
          warnings.push(`AI 카피 생성 실패 → 입력 문구로 대체: ${err.message}`);
        }
      }
      copy ??= offlineCopy(c.facts);
      const forbidden = findForbidden(copy, company.brand.forbidden);
      for (const f of forbidden) warnings.push(`금지 표현 "${f.word}" 포함: ${f.where.join(', ')}`);
      q('UPDATE campaigns SET copy = ?, updated_at = ? WHERE id = ?').run(json({ ...copy, warnings }), now(), id);
      renders.delete(id);
      return { body: { ...campaignView(getCampaign(s.companyId, id)), warnings } };
    },

    'POST /api/campaigns/:id/cover': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      const ext = String(req.headers['x-file-ext'] ?? '').toLowerCase();
      if (!IMAGE_EXTS.has(ext)) throw new HttpError(400, 'JPG 또는 PNG 사진만 사용할 수 있습니다');
      const buf = await readBody(req, MAX_IMAGE_BYTES);
      if (!buf.length) throw new HttpError(400, '빈 파일입니다');
      const dir = campaignDir(s.companyId, id);
      fs.mkdirSync(dir, { recursive: true });
      const raw = path.join(dir, `cover.upload${ext}`);
      fs.writeFileSync(raw, buf);
      try {
        await normalizeImage(raw, path.join(dir, 'cover.jpg'));
      } catch (err) {
        throw new HttpError(400, err.message);
      } finally {
        fs.rmSync(raw, { force: true });
      }
      q("UPDATE campaigns SET cover_file = 'cover.jpg', updated_at = ? WHERE id = ?").run(now(), id);
      renders.delete(id);
      return { body: { ok: true } };
    },

    'POST /api/campaigns/:id/cover/generate': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const key = getKey(s.companyId, 'gemini');
      if (!key) throw new HttpError(400, 'Gemini API 키가 등록되지 않았습니다 (설정 → API 키)');
      const b = await readJson(req);
      const style = Object.hasOwn(IMAGE_STYLES, b.style) ? b.style : DEFAULT_IMAGE_STYLE;
      const dir = campaignDir(s.companyId, id);
      fs.mkdirSync(dir, { recursive: true });
      const t = Date.now();
      try {
        await imageGenerator(c.facts, path.join(dir, 'cover.jpg'), { apiKey: key.apiKey, model: key.meta.imageModel, style });
        logUsage(s.companyId, 'gemini', 'image', true, Date.now() - t);
      } catch (err) {
        logUsage(s.companyId, 'gemini', 'image', false, Date.now() - t);
        throw new HttpError(502, err.message);
      }
      q("UPDATE campaigns SET cover_file = 'cover.jpg', updated_at = ? WHERE id = ?").run(now(), id);
      renders.delete(id);
      return { body: { ok: true, style } };
    },

    'GET /api/campaigns/:id/cover': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      if (!c.coverFile) throw new HttpError(404, '표지 사진이 없습니다');
      sendFile(req, res, path.join(campaignDir(s.companyId, id), c.coverFile));
    },

    'DELETE /api/campaigns/:id/cover': async (req, s, res, { id }) => {
      getCampaign(s.companyId, id);
      fs.rmSync(path.join(campaignDir(s.companyId, id), 'cover.jpg'), { force: true });
      q('UPDATE campaigns SET cover_file = NULL, updated_at = ? WHERE id = ?').run(now(), id);
      renders.delete(id);
      return { body: { ok: true } };
    },

    // 카드뉴스 렌더 (1초 안팎)
    'POST /api/campaigns/:id/render': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const company = loadCompany(s.companyId);
      const b = await readJson(req);
      const template = TEMPLATE_NAMES.includes(b.template) ? b.template : 'bold';
      const copy = c.copy ?? offlineCopy(c.facts);
      const variant = Math.min(Math.max(Number(b.variant) || 0, 0), copy.variants.length - 1);
      const slides = buildSlides(applyCopy(c.facts, copy, variant));
      const dir = path.join(campaignDir(s.companyId, id), template);
      fs.rmSync(dir, { recursive: true, force: true });
      const coverImage = c.coverFile ? path.join(campaignDir(s.companyId, id), c.coverFile) : undefined;
      const files = await renderCards(slides, brandForEngine(company), c.facts.handle, dir, template, { coverImage, logo: logoPath(company) });
      renders.set(id, { template, variant, slides, dir, coverImage, handle: c.facts.handle, cards: files.map((f) => path.basename(f)), reel: { status: 'idle' } });
      return { body: campaignView(c) };
    },

    // 릴스 렌더 (30초 안팎, 순서대로 하나씩)
    'POST /api/campaigns/:id/reel': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const r = renders.get(id);
      if (!r) throw new HttpError(409, '카드뉴스를 먼저 만드세요');
      if (['queued', 'rendering'].includes(r.reel.status)) return { status: 202, body: campaignView(c) };
      const brand = brandForEngine(loadCompany(s.companyId));
      r.reel = { status: 'queued' };
      reelQueue = reelQueue.then(async () => {
        r.reel = { status: 'rendering' };
        try {
          await reelRenderer(r.slides, brand, r.handle, path.join(r.dir, 'reel.mp4'), { template: r.template, coverImage: r.coverImage, projectDir: path.join(r.dir, 'project') });
          r.reel = { status: 'done' };
        } catch (err) {
          r.reel = { status: 'error', error: err.message };
        }
      });
      return { status: 202, body: campaignView(c) };
    },

    'GET /api/campaigns/:id/zip': async (req, s, res, { id }) => {
      const c = getCampaign(s.companyId, id);
      const r = renders.get(id);
      if (!r) throw new HttpError(409, '카드뉴스를 먼저 만드세요');
      const copy = c.copy ?? offlineCopy(c.facts);
      const entries = {};
      for (const f of r.cards) entries[`카드뉴스/${f}`] = [fs.readFileSync(path.join(r.dir, f)), { level: 0 }];
      entries['홍보카피.md'] = Buffer.from(copyToMarkdown(copy, c.facts));
      entries['팩트시트.json'] = Buffer.from(JSON.stringify(c.facts, null, 2));
      if (r.reel.status === 'done') entries['릴스_15초.mp4'] = [fs.readFileSync(path.join(r.dir, 'reel.mp4')), { level: 0 }];
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

    'GET /files/campaigns/:id/:template/:name': async (req, s, res, { id, template, name }) => {
      getCampaign(s.companyId, id);
      if (!TEMPLATE_NAMES.includes(template) || !FILE_RE.test(name)) throw new HttpError(404, '없는 파일');
      sendFile(req, res, path.join(campaignDir(s.companyId, id), template, name));
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

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      // CSRF: 상태를 바꾸는 API 요청은 앱이 붙이는 헤더가 있어야 한다(다른 사이트의 폼 전송 차단)
      if (req.method !== 'GET' && pathname.startsWith('/api/') && req.headers['x-requested-with'] !== 'fetch') {
        throw new HttpError(403, '허용되지 않은 요청입니다');
      }
      const send = (out) => out && !res.headersSent && sendJson(res, out.status ?? 200, out.body ?? {}, out.headers);
      const p = pub(req.method, pathname);
      if (p) return send(await p.handler(req));
      const m = priv(req.method, pathname);
      if (m) {
        const s = sessionFrom(req);
        if (!s) throw new HttpError(401, '로그인이 필요합니다');
        return send(await m.handler(req, s, res, m.params));
      }
      if (req.method === 'GET' && !pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
      throw new HttpError(404, '없는 경로');
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? '서버 오류가 발생했습니다' : err.message });
      else res.end();
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5180;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => console.log(`홍보공장 앱 실행 중: http://${host}:${port}`));
}
