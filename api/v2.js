import { verifyToken, signToken, signResetCode, verifyResetToken, cookieOpts, clearCookieOpts } from './_lib/auth.js';
import { ok, bad, unauth, getCookie, setCookieHeader } from './_lib/http.js';
import { kvGet, kvSet, kvDel, kvKeys, kvSetnx, kvIncrby, kvZrange, kvZadd, kvZrem, healthCheck, isKvUnavailable } from './_lib/storage.js';
import { createDeal, updateDeal, getDeal, saveDeal, listDeals, seedDeals, seedIois, bumpIoiCounters, appendAuditEntry, validateDealForPublish } from './_lib/deal-storage.js';
import {
  sendAccessCode, sendDealReceived, sendStageChange,
  sendDataRoomAccess, sendAccessApplication, sendAccessApplicationAck, sendAdvisorApplication,
  sendAdvisorWelcome, sendPasswordReset, sendIoiPackage,
  sendIoiConfirmation, sendIoiRejection, sendDataRoomPackageResponse,
  sendQaQuestionToAdvisor, sendQaAnswerToInvestor,
  sendCapitalCallNotice, sendDistributionNotice, sendQaReminder,
  sendNavUpdate, sendStatementAvailable, sendDistributionNoticeWithAmount,
  sendWelcomeDay2, sendWelcomeDay7,
} from './_lib/email.js';
import { captureException, captureMessage } from './_lib/sentry.js';
import { uploadDocument, getDocumentUrl } from './_lib/blob-storage.js';
import { sendSubscriptionDocument, checkEnvelopeStatus } from './_lib/docusign.js';
import { initiateKycCheck, getKycStatus } from './_lib/kyc.js';
import { callAI, scoreDeal } from './_lib/ai.js';
import { wipeAll, seedBotAccounts, seedHighVolume } from './_lib/bot-seed.js';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

// ── DD Dataroom helpers (shared by advisor + investor branches) ────────────
// DD window closes 14 days before closing_date. If closing_date missing, treat
// as active with null deadline (frontend renders "DD deadline TBD").
function ddInfo(deal) {
  const raw = deal?.closing_date || deal?.closing;
  if (!raw) return { dd_deadline: null, dd_active: true };
  const closing = new Date(raw);
  if (isNaN(closing)) return { dd_deadline: null, dd_active: true };
  const deadline = new Date(closing.getTime() - 14 * 24 * 60 * 60 * 1000);
  return { dd_deadline: deadline.toISOString(), dd_active: Date.now() < deadline.getTime() };
}

// Sanitize free-text Q&A input. Trim, cap at maxLen, strip control chars
// (except \n \r \t). Frontend HTML-escapes for display; this just normalises.
function sanitizeText(input, maxLen = 2000) {
  if (input == null) return '';
  let s = String(input).trim();
  // Strip ASCII control chars except \n \r \t
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// Per-deal anonymous-investor map: investor_id → "Investor #N", assigned in
// order of first question. Stored at qa_anon_map:{dealId}.
async function assignAnonLabel(dealId, investorId) {
  const key = `qa_anon_map:${dealId}`;
  const map = (await kvGet(key)) || {};
  if (map[investorId]) return { map, label: map[investorId], created: false };
  const next = Object.keys(map).length + 1;
  const label = `Investor #${next}`;
  map[investorId] = label;
  await kvSet(key, map);
  return { map, label, created: true };
}
async function getAnonLabel(dealId, investorId) {
  const map = (await kvGet(`qa_anon_map:${dealId}`)) || {};
  return map[investorId] || null;
}
function maskQaThreadsForInvestor(threads, anonMap) {
  return (threads || []).map(t => {
    if (t.type === 'advisor_open') return t;
    const anon = anonMap[t.investor_id] || t.askedBy_anon || 'Investor';
    return {
      id: t.id,
      question: t.question,
      asked_by_name: anon,
      asked_at: t.asked_at || t.askedAt || null,
      answer: t.answer || null,
      answered_at: t.answered_at || t.answeredAt || null,
    };
  });
}

// ── Rate limiting helper (sliding window via Redis INCR+EXPIRE) ─────────────
// Returns the current attempt count for this IP within the 15-minute window.
// On the first hit (count === 1) we write the key with a 900-second TTL, which
// also anchors the window. Subsequent hits just INCRBY against the existing key
// (Redis preserves the TTL on INCRBY). When count > 10 the caller returns 429.
async function checkRateLimit(ip) {
  const key = `ratelimit:auth:${ip}`;
  // Check current value before incrementing so we can set TTL only on first hit
  const existing = await kvGet(key);
  if (!existing) {
    // First request in this window — write with TTL to anchor the 15-min window
    await kvSet(key, '1', { ex: 900 });
    return 1;
  }
  const count = await kvIncrby(key, 1);
  return count;
}

// Extract client IP from Vercel's forwarded header
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// BOT_MODE rate-limit bypass.
// Returns true ONLY if all of the following hold:
//   1. process.env.BOT_MODE === '1'
//   2. Request carries header `x-bot-mode: 1`
//   3. Request carries a valid `prism_admin` cookie (verified via JWT)
// Tightly scoped — production traffic without BOT_MODE set can never bypass.
async function shouldBypassRateLimit(req) {
  if (process.env.BOT_MODE !== '1') return false;
  if (req.headers['x-bot-mode'] !== '1') return false;
  const t = getCookie(req, 'prism_admin');
  if (!t) return false;
  try {
    const p = await verifyToken(t);
    return !!(p && p.role === 'admin');
  } catch { return false; }
}

export default async function handler(req, res) {
  const { resource, op } = req.query;

  // ── CORS ────────────────────────────────────────────────────
  const allowedOrigin = process.env.SITE_URL || '';
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── Sentry top-level error capture ──────────────────────────
  // Wraps the entire handler so unhandled exceptions are reported.
  // SENTRY_DSN env var must be set to activate — see api/_lib/sentry.js.
  try {
    return await _handler(req, res, resource, op);
  } catch (err) {
    console.error('[v2] Unhandled error:', err?.message, err?.stack, { resource, op });
    await captureException(err, { resource, op }).catch(() => {});
    if (!res.headersSent) {
      // In bot-test sandbox, surface the actual error message so failures are debuggable.
      // In production (BOT_MODE off), keep the generic message to avoid leaking internals.
      const exposeReal = process.env.BOT_MODE === '1';
      const msg = exposeReal && err?.message
        ? `[${resource}/${op}] ${err.message}`
        : 'Internal server error';
      res.status(500).json({ error: msg });
    }
  }
}

// Inner handler — separated so the try/catch above can wrap everything cleanly.
async function _handler(req, res, resource, op) {

  // ── Health check ────────────────────────────────────────────
  if (resource === 'health') {
    const h = await healthCheck();
    return ok(res, { ...h, kv: isKvUnavailable() ? 'unavailable' : 'connected' });
  }

  // ── Auth helpers ─────────────────────────────────────────────
  // ── Denylist check helper ────────────────────────────────────────
  async function isRevoked(payload) {
    if (!payload?.jti) return false;
    const hit = await kvGet('revoked:' + payload.jti);
    return !!hit;
  }

  async function getAdmin() {
    const t = getCookie(req, 'prism_admin');
    if (!t) return null;
    const p = await verifyToken(t);
    if (!p || p.role !== 'admin') return null;
    if (await isRevoked(p)) { res.setHeader('Set-Cookie', setCookieHeader('prism_admin', '', clearCookieOpts())); return null; }
    return p;
  }
  async function getAdvisor() {
    const t = getCookie(req, 'prism_advisor');
    if (!t) return null;
    const p = await verifyToken(t);
    if (!p || p.role !== 'advisor') return null;
    if (await isRevoked(p)) { res.setHeader('Set-Cookie', setCookieHeader('prism_advisor', '', clearCookieOpts())); return null; }
    return p;
  }
  async function getInst() {
    const t = getCookie(req, 'prism_inst');
    if (!t) return null;
    const p = await verifyToken(t);
    if (!p || p.role !== 'inst') return null;
    if (await isRevoked(p)) { res.setHeader('Set-Cookie', setCookieHeader('prism_inst', '', clearCookieOpts())); return null; }
    return p;
  }
  async function getAnyAuth() {
    // Bot-driver runs in an admin tab, so the admin cookie is always set.
    // When a bot persona logs in (sets prism_inst or prism_advisor) and then
    // hits a getAnyAuth endpoint, the admin cookie would otherwise win and
    // overwrite the persona's identity. The x-bot-as header lets the bot
    // pin which role's cookie to honor.
    const botAs = req.headers['x-bot-as'];
    if (botAs === 'investor') return await getInst();
    if (botAs === 'advisor') return await getAdvisor();
    if (botAs === 'admin') return await getAdmin();
    return await getAdmin() || await getAdvisor() || await getInst();
  }

  // Fetch all IOI records via the ioi_index sorted set — O(log N + M) vs O(N) KEYS scan.
  // Returns an array of hydrated IOI objects (nulls filtered).
  // 5s Redis cache — getAllIois is called from 15+ endpoints. Without caching,
  // a single bot tick that touches my-iois + performance + ioi-submit triggers
  // ~4,500 Redis ops; with caching it's typically 1 (cache hit).
  async function getAllIois() {
    try {
      const cached = await kvGet('cache:iois:all');
      if (Array.isArray(cached)) return cached;
    } catch {}
    const ioiIds = await kvZrange('ioi_index', 0, -1);
    const list = (await Promise.all(ioiIds.map(id => kvGet(`ioi:${id}`)))).filter(Boolean);
    try { await kvSet('cache:iois:all', list, { ex: 5 }); } catch {}
    return list;
  }

  // ─────────────────────────────────────────────────────────────
  // ADVISOR RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'advisor') {

    if (op === 'login') {
      const ip = getClientIp(req);
      if (!(await shouldBypassRateLimit(req)) && await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      const { email, password } = req.body || {};
      if (!email || !password) return bad(res, 'Email and password required');
      const stored = await kvGet(`advisor_email:${email.toLowerCase()}`);
      if (!stored) return bad(res, 'Invalid credentials', 401);
      const adv = await kvGet(`advisor:${stored}`);
      if (!adv) return bad(res, 'Invalid credentials', 401);
      if (adv.status === 'suspended') return bad(res, 'Account suspended. Contact platform operators.', 403);
      const match = await bcrypt.compare(password, adv.password_hash);
      if (!match) return bad(res, 'Invalid credentials', 401);
      // First login flag
      if (adv.requires_setup) {
        const setupToken = await signToken({ advisor_id: adv.id, email: adv.email, setup: true }, '1h');
        return ok(res, { requires_setup: true, setup_token: setupToken });
      }
      const token = await signToken({ advisor_id: adv.id, email: adv.email, name: adv.name || '', firm: adv.firm_name, role: 'advisor' }, '7d');
      res.setHeader('Set-Cookie', setCookieHeader('prism_advisor', token, cookieOpts(604800)));
      return ok(res, { advisor: sanitizeAdvisor(adv) });
    }

    if (op === 'setup-password') {
      const { setup_token, password } = req.body || {};
      if (!setup_token || !password) return bad(res, 'Token and password required');
      const p = await verifyToken(setup_token);
      if (!p?.setup) return bad(res, 'Invalid or expired setup token', 401);
      if (password.length < 12) return bad(res, 'Password must be at least 12 characters.');
      const adv = await kvGet(`advisor:${p.advisor_id}`);
      if (!adv) return bad(res, 'Advisor not found', 404);
      adv.password_hash = await bcrypt.hash(password, 12);
      adv.requires_setup = false;
      await kvSet(`advisor:${adv.id}`, adv);
      const token = await signToken({ advisor_id: adv.id, email: adv.email, name: adv.name || '', firm: adv.firm_name, role: 'advisor' }, '7d');
      res.setHeader('Set-Cookie', setCookieHeader('prism_advisor', token, cookieOpts(604800)));
      return ok(res, { advisor: sanitizeAdvisor(adv) });
    }

    if (op === 'logout') {
      // Revoke the current token by writing its jti to the denylist (7d TTL — matches token lifetime)
      const t = getCookie(req, 'prism_advisor');
      if (t) {
        const p = await verifyToken(t);
        if (p?.jti) await kvSet('revoked:' + p.jti, '1', { ex: 604800 });
      }
      res.setHeader('Set-Cookie', setCookieHeader('prism_advisor', '', clearCookieOpts()));
      return ok(res);
    }

    if (op === 'me') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const full = await kvGet(`advisor:${adv.advisor_id}`);
      if (!full) return unauth(res);
      const deals = await listDeals({ advisor_id: adv.advisor_id });
      // Hydrate pushed_ioi from the latest package for each deal
      const enrichedDeals = await Promise.all(deals.map(async deal => {
        const pkgListKey = `packages:deal:${deal.id}`;
        const pkgList = await kvGet(pkgListKey);
        if (!pkgList || !pkgList.length) return deal;
        const latestPkgId = pkgList[pkgList.length - 1];
        const pkg = await kvGet(`package:${latestPkgId}`);
        if (!pkg) return deal;
        // Expose aggregate push stats only — no investor PII
        const pushed_ioi = {
          id: pkg.packageId,
          investor_type: pkg.iois?.[0]?.type || '',
          investor_region: pkg.iois?.[0]?.geo || '',
          amount: pkg.indicatedTotal || 0,
          date: pkg.generatedAt ? new Date(pkg.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          note: pkg.admin_comment || '',
          status: deal.pushed_ioi_status || 'pending',
          ioi_count: pkg.iois?.length || 0,
        };
        return { ...deal, pushed_ioi };
      }));
      return ok(res, { advisor: sanitizeAdvisor(full), deals: enrichedDeals });
    }

    // ── dashboard — single combined load for advisor portal ──────
    // Collapses 3 sequential round trips into 1 parallel fetch.
    // Returns: advisor profile, enriched deals list, and aggregate stats.
    if (op === 'dashboard') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);

      const [full, deals] = await Promise.all([
        kvGet(`advisor:${adv.advisor_id}`),
        listDeals({ advisor_id: adv.advisor_id }),
      ]);
      if (!full) return unauth(res);

      // Hydrate pushed_ioi from latest package for each deal (parallel)
      const enrichedDeals = await Promise.all(deals.map(async deal => {
        const pkgListKey = `packages:deal:${deal.id}`;
        const pkgList = await kvGet(pkgListKey);
        if (!pkgList || !pkgList.length) return deal;
        const latestPkgId = pkgList[pkgList.length - 1];
        const pkg = await kvGet(`package:${latestPkgId}`);
        if (!pkg) return deal;
        const pushed_ioi = {
          id: pkg.packageId,
          investor_type: pkg.iois?.[0]?.type || '',
          investor_region: pkg.iois?.[0]?.geo || '',
          amount: pkg.indicatedTotal || 0,
          date: pkg.generatedAt ? new Date(pkg.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          note: pkg.admin_comment || '',
          status: deal.pushed_ioi_status || 'pending',
          ioi_count: pkg.iois?.length || 0,
        };
        return { ...deal, pushed_ioi };
      }));

      // Aggregate stats — computed server-side so the client doesn't have to
      const totalDeals = enrichedDeals.length;
      const liveDeals = enrichedDeals.filter(d => d.stage === 'live' || d.stage === 'ioi' || d.stage === 'dd').length;
      const totalIois = enrichedDeals.reduce((s, d) => s + (d.ioi_count || 0), 0);
      const totalAum  = enrichedDeals.reduce((s, d) => s + (d.ioi_agg_usd || 0), 0);

      return ok(res, {
        advisor: sanitizeAdvisor(full),
        deals: enrichedDeals,
        stats: { totalDeals, liveDeals, totalIois, totalAum },
      });
    }

    if (op === 'deals') {
      // Advisor submits or updates their own deal
      const adv = await getAdvisor();
      const admin = await getAdmin();
      if (!adv && !admin) return unauth(res);

      if (req.method === 'POST') {
        const data = req.body || {};
        if (data.action === 'update') {
          const deal = await getDeal(data.id);
          if (!deal) return bad(res, 'Deal not found', 404);
          if (!admin && deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
          const result = await updateDeal(data.id, data, adv?.advisor_id || admin?.email);
          return ok(res, { deal: result.deal });
        }
        // Create new deal — surfaces missing-field errors as 400 with the list
        const advisorId = adv ? adv.advisor_id : null;
        let deal;
        try {
          deal = await createDeal(data, advisorId, admin ? admin.email : null);
        } catch (e) {
          if (e?.code === 'DEAL_VALIDATION') {
            return res.status(400).json({ ok: false, error: e.message, missing: e.missing });
          }
          throw e;
        }
        // Move any pre-uploaded docs from temp keys to deal_doc:{dealId}:{slot}
        if (advisorId) {
          const slots = ['nda', 'mgmt', 'fin', 'term'];
          for (const slot of slots) {
            const tmp = await kvGet(`pdoc:${advisorId}:${slot}`);
            if (tmp?.data) {
              await kvSet(`deal_doc:${deal.id}:${slot}`, tmp);
              await kvDel(`pdoc:${advisorId}:${slot}`);
              await kvDel(`pdoc_meta:${advisorId}:${slot}`);
            }
          }
        }
        // Get advisor object for email
        const advObj = adv ? await kvGet(`advisor:${adv.advisor_id}`) : null;
        if (advObj) await sendDealReceived(deal, advObj);
        // Async AI scoring — fire-and-forget, never blocks submission response
        scoreDeal(deal).then(async (score) => {
          try {
            const fresh = await getDeal(deal.id);
            if (fresh) {
              fresh.aiScore = score;
              fresh.aiScoredAt = new Date().toISOString();
              await saveDeal(fresh);
            }
          } catch (e) {
            console.error('[ai] Failed to persist deal score:', e?.message);
          }
        }).catch(() => {});
        return ok(res, { deal });
      }

      // GET: list advisor's deals
      const deals = adv ? await listDeals({ advisor_id: adv.advisor_id }) : await listDeals();
      return ok(res, { deals });
    }

    if (op === 'register') {
      // PUBLIC advisor self-signup. Status='pending'. Admin must approve.
      // Required fields below mirror what an institutional onboarding form
      // would ask: company profile + primary contact + regulatory posture.
      const ip = getClientIp(req);
      if (!(await shouldBypassRateLimit(req)) && await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      const data = req.body || {};
      const required = ['email','firm_name','name','title','phone','firm_website','jurisdiction','year_founded','regulatory_status','aum_managed','primary_asset_classes'];
      const missing = required.filter(k => {
        const v = data[k];
        if (k === 'primary_asset_classes') return !Array.isArray(v) || v.length === 0;
        return v == null || String(v).trim() === '';
      });
      if (missing.length) return bad(res, 'Missing required fields: ' + missing.join(', '), 400);
      const email = String(data.email).toLowerCase().trim();
      if (await kvGet(`advisor_email:${email}`)) return bad(res, 'Email already registered');
      const id = 'adv-' + Date.now().toString(36);
      const adv = {
        id, email,
        firm_name: String(data.firm_name).trim(),
        name: String(data.name).trim(),
        title: String(data.title).trim(),
        phone: String(data.phone).trim(),
        firm_website: String(data.firm_website).trim(),
        jurisdiction: String(data.jurisdiction).trim(),
        year_founded: parseInt(data.year_founded) || null,
        regulatory_status: String(data.regulatory_status).trim(),
        aum_managed: String(data.aum_managed).trim(),
        primary_asset_classes: Array.isArray(data.primary_asset_classes) ? data.primary_asset_classes : [],
        intro_fee_pct: 1,
        carry_pct: 10,
        status: 'pending',
        requires_setup: true,
        password_hash: null, // set on approval
        created_at: new Date().toISOString(),
      };
      await kvSet(`advisor:${id}`, adv);
      await kvSet(`advisor_email:${email}`, id);
      // Operator alert (suppressed in BOT_MODE) — reuses existing welcome trigger as notification stub
      await sendAdvisorWelcome(adv, '[pending operator approval]').catch(() => {});
      return ok(res, { advisor: sanitizeAdvisor(adv), message: 'Application submitted. Operator review within 5 business days.' });
    }

    if (op === 'create') {
      // Admin creates advisor account
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const data = req.body || {};
      if (!data.email || !data.firm_name || !data.name) return bad(res, 'Email, firm name, and contact name required');
      const email = data.email.toLowerCase().trim();
      const existing = await kvGet(`advisor_email:${email}`);
      if (existing) return bad(res, 'Email already registered');
      const id = 'adv-' + Date.now().toString(36);
      // Admin can pass an explicit password (skips temp-password + email flow)
      const adminPw = (data.password || '').toString();
      const usingAdminPw = adminPw.length > 0;
      const pwToHash = usingAdminPw ? adminPw : generateTempPassword();
      const adv = {
        id, email, firm_name: data.firm_name.trim(), name: data.name.trim(),
        intro_fee_pct: parseFloat(data.intro_fee_pct) || 1,
        carry_pct: parseFloat(data.carry_pct) || 0,
        status: 'active',
        requires_setup: !usingAdminPw,
        password_hash: await bcrypt.hash(pwToHash, 12),
        created_at: new Date().toISOString(),
      };
      await kvSet(`advisor:${id}`, adv);
      await kvSet(`advisor_email:${email}`, id);
      if (!usingAdminPw) await sendAdvisorWelcome(adv, pwToHash);
      return ok(res, { advisor: sanitizeAdvisor(adv) });
    }

    if (op === 'forgot-password') {
      const ip = getClientIp(req);
      if (!(await shouldBypassRateLimit(req)) && await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      const { email } = req.body || {};
      if (!email) return bad(res, 'Email required');
      const stored = await kvGet(`advisor_email:${email.toLowerCase()}`);
      // Always return ok to prevent enumeration
      if (stored) {
        const { code, token } = await signResetCode(email.toLowerCase());
        await kvSet(`reset_token:advisor:${email.toLowerCase()}`, token, { ex: 1800 });
        await sendPasswordReset(email, code);
      }
      return ok(res, { message: 'If this email is registered, a reset code has been sent.' });
    }

    if (op === 'reset-password') {
      const { email, code, password } = req.body || {};
      if (!email || !code || !password) return bad(res, 'Email, code, and password required');
      if (password.length < 12) return bad(res, 'Password must be at least 12 characters.');
      const storedToken = await kvGet(`reset_token:advisor:${email.toLowerCase()}`);
      if (!storedToken) return bad(res, 'Reset code invalid or expired', 400);
      const p = await verifyResetToken(storedToken);
      if (!p || p.code !== code) return bad(res, 'Invalid reset code', 400);
      const advisorId = await kvGet(`advisor_email:${email.toLowerCase()}`);
      if (!advisorId) return bad(res, 'Account not found', 404);
      const adv = await kvGet(`advisor:${advisorId}`);
      if (!adv) return bad(res, 'Account not found', 404);
      adv.password_hash = await bcrypt.hash(password, 12);
      adv.requires_setup = false;
      await kvSet(`advisor:${adv.id}`, adv);
      await kvDel(`reset_token:advisor:${email.toLowerCase()}`);
      return ok(res, { message: 'Password updated. You can now log in.' });
    }

    // ── VDR: upload files (DD Dataroom) ──────────────────────────
    // Contract: POST { dealId, files: [{name, size, contentBase64, mimeType}] }
    // KV keys:
    //   vdr:{dealId}:files            — JSON array of metadata (no content)
    //   vdr:{dealId}:file:{fileId}    — full record incl. base64 content
    // Stage gating: deal.stage must be 'dd' (or 'terms' so DD content stays accessible).
    // Limits: 4MB per single file, 8MB total per request (Vercel function payload cap).
    if (op === 'vdr-upload') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, files } = req.body || {};
      if (!dealId || !Array.isArray(files) || files.length === 0) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      if (deal.stage !== 'dd' && deal.stage !== 'terms') return bad(res, 'stage_not_dd', 403);

      const MAX_FILE = 4 * 1024 * 1024;
      const MAX_TOTAL = 8 * 1024 * 1024;
      let totalSize = 0;
      for (const file of files) {
        if (!file || !file.name || !file.contentBase64) return bad(res, 'bad_request');
        // base64 size ≈ ceil(rawBytes * 4 / 3); approximate via string length
        const approxBytes = Math.floor(String(file.contentBase64).length * 3 / 4);
        const declaredSize = Number(file.size) || approxBytes;
        if (declaredSize > MAX_FILE || approxBytes > MAX_FILE) {
          return res.status(413).json({ error: 'file_too_large', maxBytes: MAX_FILE });
        }
        totalSize += approxBytes;
      }
      if (totalSize > MAX_TOTAL) {
        return res.status(413).json({ error: 'payload_too_large', maxBytes: MAX_TOTAL });
      }

      // Merge with existing metadata. Prefer the new key; fall back to legacy index.
      const existingMeta = (await kvGet(`vdr:${dealId}:files`)) || (await kvGet(`vdr:${dealId}:index`)) || [];
      const now = new Date().toISOString();
      const uploaderId = adv.advisor_id;

      const created = [];
      for (const file of files) {
        const fileId = nanoid(10);
        const mimeType = file.mimeType || file.type || 'application/octet-stream';
        const approxBytes = Math.floor(String(file.contentBase64).length * 3 / 4);
        const size = Number(file.size) || approxBytes;
        const meta = {
          fileId,
          // legacy alias 'id' kept so existing readers (frontend cards) still resolve
          id: fileId,
          name: String(file.name).slice(0, 256),
          size,
          mimeType,
          // legacy alias 'type' kept for older code paths
          type: mimeType,
          folder: file.folder ? String(file.folder).slice(0, 64) : '',
          uploadedAt: now,
          uploadedBy: uploaderId,
          storageType: 'redis',
        };

        // TODO: route to blobStore.put() when BLOB_READ_WRITE_TOKEN is set
        await kvSet(`vdr:${dealId}:file:${fileId}`, {
          name: meta.name,
          size: meta.size,
          mimeType,
          contentBase64: file.contentBase64,
          uploadedAt: now,
          uploadedBy: uploaderId,
        });

        existingMeta.push(meta);
        created.push({ fileId, name: meta.name, size: meta.size, mimeType, uploadedAt: now });
      }

      await kvSet(`vdr:${dealId}:files`, existingMeta);
      // Mirror to legacy index key so any unmigrated reader still works
      await kvSet(`vdr:${dealId}:index`, existingMeta);

      // Append audit entries (deal embedded log + immutable sorted set)
      deal.audit_log = deal.audit_log || [];
      const auditEntry = { at: now, actor: uploaderId, action: 'vdr_upload', meta: { count: created.length } };
      deal.audit_log.push(auditEntry);
      deal.updated_at = now;
      await saveDeal(deal);
      await appendAuditEntry(dealId, auditEntry);

      return ok(res, { files: created });
    }

    // ── VDR: list files (advisor view) ───────────────────────────
    // Returns contract shape: { files, dd_deadline, dd_active }
    // Auth: advisor (must own deal) or admin (any deal).
    if (op === 'vdr-files') {
      const adv = await getAdvisor();
      const admin = adv ? null : await getAdmin();
      if (!adv && !admin) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (adv && deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const files = (await kvGet(`vdr:${dealId}:files`)) || (await kvGet(`vdr:${dealId}:index`)) || [];
      const { dd_deadline, dd_active } = ddInfo(deal);
      return ok(res, { files, dd_deadline, dd_active });
    }

    // ── VDR: download single file (advisor view) ─────────────────
    // Advisor reviewing their own dataroom contents.
    if (op === 'vdr-file') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, fileId } = req.query;
      if (!dealId || !fileId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const raw = await kvGet(`vdr:${dealId}:file:${fileId}`);
      if (!raw) return bad(res, 'File not found', 404);
      // raw may be the new object form OR (legacy) a base64 string / blob URL
      if (typeof raw === 'string') {
        const index = (await kvGet(`vdr:${dealId}:files`)) || (await kvGet(`vdr:${dealId}:index`)) || [];
        const m = index.find(f => f.fileId === fileId || f.id === fileId) || {};
        return ok(res, { file: { name: m.name || 'file', mimeType: m.mimeType || m.type || 'application/octet-stream', contentBase64: raw, size: m.size || 0 } });
      }
      return ok(res, { file: { name: raw.name, mimeType: raw.mimeType, contentBase64: raw.contentBase64, size: raw.size } });
    }

    // ── VDR: delete file ─────────────────────────────────────────
    if (op === 'vdr-delete') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { deal_id, file_id } = req.body || {};
      if (!deal_id || !file_id) return bad(res, 'deal_id and file_id required');
      const deal = await getDeal(deal_id);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      // Remove from index and delete file data
      const index = (await kvGet(`vdr:${deal_id}:index`)) || [];
      const updated = index.filter(f => f.id !== file_id);
      await kvSet(`vdr:${deal_id}:index`, updated);
      await kvDel(`vdr:${deal_id}:file:${file_id}`);
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: new Date().toISOString(), actor: adv.advisor_id, action: 'vdr_delete', meta: { file_id } });
      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
      return ok(res, { ok: true });
    }

    // ── Q&A: full thread (advisor view) ─────────────────────────
    // KV key: qa:{dealId} — JSON array of Q&A entries
    // Both 'qa-thread-advisor' (legacy) and 'qa-thread' (contract) are accepted.
    if (op === 'qa-thread-advisor' || op === 'qa-thread') {
      const adv = await getAdvisor();
      const admin = adv ? null : await getAdmin();
      if (!adv && !admin) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (adv && deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const qa = (await kvGet(`qa:${dealId}`)) || [];
      const { dd_deadline, dd_active } = ddInfo(deal);
      // Advisor + admin see real investor identity (asked_by_name) — no masking.
      return ok(res, { qa, threads: qa, dd_deadline, dd_active });
    }

    // ── Q&A: answer a question ───────────────────────────────────
    if (op === 'answer-qa') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const body = req.body || {};
      const { dealId, broadcast, message } = body;
      // Contract: { dealId, threadId, answer }. Backward-compat: qaId.
      const threadId = body.threadId || body.qaId;
      const answer = body.answer;
      if (!dealId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const advObj = await kvGet(`advisor:${adv.advisor_id}`);
      const senderName = advObj?.name || advObj?.firm_name || adv.advisor_id;
      const qa = (await kvGet(`qa:${dealId}`)) || [];
      const now = new Date().toISOString();

      // Broadcast / opening statement path
      if (broadcast && message) {
        const broadcastEntry = {
          id: 'qa-bc-' + Date.now().toString(36),
          type: 'advisor_open',
          message: sanitizeText(message, 2000),
          sentBy: senderName,
          sentAt: now,
          broadcast: true,
        };
        qa.push(broadcastEntry);
        await kvSet(`qa:${dealId}`, qa);
        return ok(res, { ok: true });
      }

      // Standard Q&A reply path
      if (!threadId || !answer) return bad(res, 'bad_request');
      const cleanAnswer = sanitizeText(answer, 2000);
      if (!cleanAnswer) return bad(res, 'bad_request');
      const entry = qa.find(q => q.id === threadId);
      if (!entry) return bad(res, 'invalid_thread', 404);
      if (entry.answer) return bad(res, 'invalid_thread', 409);
      entry.answer = cleanAnswer;
      entry.answered_at = now;
      // Backward-compat field
      entry.answeredAt = now;
      entry.answeredBy = senderName;
      await kvSet(`qa:${dealId}`, qa);
      // Delete the pending reminder key — question is answered
      await kvDel(`qa_pending:${dealId}:${threadId}`);

      // Audit log
      const auditEntry = { at: now, actor: adv.advisor_id, action: 'qa_answered', meta: { threadId } };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(auditEntry);
      deal.updated_at = now;
      await saveDeal(deal);
      await appendAuditEntry(dealId, auditEntry);

      // Email the investor who asked
      if (entry.investor_id && entry.investor_id.startsWith('inv-')) {
        const qaInvestor = await kvGet(`inst:${entry.investor_id}`);
        if (qaInvestor) await sendQaAnswerToInvestor(qaInvestor, deal, threadId).catch(console.error);
      }
      return ok(res, { ok: true });
    }

    // ── Advisor earnings — Earnings tab data ──────────────────────
    // GET ?resource=advisor&op=earnings
    // Returns { intro: [...], carry: [...], payments: [...] }
    //   intro: per-deal intro fee record (always present for active deals)
    //   carry: per-deal projected carry (meaningful for close/realized)
    //   payments: actual disbursed payments — empty until payment system wired
    if (op === 'earnings') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const advisorObj = await kvGet(`advisor:${adv.advisor_id}`);
      const introPct = parseFloat(advisorObj?.intro_fee_pct ?? 1);
      const carryPct = parseFloat(advisorObj?.carry_pct ?? 0);
      const myDeals = await listDeals({ advisor_id: adv.advisor_id });
      const intro = myDeals.map(d => {
        const dealSize = d.target_alloc_usd || 0;
        return {
          deal_id: d.id,
          deal_name: d.name,
          stage: d.stage,
          intro_fee_pct: introPct,
          deal_size: dealSize,
          intro_fee_est: Math.round(dealSize * introPct / 100),
        };
      });
      const carry = myDeals
        .filter(d => ['close', 'realized'].includes(d.stage))
        .map(d => {
          // Carry on realized gain — modeled as deployed_usd above target.
          const deployed = d.deployed_usd || 0;
          const target = d.target_alloc_usd || 0;
          const carryGain = Math.max(0, deployed - target);
          return {
            deal_id: d.id,
            deal_name: d.name,
            stage: d.stage,
            carry_pct: carryPct,
            carry_gain: carryGain,
            carry_est: Math.round(carryGain * carryPct / 100),
          };
        });
      // Payments: per-advisor disbursement records. Stored under
      // payment:{advisor_id}:{paymentId} when a real payment system writes them.
      // Empty by default — no payment integration yet.
      const paymentKeys = await kvKeys(`payment:${adv.advisor_id}:*`);
      const payments = (await Promise.all(paymentKeys.map(k => kvGet(k)))).filter(Boolean);
      return ok(res, { intro, carry, payments });
    }

    // ── Advisor notifications ─────────────────────────────────────
    // GET  ?resource=advisor&op=notifications          — all unread notifications across advisor's deals
    // POST ?resource=advisor&op=notifications  { action:'mark-read', ids:[...] | 'all', dealId? }
    if (op === 'notifications') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);

      const deals = await listDeals({ advisor_id: adv.advisor_id });

      if (req.method === 'POST') {
        const { action, ids, dealId } = req.body || {};
        if (action !== 'mark-read') return bad(res, 'action must be mark-read');
        const targetDeals = dealId ? deals.filter(d => d.id === dealId) : deals;
        for (const deal of targetDeals) {
          if (!deal.notifications?.length) continue;
          let dirty = false;
          for (const n of deal.notifications) {
            if (n.read) continue;
            if (ids === 'all' || (Array.isArray(ids) && ids.includes(n.id))) {
              n.read = true;
              dirty = true;
            }
          }
          if (dirty) {
            deal.updated_at = new Date().toISOString();
            await saveDeal(deal);
          }
        }
        return ok(res, { ok: true });
      }

      // GET — collect all unread (and recent read) notifications, newest first
      const notifications = [];
      for (const deal of deals) {
        for (const n of (deal.notifications || [])) {
          notifications.push({ ...n, deal_id: deal.id, deal_name: deal.name });
        }
      }
      // Sort newest first
      notifications.sort((a, b) => {
        const ta = a.pushed_at || a.advanced_at || '';
        const tb = b.pushed_at || b.advanced_at || '';
        return tb.localeCompare(ta);
      });
      const unread = notifications.filter(n => !n.read);
      return ok(res, { notifications, unread_count: unread.length });
    }

    // ── IOI package response (advisor accepts or declines pushed package) ──
    // Accepts either `decision` (legacy) or `response` (Wave 3 contract). Same semantics.
    if (op === 'respond-package') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const body = req.body || {};
      const dealId = body.dealId;
      const packageId = body.packageId;
      const decision = body.decision || body.response;
      const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : '';
      if (!packageId || !['accepted', 'declined'].includes(decision)) {
        return bad(res, 'packageId and decision/response (accepted|declined) required');
      }
      const pkg = await kvGet(`package:${packageId}`);
      if (!pkg) return bad(res, 'Package not found', 404);
      const resolvedDealId = dealId || pkg.dealId;
      if (!resolvedDealId) return bad(res, 'dealId required');
      const deal = await getDeal(resolvedDealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      // Idempotency: if already responded, return early
      if (pkg.advisor_decision && ['accepted','declined'].includes(pkg.advisor_decision)) {
        return bad(res, 'already_responded', 409);
      }
      // Persist decision on both the package and deal
      pkg.advisor_decision = decision;
      pkg.advisor_decision_at = new Date().toISOString();
      pkg.advisor_decision_note = note || '';
      await kvSet(`package:${packageId}`, pkg);
      deal.pushed_ioi_status = decision;
      if (decision === 'accepted') {
        deal.stage = 'dd';
      }
      const pkgAuditEntry = { at: new Date().toISOString(), actor: adv.advisor_id, action: `package_${decision}`, meta: { packageId, advisor_id: adv.advisor_id, note: note || undefined } };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(pkgAuditEntry);
      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
      await appendAuditEntry(resolvedDealId, pkgAuditEntry);
      // P-6: package response does not change IOI count or aggregate — only
      // flips a per-deal pushed_ioi_status and may advance stage to dd.
      // No counter bump required. (Was previously a defensive recalc.)
      try {
        await kvDel('cache:iois:all');
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}
      // Notify investors in the package that data room access is confirmed
      if (decision === 'accepted' && pkg.iois?.length) {
        for (const pkgIoi of pkg.iois) {
          const ioiRecord = await kvGet(`ioi:${pkgIoi.id}`);
          if (ioiRecord?.investor_id?.startsWith('inv-')) {
            const pkgInst = await kvGet(`inst:${ioiRecord.investor_id}`);
            if (pkgInst) await sendDataRoomPackageResponse(pkgInst, deal).catch(console.error);
          }
        }
      }
      // Operator alert — minimal, no PII beyond firm name + deal name
      try {
        const notifyList = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
        if (notifyList.length && process.env.RESEND_API_KEY && process.env.BOT_MODE !== '1') {
          const advFull = await kvGet(`advisor:${adv.advisor_id}`);
          const subject = `Aurum Prism — package ${decision}: ${deal.name}`;
          const html = `<p><strong>${advFull?.firm_name || advFull?.name || adv.advisor_id}</strong> ${decision} the IOI package for <strong>${deal.name}</strong>.</p>${note ? `<blockquote>${note.replace(/[<>]/g,'')}</blockquote>` : ''}<p><a href="${process.env.SITE_URL || ''}/admin-portal">Open control panel</a></p>`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
            body: JSON.stringify({ from: 'Aurum Prism <prism@theaurumcc.com>', to: notifyList, subject, html }),
          }).catch(() => {});
        }
      } catch {}
      return ok(res, { ok: true, decision, stage: deal.stage });
    }

    // ── Banking details: save (advisor only, own record) ───────────
    if (op === 'save-banking') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const body = req.body || {};
      const fields = ['bank_name','account_holder','account_number','swift_code','iban','address','currency','notes'];
      const clean = {};
      for (const f of fields) {
        if (body[f] != null) {
          const v = String(body[f]);
          if (v.length > 200) return bad(res, `${f} exceeds 200 chars`);
          clean[f] = v.trim();
        }
      }
      if (!clean.account_number || !clean.swift_code) {
        return bad(res, 'account_number and swift_code required');
      }
      const updated_at = new Date().toISOString();
      const record = { ...clean, updated_at, updated_by: adv.advisor_id };
      await kvSet(`advisor_banking:${adv.advisor_id}`, record);
      // Audit — never persist account numbers in audit payload
      await kvZadd(`audit:advisor:${adv.advisor_id}`, Date.now(), JSON.stringify({
        at: updated_at, actor: adv.advisor_id, action: 'banking_updated', meta: { updated_at, updated_by: adv.advisor_id },
      }));
      return ok(res, { ok: true, updated_at });
    }

    // ── Banking details: get (advisor only, own record, masked) ────
    if (op === 'get-banking') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const rec = await kvGet(`advisor_banking:${adv.advisor_id}`);
      if (!rec) return ok(res, { banking: null });
      const acct = rec.account_number || '';
      const masked = acct.length > 8
        ? acct.slice(0, 4) + '••••' + acct.slice(-4)
        : (acct.length > 0 ? '••••' + acct.slice(-Math.min(4, acct.length)) : '');
      return ok(res, {
        banking: {
          bank_name: rec.bank_name || '',
          account_holder: rec.account_holder || '',
          account_number: masked,
          swift_code: rec.swift_code || '',
          iban: rec.iban || '',
          address: rec.address || '',
          currency: rec.currency || '',
          notes: rec.notes || '',
          updated_at: rec.updated_at || null,
        },
      });
    }

    // ── Pushed packages list (advisor only, own deals) ─────────────
    if (op === 'packages') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const advDeals = await listDeals({ advisor_id: adv.advisor_id });
      const out = [];
      for (const d of advDeals) {
        const pkgList = await kvGet(`packages:deal:${d.id}`);
        if (!pkgList || !pkgList.length) continue;
        for (const pid of pkgList) {
          const p = await kvGet(`package:${pid}`);
          if (!p) continue;
          out.push({
            packageId: p.packageId,
            dealId: d.id,
            dealName: d.name,
            dealStage: d.stage,
            amount_usd: p.indicatedTotal || 0,
            target_alloc_usd: p.targetAlloc || 0,
            approved_count: p.iois?.length || 0,
            admin_comment: p.admin_comment || '',
            created_at: p.generatedAt || null,
            response: p.advisor_decision || (d.pushed_ioi_status === 'accepted' || d.pushed_ioi_status === 'declined' ? d.pushed_ioi_status : null),
            response_at: p.advisor_decision_at || null,
            response_note: p.advisor_decision_note || '',
          });
        }
      }
      out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return ok(res, { packages: out });
    }

    // ── Real activity feed (advisor only, scoped to their deals) ───
    if (op === 'activity') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const advDeals = await listDeals({ advisor_id: adv.advisor_id });
      const dealIndex = new Map(advDeals.map(d => [d.id, d]));
      // Pull last 100 audit entries per deal (ascending), then merge + sort desc
      const merged = [];
      await Promise.all(advDeals.map(async d => {
        const rawEntries = await kvZrange(`audit:${d.id}`, 0, -1, { rev: false });
        for (const raw of rawEntries) {
          let entry;
          try { entry = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
          merged.push({ ...entry, deal_id: d.id });
        }
      }));
      // Sort desc by `at`
      merged.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
      const top = merged.slice(0, 50);
      const KIND_LABELS = (kind, meta = {}) => {
        switch (kind) {
          case 'created':
          case 'deal_created': return 'Deal submitted';
          case 'stage_changed':
          case 'stage_advanced': return meta.to ? `Advanced to ${meta.to}` : 'Stage advanced';
          case 'ioi_received': return meta.amount ? `IOI received: $${Number(meta.amount).toLocaleString()}` : 'IOI received';
          case 'ioi_approved': return 'IOI approved';
          case 'ioi_rejected':
          case 'ioi_declined': return 'IOI declined';
          case 'vdr_upload': return meta.count ? `Files uploaded (${meta.count})` : 'Files uploaded';
          case 'vdr_view': return 'Investor viewed file';
          case 'qa_question_submitted':
          case 'qa_question': return 'New Q&A question';
          case 'qa_answered': return 'Q&A answered';
          case 'package_accepted': return 'Package accepted';
          case 'package_declined': return 'Package declined';
          case 'package_pushed': return 'Package pushed';
          case 'banking_updated': return 'Banking details updated';
          case 'published':
          case 'auto_published_on_approval': return 'Published to register';
          case 'nav_update': return 'NAV updated';
          default: return String(kind || '').replace(/_/g, ' ').toLowerCase();
        }
      };
      const ROLE_OF = (actor) => {
        if (!actor) return 'system';
        const a = String(actor).toLowerCase();
        if (a.startsWith('adv-') || a.includes('advisor')) return 'advisor';
        if (a.startsWith('inv-') || a.includes('investor')) return 'investor';
        if (a.includes('@') || a === 'admin' || a === 'system') return a === 'system' ? 'system' : 'admin';
        return 'system';
      };
      const entries = top.map(e => {
        const d = dealIndex.get(e.deal_id);
        const kind = e.action || e.kind || '';
        return {
          at: e.at || null,
          kind,
          deal_id: e.deal_id,
          deal_name: d?.name || '',
          actor_role: ROLE_OF(e.actor),
          payload_summary: KIND_LABELS(kind, e.meta || {}),
        };
      });
      return ok(res, { entries });
    }

    // ── advisor-confirm-deal ──────────────────────────────────────
    if (op === 'advisor-confirm-deal') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, edits } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      // Ownership check — advisors can only confirm their own deals
      if (deal.advisor_id !== adv.advisor_id) return res.status(403).json({ error: 'Not your deal' });

      if (edits) {
        if (edits.name) deal.name = edits.name;
        if (edits.target_irr != null) deal.target_irr = edits.target_irr;
        if (edits.target_alloc_usd != null) deal.target_alloc_usd = edits.target_alloc_usd;
        if (edits.min_ticket_usd != null) deal.min_ticket_usd = edits.min_ticket_usd;
        if (edits.term_months != null) deal.term_months = edits.term_months;
        if (edits.closing_date) deal.closing_date = edits.closing_date;
        if (edits.geography) deal.geography = edits.geography;
        if (edits.structure) deal.structure = edits.structure;
        if (edits.thesis) deal.thesis = edits.thesis;
        if (edits.highlights) deal.highlights = edits.highlights;
      }

      deal.advisor_review_status = 'approved';
      deal.advisor_confirmed_at = new Date().toISOString();
      const nowIso = new Date().toISOString();
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: nowIso, actor: adv.email, action: 'advisor_confirmed_deal', meta: { edits: Object.keys(edits || {}) } });

      deal.notifications = deal.notifications || [];
      deal.notifications.push({
        id: `notif_${Date.now()}`,
        type: 'advisor_confirmed_deal',
        deal_name: deal.name,
        advisor_name: adv.name || adv.email,
        confirmed_at: nowIso,
        read: false,
      });

      // ── AUTO-PUBLISH on advisor approval ──────────────────────────
      // Advisor's confirmation IS the gate. No separate admin publish step.
      // Validate required investor-portal fields, transition stage to live,
      // mark visible in marketplace, append audit entry, bust cache.
      let autoPublished = false;
      let publishMissing = [];
      if (deal.stage === 'review') {
        publishMissing = validateDealForPublish(deal);
        if (publishMissing.length === 0) {
          deal.stage = 'live';
          deal.member_visible = true;
          deal.published_at = nowIso;
          deal.published_by = `auto:advisor-confirm:${adv.advisor_id}`;
          deal.audit_log.push({ at: nowIso, actor: adv.email, action: 'stage_changed', meta: { from: 'review', to: 'live', auto: true, trigger: 'advisor_approval' } });
          autoPublished = true;
        }
      }

      deal.updated_at = nowIso;
      await saveDeal(deal);
      if (autoPublished) {
        await appendAuditEntry(dealId, { at: nowIso, actor: adv.email, action: 'auto_published_on_approval', meta: { from: 'review', to: 'live' } });
        try { await kvDel('cache:marketplace:public'); await kvDel('cache:marketplace:admin'); } catch {}
      }
      return ok(res, { ok: true, deal, autoPublished, publishMissing });
    }

    // ── post-nav-update ───────────────────────────────────────────
    // POST resource=advisor&op=post-nav-update
    // Body: { dealId, navPerUnit, totalNavUsd, asOfDate, notes }
    if (op === 'post-nav-update') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, navPerUnit, totalNavUsd, asOfDate, notes } = req.body || {};
      if (!dealId || navPerUnit == null || totalNavUsd == null || !asOfDate) {
        return bad(res, 'dealId, navPerUnit, totalNavUsd, and asOfDate required');
      }
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);

      const navEntry = {
        navPerUnit: parseFloat(navPerUnit),
        totalNavUsd: parseFloat(totalNavUsd),
        asOfDate,
        notes: notes || '',
        postedAt: new Date().toISOString(),
        postedBy: adv.advisor_id,
      };

      deal.navHistory = deal.navHistory || [];
      deal.navHistory.push(navEntry);
      deal.currentNav = navEntry.navPerUnit;
      deal.totalNavUsd = navEntry.totalNavUsd;
      deal.navAsOf = asOfDate;

      const auditEntry = {
        at: new Date().toISOString(),
        actor: adv.advisor_id,
        action: 'nav_updated',
        meta: { navPerUnit: navEntry.navPerUnit, totalNavUsd: navEntry.totalNavUsd, asOfDate },
      };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(auditEntry);
      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
      await appendAuditEntry(dealId, auditEntry);

      // Email all approved IOI holders
      const navAllIois = await getAllIois();
      const navApprovedIois = navAllIois.filter(i => i.deal_id === dealId && i.status === 'approved' && i.investor_id.startsWith('inv-'));
      const navEmailData = { dealName: deal.name, navPerUnit: navEntry.navPerUnit, totalNavUsd: navEntry.totalNavUsd, asOfDate };
      for (const ioi of navApprovedIois) {
        const inv = await kvGet(`inst:${ioi.investor_id}`);
        if (inv) await sendNavUpdate(inv, navEmailData).catch(console.error);
      }

      return ok(res, { ok: true, navEntry, notified: navApprovedIois.length });
    }

    // ── post-distribution ─────────────────────────────────────────
    // POST resource=advisor&op=post-distribution
    // Body: { dealId, totalDistributionUsd, distributionType, distributionDate, notes }
    if (op === 'post-distribution') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, totalDistributionUsd, distributionType, distributionDate, notes } = req.body || {};
      if (!dealId || totalDistributionUsd == null || !distributionType || !distributionDate) {
        return bad(res, 'dealId, totalDistributionUsd, distributionType, and distributionDate required');
      }
      const validTypes = ['income', 'capital', 'return_of_capital'];
      if (!validTypes.includes(distributionType)) return bad(res, 'distributionType must be income, capital, or return_of_capital');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);

      const totalCommitment = deal.totalCommitment || deal.ioi_agg_usd || 0;
      const distributionId = 'dist-' + Date.now().toString(36);
      const now = new Date().toISOString();

      // Fetch approved IOIs to calculate per-investor shares
      const distAllIois = await getAllIois();
      const distApprovedIois = distAllIois.filter(i => i.deal_id === dealId && i.status === 'approved' && i.investor_id.startsWith('inv-'));

      const perInvestorAmounts = distApprovedIois.map(ioi => {
        const share = totalCommitment > 0 ? ((ioi.amount || 0) / totalCommitment) * parseFloat(totalDistributionUsd) : 0;
        return { investorId: ioi.investor_id, ioiId: ioi.id, committedAmount: ioi.amount || 0, distributionAmount: Math.round(share * 100) / 100 };
      });

      const distRecord = {
        distributionId,
        dealId,
        totalDistributionUsd: parseFloat(totalDistributionUsd),
        distributionType,
        distributionDate,
        notes: notes || '',
        postedAt: now,
        postedBy: adv.advisor_id,
        totalCommitment,
        perInvestorAmounts,
      };

      await kvSet(`distribution:${dealId}:${distributionId}`, distRecord);

      deal.distributionHistory = deal.distributionHistory || [];
      deal.distributionHistory.push({
        distributionId,
        totalDistributionUsd: distRecord.totalDistributionUsd,
        distributionType,
        distributionDate,
        postedAt: now,
        recipientCount: perInvestorAmounts.length,
      });

      const distAuditEntry = {
        at: now,
        actor: adv.advisor_id,
        action: 'distribution_posted',
        meta: { distributionId, totalDistributionUsd: distRecord.totalDistributionUsd, distributionType, distributionDate },
      };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(distAuditEntry);
      deal.updated_at = now;
      await saveDeal(deal);
      await appendAuditEntry(dealId, distAuditEntry);

      // Email each investor their individual amount
      for (const entry of perInvestorAmounts) {
        const inv = await kvGet(`inst:${entry.investorId}`);
        if (inv) {
          await sendDistributionNoticeWithAmount(inv, {
            dealName: deal.name,
            distributionType,
            investorAmount: entry.distributionAmount,
            distributionDate,
          }).catch(console.error);
        }
      }

      return ok(res, { ok: true, distributionId, notified: perInvestorAmounts.length });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ADVISORS LIST (admin only)
  // ─────────────────────────────────────────────────────────────
  if (resource === 'advisors') {
    const admin = await getAdmin();
    if (!admin) return unauth(res);
    const keys = await kvKeys('advisor:adv-*');
    const advisors = (await Promise.all(keys.map(k => kvGet(k)))).filter(Boolean).map(sanitizeAdvisor);
    return ok(res, { advisors });
  }

  // ─────────────────────────────────────────────────────────────
  // DEALS RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'deals') {
    if (op === 'marketplace') {
      // Public (authenticated) marketplace endpoint
      const auth = await getAnyAuth();
      if (!auth) return unauth(res);
      const admin = await getAdmin();
      // 5s cache on the live-deals fan-out (~500 ops per call). InvestorBot hits
      // this every tick. Cache key separates admin (sees all) from non-admin views.
      const cacheKey = admin ? 'cache:marketplace:admin' : 'cache:marketplace:public';
      try {
        const cached = await kvGet(cacheKey);
        if (cached && Array.isArray(cached.deals)) return ok(res, cached);
      } catch {}
      const deals = await listDeals({ live: true });
      // Strip internal fields for non-admin; also exclude preview deals from investor view
      const visibleDeals = admin
        ? deals
        : deals.filter(d => d.member_visible && d.stage === 'live' && d.launch_mode !== 'preview');
      const safe = admin
        ? visibleDeals
        : visibleDeals.map(d => { const { advisor_id, audit_log, ...rest } = d; return rest; });
      const payload = { deals: safe };
      try { await kvSet(cacheKey, payload, { ex: 5 }); } catch {}
      return ok(res, payload);
    }

    if (op === 'tacc-feed') {
      // TACC integration endpoint — HMAC-signed read-only
      const bridgeSecret = process.env.PRISM_TACC_BRIDGE_SECRET;
      if (!bridgeSecret) return res.status(503).json({ error: 'Feed not configured' });
      const sig = req.headers['x-tacc-signature'];
      if (sig !== bridgeSecret) return unauth(res, 'Invalid bridge signature');
      const deals = await listDeals({ live: true });
      const feed = deals.map(d => ({
        id: d.id, name: d.name, asset_class: d.asset_class,
        geography: d.geography, target_irr: d.target_irr,
        term_months: d.term_months, target_alloc_usd: d.target_alloc_usd,
        ioi_count: d.ioi_count, ioi_agg_usd: d.ioi_agg_usd,
        stage: d.stage, mk_notes: d.mk_notes,
        tagline: d.tagline || '', thesis: d.thesis || '',
        highlights: d.highlights || [], stats: d.stats || {},
        launch_mode: d.launch_mode || 'listed', featured: d.featured || false,
        target_segments: d.target_segments || [],
        open_date: d.open_date || null,
        min_ticket_usd: d.min_ticket_usd, closing_date: d.closing_date,
        prism_url: `https://prism.theaurumcc.com/marketplace`,
      }));
      return ok(res, { source: 'prism', deals: feed, generated_at: new Date().toISOString() });
    }

    if (op === 'seed') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      await seedAdvisors();
      await seedInvestors();
      const dealIds = await seedDeals(true); // force=true so re-seeding updates existing records
      await seedIois(true);
      return ok(res, { seeded: true, dealIds });
    }

    // Admin: list all deals
    const admin = await getAdmin();
    if (!admin) return unauth(res);

    if (req.method === 'POST') {
      const data = req.body || {};
      if (data.action === 'update') {
        const { id, ...updates } = data;
        const prev = await getDeal(id);
        if (!prev) return bad(res, 'Deal not found', 404);
        const result = await updateDeal(id, updates, admin.email);
        // Stage change email + in-app notification
        if (result.stage_changed) {
          const advId = result.deal.advisor_id;
          if (advId && advId.startsWith('adv-')) {
            const adv = await kvGet(`advisor:${advId}`);
            if (adv) await sendStageChange(result.deal, adv, result.new_stage).catch(console.error);
          }
          // Append stage-change notification to deal record
          const refreshed = await getDeal(id);
          if (refreshed) {
            refreshed.notifications = refreshed.notifications || [];
            refreshed.notifications.push({
              id: `notif_${Date.now()}`,
              type: 'stage_change',
              from_stage: prev.stage,
              to_stage: result.new_stage,
              advanced_at: new Date().toISOString(),
              read: false,
            });
            await saveDeal(refreshed);
          }
        }
        return ok(res, { deal: result.deal });
      }
      // Admin creates deal directly
      const deal = await createDeal(data, null, admin.email);
      return ok(res, { deal });
    }

    const deals = await listDeals();
    return ok(res, { deals });
  }

  // ─────────────────────────────────────────────────────────────
  // INSTITUTION / INVESTOR RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'inst') {

    if (op === 'register') {
      // Investor self-signup. Same gating philosophy as advisor register and
      // deal submission: every field on the form is required. Admin approval
      // re-validates so an incomplete record can never be activated.
      // Review HIGH #3: rate-limit added — public unauthenticated endpoint
      // that writes to KV and fires email; without the limit a script could
      // flood pending records and queue. Same limit as advisor/register.
      const ip = getClientIp(req);
      if (!(await shouldBypassRateLimit(req)) && await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      const data = req.body || {};
      const rawCategory = data.category != null ? String(data.category).toLowerCase().trim() : '';

      // ── Advisor application branch ───────────────────────────
      // Routed to a separate KV bucket (advisor_application:*) so the
      // operator can review them as a distinct queue without polluting
      // the institutional investor pipeline.
      if (rawCategory === 'advisor') {
        // Accept either advisor-native field names (name, firm) or the
        // shared landing-form field names (contact_name, firm_name).
        const advName = (data.name || data.contact_name || '').toString().trim();
        const advFirm = (data.firm || data.firm_name || '').toString().trim();
        const advEmail = (data.email || '').toString().toLowerCase().trim();
        const advJurisdiction = (data.jurisdiction || '').toString().trim();
        const advDealTypes = (data.deal_types || '').toString().trim();
        const advMissing = [];
        if (!advName) advMissing.push('name');
        if (!advEmail) advMissing.push('email');
        if (!advFirm) advMissing.push('firm');
        if (!advJurisdiction) advMissing.push('jurisdiction');
        if (!advDealTypes) advMissing.push('deal_types');
        if (advMissing.length) return bad(res, 'Missing required fields: ' + advMissing.join(', '), 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(advEmail)) return bad(res, 'Invalid email address', 400);
        const appId = 'advapp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        const application = {
          id: appId,
          name: advName,
          role: data.role ? String(data.role).trim() : '',
          firm: advFirm,
          email: advEmail,
          jurisdiction: advJurisdiction,
          website: data.website ? String(data.website).trim() : (data.firm_url ? String(data.firm_url).trim() : ''),
          deal_types: advDealTypes,
          recent_deal: data.recent_deal ? String(data.recent_deal).trim() : '',
          status: 'pending',
          source: 'public-landing',
          ip: getClientIp(req),
          created_at: new Date().toISOString(),
        };
        await kvSet(`advisor_application:${appId}`, application);
        // Sorted-set index by created_at for the future operator review UI.
        await kvZadd('advisor_applications:index', Date.now(), appId);
        await sendAdvisorApplication(application).catch(console.error);
        return ok(res, { message: 'Application received. Operator review within five business days.' });
      }

      // ── Investor (institutional / HNW) branch ────────────────
      // ticket_range is optional in the public form (form's 'Deployment Capacity'
      // field maps to aum_range). Bots fill both. Keep aum_range required as the
      // canonical capacity signal.
      const required = ['email','firm_name','contact_name','category','institution_type','aum_range','invest_focus','role'];
      const missing = required.filter(k => {
        const v = data[k];
        return v == null || String(v).trim() === '';
      });
      if (missing.length) return bad(res, 'Missing required fields: ' + missing.join(', '), 400);
      const category = rawCategory;
      if (category !== 'institutional' && category !== 'hnw') return bad(res, 'Applicant category must be "institutional", "hnw", or "advisor"', 400);
      const email = String(data.email).toLowerCase().trim();
      const existing = await kvGet(`inst_email:${email}`);
      if (existing) return bad(res, 'This email is already registered');
      const id = 'inv-' + Date.now().toString(36);
      const inst = {
        id, email,
        firm_name: String(data.firm_name).trim(),
        contact_name: String(data.contact_name).trim(),
        category,
        institution_type: String(data.institution_type).trim(),
        aum_range: String(data.aum_range).trim(),
        ticket_range: data.ticket_range ? String(data.ticket_range).trim() : String(data.aum_range).trim(),
        invest_focus: String(data.invest_focus).trim(),
        role: String(data.role).trim(),
        status: 'pending',
        code: null,
        created_at: new Date().toISOString(),
      };
      await kvSet(`inst:${id}`, inst);
      await kvSet(`inst_email:${email}`, id);
      await sendAccessApplication(inst).catch(console.error);
      await sendAccessApplicationAck(inst).catch(console.error);
      return ok(res, { message: 'Application received. You will be notified by email when reviewed.' });
    }

    if (op === 'login') {
      const ip = getClientIp(req);
      if (!(await shouldBypassRateLimit(req)) && await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      const { email, code } = req.body || {};
      if (!email || !code) return bad(res, 'Email and access code required');
      const instId = await kvGet(`inst_email:${email.toLowerCase().trim()}`);
      if (!instId) return bad(res, 'Invalid credentials', 401);
      const inst = await kvGet(`inst:${instId}`);
      if (!inst || inst.status !== 'approved') return bad(res, 'Access not yet approved or invalid credentials', 401);
      if (inst.code !== code.toUpperCase().trim()) return bad(res, 'Invalid access code', 401);
      const token = await signToken({ inst_id: instId, email: inst.email, name: inst.contact_name || '', firm: inst.firm_name, role: 'inst' }, '30d');
      res.setHeader('Set-Cookie', setCookieHeader('prism_inst', token, cookieOpts(2592000)));
      return ok(res, { inst: sanitizeInst(inst) });
    }

    if (op === 'logout') {
      // Revoke the current token by writing its jti to the denylist (30d TTL — matches token lifetime)
      const t = getCookie(req, 'prism_inst');
      if (t) {
        const p = await verifyToken(t);
        if (p?.jti) await kvSet('revoked:' + p.jti, '1', { ex: 2592000 });
      }
      res.setHeader('Set-Cookie', setCookieHeader('prism_inst', '', clearCookieOpts()));
      return ok(res);
    }

    if (op === 'me') {
      const auth = await getInst();
      if (!auth) return unauth(res);
      const inst = await kvGet(`inst:${auth.inst_id}`);
      if (!inst) return unauth(res);
      return ok(res, { inst: sanitizeInst(inst) });
    }

    if (op === 'list') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const keys = await kvKeys('inst:inv-*');
      const insts = (await Promise.all(keys.map(k => kvGet(k)))).filter(Boolean).map(i => {
        // SECURITY: strip code from list view — show only in per-inst detail
        const { code, ...safe } = i; return { ...safe, has_code: !!code };
      });
      return ok(res, { insts });
    }

    if (op === 'record-nda') {
      const inst = await getInst();
      if (!inst) return unauth(res);
      const { dealId } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      await kvSet(`nda_signed:${inst.inst_id}:${dealId}`, { signed_at: new Date().toISOString(), inst_id: inst.inst_id, deal_id: dealId });
      return ok(res, { ok: true });
    }

    if (op === 'nda-accept') {
      // Formal NDA acceptance with timestamp + document hash for compliance
      // audit trail. Companion to record-nda (which only sets the access flag).
      // Frontend (investor-portal NDA scroll-gate modal) calls both — record-nda
      // gates access, nda-accept records the legal acceptance event.
      const inst = await getInst();
      if (!inst) return unauth(res);
      const { dealId, timestamp, documentHash, investorId } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const existing = await kvGet(`nda_signed:${inst.inst_id}:${dealId}`) || {};
      const record = {
        ...existing,
        inst_id: inst.inst_id,
        deal_id: dealId,
        signed_at: existing.signed_at || new Date().toISOString(),
        formally_accepted_at: new Date().toISOString(),
        timestamp: timestamp || Date.now(),
        document_hash: documentHash || null,
        investor_id_claimed: investorId || null,
        ip: getClientIp(req),
      };
      await kvSet(`nda_signed:${inst.inst_id}:${dealId}`, record);
      return ok(res, { ok: true, record });
    }

    if (op === 'notices') {
      // Investor's own pending + acknowledged notices (capital calls,
      // distributions). Notices are written by capital-call-notify and
      // distribution-notify per recipient investor.
      const inst = await getInst();
      if (!inst) return unauth(res);
      const keys = await kvKeys(`notice:${inst.inst_id}:*`);
      const notices = (await Promise.all(keys.map(k => kvGet(k)))).filter(Boolean);
      notices.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      return ok(res, { notices });
    }

    if (op === 'acknowledge-notice') {
      const inst = await getInst();
      if (!inst) return unauth(res);
      const { noticeId } = req.body || {};
      if (!noticeId) return bad(res, 'noticeId required');
      const record = await kvGet(`notice:${inst.inst_id}:${noticeId}`);
      if (!record) return bad(res, 'Notice not found', 404);
      if (record.status === 'acknowledged') {
        return ok(res, { ok: true, idempotent: true, notice: record });
      }
      record.status = 'acknowledged';
      record.acknowledged_at = new Date().toISOString();
      await kvSet(`notice:${inst.inst_id}:${noticeId}`, record);
      return ok(res, { ok: true, notice: record });
    }

    if (op === 'check-nda') {
      const inst = await getInst();
      if (!inst) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const record = await kvGet(`nda_signed:${inst.inst_id}:${dealId}`);
      return ok(res, { signed: !!record, signed_at: record?.signed_at || null });
    }

    if (op === 'inst-deal-docs') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');

      // Check NDA status
      const ndaRecord = await kvGet(`nda_signed:${instAuth.inst_id}:${dealId}`);
      const ndaSigned = !!ndaRecord;

      const slots = ['nda', 'mgmt', 'fin', 'term'];
      const labels = { nda: 'NDA Template', mgmt: 'Management Presentation', fin: 'Financial Summary', term: 'Term Sheet' };
      const gates  = { nda: 'public', mgmt: 'nda', fin: 'nda', term: 'nda' };

      const docs = [];
      await Promise.all(slots.map(async slot => {
        const doc = await kvGet(`deal_doc:${dealId}:${slot}`);
        if (doc) {
          docs.push({
            slot,
            label: labels[slot],
            name: doc.name,
            type: doc.type,
            gate: gates[slot],
            accessible: gates[slot] === 'public' || ndaSigned,
          });
        }
      }));

      return ok(res, { docs, nda_signed: ndaSigned });
    }

    // ── Investor document download (gated by NDA) ────────────────
    if (op === 'inst-doc-download') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId, slot } = req.query;
      if (!dealId || !slot) return bad(res, 'dealId and slot required');
      const validSlots = ['nda', 'mgmt', 'fin', 'term'];
      if (!validSlots.includes(slot)) return bad(res, 'Invalid slot');
      const gates = { nda: 'public', mgmt: 'nda', fin: 'nda', term: 'nda' };
      // NDA-gated docs require NDA signature on file
      if (gates[slot] !== 'public') {
        const ndaRecord = await kvGet(`nda_signed:${instAuth.inst_id}:${dealId}`);
        if (!ndaRecord) return bad(res, 'NDA must be signed before accessing this document', 403);
      }
      const doc = await kvGet(`deal_doc:${dealId}:${slot}`);
      if (!doc?.data) return bad(res, 'Document not available', 404);
      return ok(res, { name: doc.name, type: doc.type, data: doc.data });
    }

    // ── DD deadline helper ───────────────────────────────────────
    // Returns Date or null. DD window closes 14 days before closing_date.
    function getDdDeadline(deal) {
      if (!deal.closing_date && !deal.closing) return null;
      const closing = new Date(deal.closing_date || deal.closing);
      if (isNaN(closing)) return null;
      return new Date(closing.getTime() - 14 * 24 * 60 * 60 * 1000);
    }

    // ── IOI approval gate helper (inst) ─────────────────────────
    // Returns the IOI record if investor has an approved IOI, else null.
    async function getApprovedIoi(dealId, investorId) {
      const ioiId = await kvGet(`ioi_exists:${dealId}:${investorId}`);
      if (!ioiId || ioiId === 'pending' || ioiId === 'rejected') return null;
      // dedup key is set to 'approved' (a string sentinel) — resolve via index
      const iois = await getAllIois();
      return iois.find(i => i.deal_id === dealId && i.investor_id === investorId && i.status === 'approved') || null;
    }

    // ── VDR: list files (investor view) ─────────────────────────
    // Contract: { files, dd_deadline, dd_active } when authorized; { error: 'not_authorized' } otherwise.
    if (op === 'vdr-files') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return res.status(403).json({ error: 'not_authorized' });

      const files = (await kvGet(`vdr:${dealId}:files`)) || (await kvGet(`vdr:${dealId}:index`)) || [];
      const { dd_deadline, dd_active } = ddInfo(deal);
      // Backward-compat: dd_expired retained for older frontends
      return ok(res, { files, dd_deadline, dd_active, dd_expired: !dd_active });
    }

    // ── VDR: download single file (investor view) ────────────────
    // Contract: { file: {name, mimeType, contentBase64, size}, watermark }
    // Audit log: 'vdr_view' with { investor_id, fileId, ts }.
    if (op === 'vdr-file') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId, fileId } = req.query;
      if (!dealId || !fileId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return res.status(403).json({ error: 'not_authorized' });

      const index = (await kvGet(`vdr:${dealId}:files`)) || (await kvGet(`vdr:${dealId}:index`)) || [];
      const fileMeta = index.find(f => f.fileId === fileId || f.id === fileId);
      if (!fileMeta) return bad(res, 'File not found', 404);

      const raw = await kvGet(`vdr:${dealId}:file:${fileId}`);
      if (!raw) return bad(res, 'File content not found', 404);

      const ts = new Date().toISOString();
      const investorName = inst.firm_name || inst.contact_name || instAuth.inst_id;

      // Resolve to contract shape regardless of legacy storage form
      let filePayload;
      if (typeof raw === 'string') {
        filePayload = {
          name: fileMeta.name || 'file',
          mimeType: fileMeta.mimeType || fileMeta.type || 'application/octet-stream',
          contentBase64: raw,
          size: fileMeta.size || 0,
        };
      } else {
        filePayload = {
          name: raw.name,
          mimeType: raw.mimeType,
          contentBase64: raw.contentBase64,
          size: raw.size,
        };
      }

      // Audit log entry
      const auditEntry = {
        at: ts,
        actor: instAuth.inst_id,
        action: 'vdr_view',
        meta: { investor_id: instAuth.inst_id, fileId, ts },
      };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(auditEntry);
      deal.updated_at = ts;
      await saveDeal(deal);
      await appendAuditEntry(dealId, auditEntry);

      return ok(res, {
        file: filePayload,
        watermark: {
          investor_id: instAuth.inst_id,
          investor_name: investorName,
          viewed_at: ts,
          // Backward-compat aliases
          investorId: instAuth.inst_id,
          investorName,
          timestamp: ts,
        },
      });
    }

    // ── Q&A: submit a question ───────────────────────────────────
    // Contract: POST { dealId, question } → { ok, threadId }
    // Anonymises asker via qa_anon_map:{dealId}; advisor sees real identity.
    if (op === 'submit-qa') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId, question } = req.body || {};
      const cleanQ = sanitizeText(question, 2000);
      if (!dealId || !cleanQ) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return res.status(403).json({ error: 'not_authorized' });

      const { dd_active } = ddInfo(deal);
      if (!dd_active) return res.status(403).json({ error: 'dd_closed' });

      const threadId = nanoid(10);
      const askedAt = new Date().toISOString();
      const askedByName = inst.firm_name || inst.contact_name || instAuth.inst_id;

      // Assign anonymous label for this investor (idempotent — first question wins index)
      await assignAnonLabel(dealId, instAuth.inst_id);

      const qa = (await kvGet(`qa:${dealId}`)) || [];
      const entry = {
        id: threadId,
        question: cleanQ,
        // Contract field names
        asked_by: instAuth.inst_id,
        asked_by_name: askedByName,
        asked_at: askedAt,
        investor_id: instAuth.inst_id,
        answer: null,
        answered_at: null,
        // Backward-compat aliases used by existing readers
        askedBy: askedByName,
        askedAt: askedAt,
        answeredAt: null,
        answeredBy: null,
      };
      qa.push(entry);
      await kvSet(`qa:${dealId}`, qa);

      // Store pending key for 48h reminder
      await kvSet(`qa_pending:${dealId}:${threadId}`, JSON.stringify({ dealId, qaId: threadId, submittedAt: askedAt, reminderSent: false }), { ex: 172800 });

      // Audit log
      const auditEntry = { at: askedAt, actor: instAuth.inst_id, action: 'qa_question_submitted', meta: { threadId } };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(auditEntry);
      deal.updated_at = askedAt;
      await saveDeal(deal);
      await appendAuditEntry(dealId, auditEntry);

      // Email the deal's advisor with the new thread id
      if (deal.advisor_id && deal.advisor_id.startsWith('adv-')) {
        const qaAdvisor = await kvGet(`advisor:${deal.advisor_id}`);
        if (qaAdvisor) await sendQaQuestionToAdvisor(qaAdvisor, deal, cleanQ, threadId).catch(console.error);
      }

      return ok(res, { threadId, qaId: threadId });
    }

    // ── Q&A: fetch full thread (investor view) ───────────────────
    // Contract: { threads, dd_deadline, dd_active }
    // Investor names are masked to "Investor #N" via qa_anon_map.
    if (op === 'qa-thread') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'bad_request');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return res.status(403).json({ error: 'not_authorized' });

      const qa = (await kvGet(`qa:${dealId}`)) || [];
      const anonMap = (await kvGet(`qa_anon_map:${dealId}`)) || {};
      // Backfill: any historical questioner without a label gets one now (stable order).
      let dirty = false;
      for (const t of qa) {
        if (t.type === 'advisor_open') continue;
        if (t.investor_id && !anonMap[t.investor_id]) {
          const next = Object.keys(anonMap).length + 1;
          anonMap[t.investor_id] = `Investor #${next}`;
          dirty = true;
        }
      }
      if (dirty) await kvSet(`qa_anon_map:${dealId}`, anonMap);
      const threads = maskQaThreadsForInvestor(qa, anonMap);
      const { dd_deadline, dd_active } = ddInfo(deal);
      // Backward-compat: also return raw `qa` so older frontend reads still work — but
      // mask names there too so identity is never leaked to investors.
      const qaMasked = qa.map(t => {
        if (t.type === 'advisor_open') return t;
        const anon = anonMap[t.investor_id] || 'Investor';
        return { ...t, askedBy: anon, asked_by_name: anon };
      });
      return ok(res, { threads, qa: qaMasked, dd_deadline, dd_active });
    }

    // ── investor statements (GET) ─────────────────────────────────
    // resource=inst&op=statements — returns all statements for the calling investor
    if (op === 'statements') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const stmtPattern = `statement:*:${instAuth.inst_id}:*`;
      const stmtKeys = await kvKeys(stmtPattern);
      const statements = (await Promise.all(stmtKeys.map(k => kvGet(k)))).filter(Boolean);
      statements.sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
      return ok(res, { statements });
    }

    // ── investor distributions (GET) ──────────────────────────────
    // resource=inst&op=distributions — returns all distributions for this investor's approved IOI deals
    if (op === 'distributions') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);

      // Find all deals where this investor has an approved IOI
      const invAllIois = await getAllIois();
      const invDealIds = [...new Set(
        invAllIois
          .filter(i => i.investor_id === instAuth.inst_id && i.status === 'approved')
          .map(i => i.deal_id)
      )];

      const allDistributions = [];
      for (const dId of invDealIds) {
        const distKeys = await kvKeys(`distribution:${dId}:*`);
        const dists = (await Promise.all(distKeys.map(k => kvGet(k)))).filter(Boolean);
        for (const dist of dists) {
          const myEntry = (dist.perInvestorAmounts || []).find(e => e.investorId === instAuth.inst_id);
          if (myEntry) {
            allDistributions.push({
              distributionId: dist.distributionId,
              dealId: dist.dealId,
              distributionType: dist.distributionType,
              distributionDate: dist.distributionDate,
              totalDistributionUsd: dist.totalDistributionUsd,
              myAmount: myEntry.distributionAmount,
              myCommitment: myEntry.committedAmount,
              postedAt: dist.postedAt,
            });
          }
        }
      }
      allDistributions.sort((a, b) => (b.distributionDate || '').localeCompare(a.distributionDate || ''));
      return ok(res, { distributions: allDistributions });
    }

    // ── investor performance metrics (GET) ────────────────────────
    // resource=inst&op=performance — DPI, RVPI, TVPI per deal + totals
    if (op === 'performance') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);

      const perfAllIois = await getAllIois();
      const approvedIois = perfAllIois.filter(i => i.investor_id === instAuth.inst_id && i.status === 'approved');

      let totalCommitted = 0;
      let totalCurrentValue = 0;
      const positions = [];

      for (const ioi of approvedIois) {
        const deal = await getDeal(ioi.deal_id);
        if (!deal) continue;

        const committed = ioi.amount || 0;
        totalCommitted += committed;

        // Collect all distributions for this investor/deal
        const perfDistKeys = await kvKeys(`distribution:${ioi.deal_id}:*`);
        const perfDists = (await Promise.all(perfDistKeys.map(k => kvGet(k)))).filter(Boolean);
        let totalDistributed = 0;
        const distributionList = [];
        for (const dist of perfDists) {
          const myEntry = (dist.perInvestorAmounts || []).find(e => e.investorId === instAuth.inst_id);
          if (myEntry) {
            totalDistributed += myEntry.distributionAmount || 0;
            distributionList.push({
              distributionId: dist.distributionId,
              type: dist.distributionType,
              date: dist.distributionDate,
              amount: myEntry.distributionAmount,
            });
          }
        }

        // Current NAV value for this investor's position
        const totalNavUsd = deal.totalNavUsd || 0;
        const totalCommitmentForDeal = deal.totalCommitment || deal.ioi_agg_usd || 0;
        const currentValue = totalCommitmentForDeal > 0 && committed > 0
          ? (committed / totalCommitmentForDeal) * totalNavUsd
          : 0;
        totalCurrentValue += currentValue;

        const dpi = committed > 0 ? totalDistributed / committed : 0;
        const rvpi = committed > 0 ? currentValue / committed : 0;
        const tvpi = dpi + rvpi;

        positions.push({
          dealId: ioi.deal_id,
          dealName: deal.name,
          committed,
          currentValue: Math.round(currentValue * 100) / 100,
          totalDistributed: Math.round(totalDistributed * 100) / 100,
          dpi: Math.round(dpi * 10000) / 10000,
          rvpi: Math.round(rvpi * 10000) / 10000,
          tvpi: Math.round(tvpi * 10000) / 10000,
          moic: Math.round(tvpi * 10000) / 10000,
          irr: null, // requires full cash flow series — not yet implemented
          distributions: distributionList,
          navAsOf: deal.navAsOf || null,
        });
      }

      const totalTvpi = totalCommitted > 0
        ? Math.round((totalCurrentValue / totalCommitted) * 10000) / 10000
        : 0;

      return ok(res, {
        positions,
        totalCommitted,
        totalCurrentValue: Math.round(totalCurrentValue * 100) / 100,
        totalTvpi,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ADMIN RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'admin') {

    // ─── View-As: operator-only impersonation for QA ─────────────
    // Issues a fresh advisor or investor cookie alongside the admin cookie.
    // Operator can then navigate to /advisor-portal or /investor-portal and
    // see exactly what that user sees. The admin cookie is preserved so they
    // can hop back to /admin-portal without re-logging-in.
    if (op === 'view-as-advisor') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { advisor_id } = req.body || {};
      if (!advisor_id) return bad(res, 'advisor_id required');
      const adv = await kvGet(`advisor:${advisor_id}`);
      if (!adv) return bad(res, 'Advisor not found', 404);
      const { signToken, cookieOpts } = await import('./_lib/auth.js');
      const { setCookieHeader } = await import('./_lib/http.js');
      const token = await signToken({ advisor_id: adv.id, email: adv.email, firm: adv.firm_name, role: 'advisor', impersonated_by: admin.email }, '7d');
      res.setHeader('Set-Cookie', setCookieHeader('prism_advisor', token, cookieOpts(604800)));
      return ok(res, { advisor: { id: adv.id, email: adv.email, firm_name: adv.firm_name, name: adv.name } });
    }

    if (op === 'view-as-investor') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { inst_id } = req.body || {};
      if (!inst_id) return bad(res, 'inst_id required');
      const inst = await kvGet(`inst:${inst_id}`);
      if (!inst) return bad(res, 'Investor not found', 404);
      if (inst.status !== 'approved') return bad(res, 'Investor not approved — cannot impersonate', 400);
      const { signToken, cookieOpts } = await import('./_lib/auth.js');
      const { setCookieHeader } = await import('./_lib/http.js');
      const token = await signToken({ inst_id: inst.id, email: inst.email, firm: inst.firm_name, role: 'investor', impersonated_by: admin.email }, '30d');
      res.setHeader('Set-Cookie', setCookieHeader('prism_inst', token, cookieOpts(2592000)));
      return ok(res, { inst: { id: inst.id, email: inst.email, firm_name: inst.firm_name } });
    }

    if (op === 'approve-advisor') {
      // Admin approves a pending advisor signup. Re-validates that all
      // required profile fields are present (admin can't accidentally
      // approve someone with a partial application). Generates temp
      // password, sends welcome (suppressed under BOT_MODE).
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { advisor_id } = req.body || {};
      if (!advisor_id) return bad(res, 'advisor_id required');
      const adv = await kvGet(`advisor:${advisor_id}`);
      if (!adv) return bad(res, 'Advisor not found', 404);
      // Idempotent: re-clicking Approve (or a duplicate API call from a cached
      // pending list) returns the existing record without rotating the password
      // or re-firing the welcome email.
      if (adv.status === 'active') return ok(res, { advisor: sanitizeAdvisor(adv), idempotent: true });
      const required = ['email','firm_name','name','title','phone','firm_website','jurisdiction','year_founded','regulatory_status','aum_managed'];
      const missing = required.filter(k => adv[k] == null || String(adv[k]).trim() === '');
      if (!Array.isArray(adv.primary_asset_classes) || adv.primary_asset_classes.length === 0) missing.push('primary_asset_classes');
      if (missing.length) return bad(res, 'Cannot approve — incomplete profile: ' + missing.join(', '), 400);
      const tempPw = generateTempPassword();
      adv.status = 'active';
      adv.password_hash = await bcrypt.hash(tempPw, 12);
      adv.requires_setup = true;
      adv.approved_at = new Date().toISOString();
      adv.approved_by = admin.email;
      await kvSet(`advisor:${advisor_id}`, adv);
      await sendAdvisorWelcome(adv, tempPw).catch(console.error);
      return ok(res, { advisor: sanitizeAdvisor(adv) });
    }

    if (op === 'pending-advisors') {
      // List pending advisor applications for admin queue
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const keys = await kvKeys('advisor:adv-*');
      const advisors = (await Promise.all(keys.map(k => kvGet(k))))
        .filter(a => a && a.status === 'pending')
        .map(sanitizeAdvisor);
      return ok(res, { advisors });
    }

    if (op === 'advance-stage') {
      // Generic admin stage advancer for transitions not covered by
      // publish-deal (review→live) or push-package (live/ioi→dd).
      // Specifically: dd→terms, terms→close, close→realized, *→killed.
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId, target } = req.body || {};
      if (!dealId || !target) return bad(res, 'dealId and target required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      const VALID_TRANSITIONS = {
        dd: ['terms', 'killed'],
        terms: ['close', 'killed'],
        close: ['realized', 'killed'],
      };
      const allowed = VALID_TRANSITIONS[deal.stage] || [];
      if (!allowed.includes(target)) {
        return bad(res, `Cannot advance from ${deal.stage} to ${target}. Allowed: ${allowed.join(', ') || 'none'}`, 400);
      }
      const now = new Date().toISOString();
      const fromStage = deal.stage;
      deal.stage = target;
      deal.updated_at = now;
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: now, actor: admin.email, action: 'stage_changed', meta: { from: fromStage, to: target } });
      await saveDeal(deal);
      await appendAuditEntry(dealId, { at: now, actor: admin.email, action: 'stage_changed', meta: { from: fromStage, to: target } });
      // Bust marketplace cache so investors see stage change within 5s
      try { await kvDel('cache:marketplace:public'); await kvDel('cache:marketplace:admin'); } catch {}
      return ok(res, { deal });
    }

    if (op === 'approve') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { inst_id, reveal_code } = req.body || {};
      const inst = await kvGet(`inst:${inst_id}`);
      if (!inst) return bad(res, 'Institution not found', 404);

      if (reveal_code) {
        // Reveal code for already-approved inst (audit logged)
        if (inst.status !== 'approved') return bad(res, 'Not approved yet');
        inst.audit_log = inst.audit_log || [];
        inst.audit_log.push({ at: new Date().toISOString(), actor: admin.email, action: 'code_revealed' });
        await kvSet(`inst:${inst_id}`, inst);
        return ok(res, { code: inst.code });
      }

      // Idempotent: a re-click after approval is benign. Returns existing
      // record without rotating the access code or re-firing the email.
      // (reveal_code path above is the explicit way to surface code again.)
      if (inst.status === 'approved') {
        return ok(res, { inst: sanitizeInst(inst), idempotent: true });
      }

      // Approval gate: investor profile must be complete. Same field set as
      // op=register so admin can never accidentally activate an investor with
      // half-filled data. If the data layer ever holds a legacy partial record,
      // operator must edit + complete it before approval succeeds.
      const requiredOnApprove = ['email','firm_name','contact_name','category','institution_type','aum_range','invest_focus','role'];
      const missingOnApprove = requiredOnApprove.filter(k => {
        const v = inst[k];
        return v == null || String(v).trim() === '';
      });
      if (missingOnApprove.length) return bad(res, 'Cannot approve — incomplete profile: ' + missingOnApprove.join(', '), 400);

      // Admin can pass an explicit code (skips email + uses provided value)
      const adminCode = (req.body?.code || '').toString().trim();
      const code = adminCode.length > 0 ? adminCode : 'INST-' + generateCode();
      inst.status = 'approved';
      inst.code = code;
      inst.approved_at = new Date().toISOString();
      inst.approved_by = admin.email;
      inst.audit_log = [{ at: new Date().toISOString(), actor: admin.email, action: 'approved' }];
      await kvSet(`inst:${inst_id}`, inst);
      await kvSet(`inst_code:${code}`, inst_id);
      await sendAccessCode(inst).catch(console.error);

      // [SENTRY] Track every investor approval
      await captureMessage(
        `Investor approved: ${inst.firm_name} (${inst.email})`,
        'info',
        { inst_id, actor: admin.email }
      ).catch(() => {});

      // [KYC] Initiate KYC/AML check via Onfido or Persona.
      // Stubbed until KYC_PROVIDER_API_KEY env var is set — see api/_lib/kyc.js.
      try {
        const nameParts = (inst.contact_name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || inst.contact_name || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const kycResult = await initiateKycCheck(
          inst_id, firstName, lastName, inst.email
        );
        inst.kycCheckId = kycResult.checkId;
        inst.kycStatus = kycResult.status;
        inst.kycStubbed = kycResult.stubbed || false;
        inst.kycInitiatedAt = new Date().toISOString();
        await kvSet(`inst:${inst_id}`, inst);
      } catch (kycErr) {
        // KYC failure is non-fatal — investor approval still proceeds
        console.error('[KYC] initiateKycCheck failed (non-fatal):', kycErr.message);
      }

      // Set up welcome sequence tracking key for Day 2 / Day 7 emails
      // welcome_seq:{investorId} — JSON with approvedAt, day2Sent, day7Sent
      // No TTL — the welcome-cron reads and updates this key
      await kvSet(`welcome_seq:${inst_id}`, JSON.stringify({
        approvedAt: inst.approved_at,
        day2Sent: false,
        day7Sent: false,
      }));

      return ok(res, { message: 'Approved. Access code sent by email.' });
    }

    if (op === 'reject-inst') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { inst_id, reason } = req.body || {};
      const inst = await kvGet(`inst:${inst_id}`);
      if (!inst) return bad(res, 'Not found', 404);
      inst.status = 'rejected';
      inst.rejected_at = new Date().toISOString();
      inst.rejected_by = admin.email;
      inst.rejection_reason = reason || '';
      await kvSet(`inst:${inst_id}`, inst);
      return ok(res);
    }

    if (op === 'deal-docs') {
      const adminPayload = await getAdmin();
      if (!adminPayload) return res.status(403).json({ error: 'Admin access required' });
      const dealId = req.query.dealId;
      if (!dealId) return bad(res, 'dealId required');
      const slots = ['nda', 'mgmt', 'fin', 'term'];
      const docs = {};
      await Promise.all(slots.map(async slot => {
        const doc = await kvGet(`deal_doc:${dealId}:${slot}`);
        if (doc) docs[slot] = { name: doc.name, type: doc.type, size: doc.size, data: doc.data };
      }));
      return ok(res, { docs });
    }

    if (op === 'ai-generate') {
      const adminPayload = await getAdmin();
      if (!adminPayload) return res.status(403).json({ error: 'Admin access required' });
      const { dealId } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      // BOT_MODE guard: real Anthropic call would burn tokens. If the operator
      // accidentally clicks 'Generate with AI' during a bot-test session, return
      // a synthetic mock so the UI flow still exercises end-to-end without
      // hitting the model. Production (BOT_MODE unset) goes through the real
      // callAI path below unchanged.
      if (process.env.BOT_MODE === '1') {
        return ok(res, {
          tagline: `[BOT-MODE mock] Curated ${deal.asset_class || 'private'} opportunity in ${deal.geography || 'global'} markets`,
          thesis: `[BOT-MODE mock] Synthetic thesis for ${deal.name}. ${deal.originator || 'Originator'} positions this as an institutional-quality ${deal.deal_structure || 'structured'} transaction. Not generated by Anthropic — BOT_MODE is on.`,
          company_overview: `[BOT-MODE mock] ${deal.name} is a ${deal.asset_class || 'private'} transaction sourced by ${deal.originator || 'the originator'}. Underwritten with institutional discipline. This overview is synthetic and was not generated by Anthropic.`,
          highlights: [
            { icon: '◆', s: 'Mock highlight 1', b: 'Synthetic content for bot-test mode.' },
            { icon: '◆', s: 'Mock highlight 2', b: `Target IRR ${deal.target_irr || 0}% over ${deal.term_months || 0} months.` },
            { icon: '◆', s: 'Mock highlight 3', b: `Originated by ${deal.originator || 'sponsor'} in ${deal.geography || 'jurisdiction'}.` },
          ],
          mocked: true,
        });
      }
      const slots = ['nda', 'mgmt', 'fin', 'term'];
      const docContent = [];
      for (const slot of slots) {
        const doc = await kvGet(`deal_doc:${dealId}:${slot}`);
        if (doc?.data) {
          docContent.push({ slot, name: doc.name, type: doc.type || 'application/pdf', data: doc.data });
        }
      }
      if (docContent.length === 0) return bad(res, 'No documents uploaded for this deal');
      if (!process.env.ANTHROPIC_API_KEY) {
        // Mock fallback — no API key configured (dev/staging environments)
        const mockGenerated = {
          tagline: `${deal.name} — Institutional-grade opportunity in ${deal.geography || 'global markets'}`,
          thesis: `${deal.name} presents a compelling risk-adjusted return profile for sophisticated investors. The structure provides downside protection while capturing meaningful upside through a disciplined deployment strategy. Market conditions remain supportive of the underlying thesis, with strong deal-level fundamentals validated through independent due diligence.`,
          highlights: [
            { icon: '◆', s: 'Senior secured structure', b: 'First-lien security over underlying assets provides investors with principal protection in a downside scenario.' },
            { icon: '◆', s: 'Experienced management team', b: 'Principals have successfully executed multiple transactions of comparable scale and complexity.' },
            { icon: '◆', s: 'Defined exit pathway', b: 'Clear liquidity event anticipated within the stated term, supported by contracted cash flows and market comps.' },
            { icon: '◆', s: 'Attractive risk-adjusted returns', b: `Target IRR of ${deal.target_irr || '12–15%'} with a ${deal.term_months || 24}-month investment horizon aligns with institutional mandate requirements.` },
          ],
          stats: {
            irr: deal.target_irr ? `${deal.target_irr}%` : 'See OM',
            term: deal.term_months ? `${deal.term_months} months` : 'See OM',
            min_ticket: deal.min_ticket_usd ? `$${(deal.min_ticket_usd / 1000).toFixed(0)}K` : 'See OM',
            structure: deal.asset_class || 'Senior Secured Credit',
          },
          asset_class: deal.asset_class || 'credit',
          geography: deal.geography || 'Asia-Pacific',
        };
        deal.ai_draft = {
          tagline:      mockGenerated.tagline,
          thesis:       mockGenerated.thesis,
          highlights:   mockGenerated.highlights,
          stats:        mockGenerated.stats,
          generated_at: new Date().toISOString(),
        };
        deal.updated_at = new Date().toISOString();
        await saveDeal(deal);
        return ok(res, { generated: mockGenerated, dealId, mock: true });
      }
      const docBlocks = docContent.map(d => ({
        type: 'document',
        source: { type: 'base64', media_type: d.type === 'application/pdf' ? 'application/pdf' : 'text/plain', data: d.data },
        title: d.name,
        citations: { enabled: false },
      }));
      const systemPrompt = `You are an investment analyst generating structured deal profile content for a private capital marketplace platform called Aurum Prism. Analyze the provided documents and generate concise, professional investor-facing content. Be factual, data-driven, and use the tone of a private bank — not a startup pitch.`;
      const userPrompt = `Based on the uploaded deal documents, generate a complete deal profile for the Aurum Prism investor marketplace.

Return ONLY valid JSON in this exact structure:
{
  "tagline": "One compelling sentence — deal name, geography, key differentiator",
  "thesis": "2-3 paragraphs. Investment rationale, market opportunity, risk/return profile. Institutional tone.",
  "highlights": [
    { "icon": "◆", "s": "Short bold title (4-6 words)", "b": "One sentence body expanding on the point." },
    ... 3-5 items
  ],
  "stats": {
    "irr": "e.g. 13.5%",
    "term": "e.g. 24 months",
    "min_ticket": "e.g. $500K",
    "structure": "e.g. Senior Secured Credit"
  },
  "asset_class": "credit|equity|real_estate|infrastructure",
  "geography": "e.g. Asia-Pacific"
}`;
      try {
        const result = await callAI(
          [{ role: 'user', content: [...docBlocks, { type: 'text', text: userPrompt }] }],
          {
            model: 'claude-sonnet-4-6',
            maxTokens: 1500,
            system: systemPrompt,
            extraHeaders: { 'anthropic-beta': 'pdfs-2024-09-25' },
          },
        );
        const rawText = result.content?.[0]?.text || '';
        let generated;
        try {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          generated = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        } catch {
          return bad(res, 'Failed to parse AI response', 500);
        }
        // Persist AI draft onto the deal record so Review & Launch panel can reload it
        deal.ai_draft = {
          tagline:      generated.tagline      || '',
          thesis:       generated.thesis       || '',
          highlights:   generated.highlights   || [],
          stats:        generated.stats        || {},
          generated_at: new Date().toISOString(),
        };
        deal.updated_at = new Date().toISOString();
        await saveDeal(deal);

        return ok(res, { generated, dealId });
      } catch (err) {
        console.error('AI generate error:', err);
        return bad(res, 'AI generation failed', 500);
      }
    }

    if (op === 'set-platform-params') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const { dealId, platform_alloc_usd, platform_min_ticket_usd, admin_notes } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const now = new Date().toISOString();

      if (typeof platform_alloc_usd === 'number' && platform_alloc_usd > 0) {
        deal.platform_alloc_usd = platform_alloc_usd;
      } else if (platform_alloc_usd === null) {
        deal.platform_alloc_usd = null;
      }

      if (typeof platform_min_ticket_usd === 'number' && platform_min_ticket_usd > 0) {
        deal.platform_min_ticket_usd = platform_min_ticket_usd;
      } else if (platform_min_ticket_usd === null) {
        deal.platform_min_ticket_usd = null;
      }

      if (admin_notes !== undefined) deal.admin_notes = admin_notes;

      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: now, actor: admin.email, action: 'Platform parameters set by admin', meta: { platform_alloc_usd: deal.platform_alloc_usd, platform_min_ticket_usd: deal.platform_min_ticket_usd } });
      deal.updated_at = now;

      await saveDeal(deal);

      return ok(res, {
        ok: true,
        deal: { id: deal.id, platform_alloc_usd: deal.platform_alloc_usd, platform_min_ticket_usd: deal.platform_min_ticket_usd },
      });
    }

    if (op === 'rescore-deal') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      const score = await scoreDeal(deal);
      deal.aiScore = score;
      deal.aiScoredAt = new Date().toISOString();
      await saveDeal(deal);
      return ok(res, { ok: true, dealId, aiScore: score, aiScoredAt: deal.aiScoredAt });
    }

    if (op === 'publish-deal') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const {
        dealId, tagline, thesis, highlights, stats,
        launch_mode, open_date, close_date, target_segments,
        featured: featuredFlag, min_ticket,
      } = req.body || {};

      if (!dealId) return bad(res, 'dealId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      // Idempotent: if the deal is already live, a duplicate publish call
      // returns the existing record without re-firing audit entries or
      // notification emails.
      if (deal.stage === 'live') {
        return ok(res, { deal, idempotent: true });
      }

      const now = new Date().toISOString();

      // Normalise highlights — accept both plain strings and {icon,s,b} objects
      const normHighlights = (Array.isArray(highlights) ? highlights : []).map(h => {
        if (typeof h === 'string') {
          const parts = h.split(' — ');
          return { icon: '◆', s: parts[0]?.slice(0, 50) || h.slice(0, 50), b: parts[1] || h };
        }
        return h;
      });

      // Merge content fields
      if (tagline  !== undefined) deal.tagline    = tagline;
      if (thesis   !== undefined) deal.thesis     = thesis;
      if (highlights !== undefined) deal.highlights = normHighlights;
      if (stats    !== undefined) deal.stats      = stats;

      // Admin approval gate: deal must have all required investor-portal
      // content before publish. Same validator as createDeal so the contract
      // is identical for advisor-submitted deals and admin-edited deals.
      const missingForPublish = validateDealForPublish(deal);
      if (missingForPublish.length) {
        return res.status(400).json({
          ok: false,
          error: 'Cannot publish — missing required fields: ' + missingForPublish.join(', '),
          missing: missingForPublish,
        });
      }

      // Publish settings
      deal.stage          = 'live';
      deal.member_visible = true;
      deal.launch_mode    = launch_mode || 'listed';
      deal.featured       = launch_mode === 'featured' || featuredFlag === true;
      if (target_segments !== undefined) deal.target_segments = target_segments;
      if (open_date)   deal.open_date      = open_date;
      if (close_date)  { deal.closing_date = close_date; deal.closing = close_date; }
      if (min_ticket !== undefined) deal.min_ticket_usd = parseFloat(min_ticket) || deal.min_ticket_usd;

      // If this deal is featured, clear featured flag on all other live deals
      if (deal.featured) {
        const allDeals = await listDeals();
        await Promise.all(allDeals
          .filter(other => other.id !== dealId && other.featured)
          .map(async other => {
            other.featured = false;
            await saveDeal(other);
          })
        );
      }

      // Audit log
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({
        at: now,
        actor: admin.email,
        action: 'Published to investor portal',
        meta: { launch_mode: deal.launch_mode, featured: deal.featured },
      });

      deal.updated_at = now;
      await saveDeal(deal);

      // [SENTRY] Track every deal publication as a named event
      await captureMessage(
        `Deal published: ${deal.name}`,
        'info',
        { dealId, launch_mode: deal.launch_mode, featured: deal.featured, actor: admin.email }
      ).catch(() => {});

      // Review MEDIUM #5: bust marketplace caches so investors see the deal
      // appear immediately, not after the 5s TTL.
      try {
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}
      return ok(res, {
        ok: true,
        deal: { id: deal.id, name: deal.name, stage: deal.stage, launch_mode: deal.launch_mode, featured: deal.featured },
      });
    }

    if (op === 'revoke-inst') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { inst_id } = req.body || {};
      const inst = await kvGet(`inst:${inst_id}`);
      if (!inst) return bad(res, 'Not found', 404);
      if (inst.code) await kvDel(`inst_code:${inst.code}`);
      inst.status = 'revoked';
      inst.code = null;
      inst.revoked_at = new Date().toISOString();
      await kvSet(`inst:${inst_id}`, inst);
      return ok(res);
    }

    // ── ioi-by-deal ──────────────────────────────────────────────
    if (op === 'ioi-by-deal') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const deals = await listDeals();
      // Fetch all IOIs once and bucket by deal_id
      const allIois = await getAllIois();
      const ioiByDeal = {};
      for (const ioi of allIois) {
        if (!ioiByDeal[ioi.deal_id]) ioiByDeal[ioi.deal_id] = [];
        ioiByDeal[ioi.deal_id].push(ioi);
      }

      // Fetch advisor name map (only advisors referenced by deals)
      const advisorIdSet = new Set(deals.map(d => d.advisor_id).filter(Boolean));
      const advisorMap = {};
      await Promise.all([...advisorIdSet].map(async id => {
        if (id.startsWith('adv-')) {
          const adv = await kvGet(`advisor:${id}`);
          if (adv) advisorMap[id] = adv.name || adv.firm_name || id;
        } else {
          advisorMap[id] = id; // admin-created deal — store actor id as-is
        }
      }));

      const groups = deals.map(deal => {
        const iois = ioiByDeal[deal.id] || [];
        const indicatedTotal = iois.reduce((s, i) => s + (i.amount || 0), 0);
        const targetAlloc = deal.target_alloc_usd || 0;
        const pct = targetAlloc > 0 ? Math.round(indicatedTotal / targetAlloc * 100) : 0;
        const approved = iois.filter(i => i.status === 'approved');
        return {
          dealId: deal.id,
          dealName: deal.name,
          advisor: advisorMap[deal.advisor_id] || '',
          advisorId: deal.advisor_id || '',
          targetAlloc,
          indicatedTotal,
          pct,
          status: deal.stage,
          closingDate: deal.closing_date || '',
          iois: iois.map(i => ({
            id: i.id,
            name: i.investor_firm || i.investor_email || i.investor_id,
            type: i.institution_type || '',
            geo: i.geo || '',
            amount: i.amount || 0,
            status: i.status,
            date: i.submitted_at,
          })),
          approvedCount: approved.length,
          approvedTotal: approved.reduce((s, i) => s + (i.amount || 0), 0),
        };
      });

      return ok(res, { groups });
    }

    // ── deal-action ───────────────────────────────────────────────
    if (op === 'deal-action') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const { dealId, action, params = {} } = req.body || {};
      if (!dealId || !action) return bad(res, 'dealId and action required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const now = new Date().toISOString();
      deal.audit_log = deal.audit_log || [];

      if (action === 'close_raise') {
        deal.raise_status = 'closed';
        deal.raise_closed_at = Date.now();
        deal.audit_log.push({ at: now, actor: admin.email, action: 'raise_closed', meta: {} });
      } else if (action === 'delay') {
        deal.raise_status = 'delayed';
        deal.raise_delay_note = params.note || '';
        deal.audit_log.push({ at: now, actor: admin.email, action: 'raise_delayed', meta: { note: params.note || '' } });
      } else if (action === 'increase_target') {
        if (!params.newTarget || isNaN(parseFloat(params.newTarget))) return bad(res, 'params.newTarget must be a number');
        const prev = deal.target_alloc_usd;
        deal.target_alloc_usd = parseFloat(params.newTarget);
        deal.audit_log.push({ at: now, actor: admin.email, action: 'target_increased', meta: { from: prev, to: deal.target_alloc_usd } });
      } else {
        return bad(res, `Unknown action: ${action}`);
      }

      deal.updated_at = now;
      await saveDeal(deal);
      return ok(res, { ok: true, deal });
    }

    // ── deal-detail ───────────────────────────────────────────────
    if (op === 'deal-detail') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      // Fetch all IOIs for this deal
      const allIois = await getAllIois();
      const dealIois = allIois.filter(i => i.deal_id === dealId);

      const ioiTotal = dealIois.length;
      const ioiApproved = dealIois.filter(i => i.status === 'approved');
      const ioiPending = dealIois.filter(i => i.status === 'pending');
      const ioiDeclined = dealIois.filter(i => i.status === 'rejected');
      const approvedTotal = ioiApproved.reduce((s, i) => s + (i.amount || 0), 0);
      const targetAlloc = deal.target_alloc_usd || 0;
      const pctSubscribed = targetAlloc > 0 ? Math.round(approvedTotal / targetAlloc * 100) : 0;

      const ioi_summary = {
        total: ioiTotal,
        approved: ioiApproved.length,
        pending: ioiPending.length,
        declined: ioiDeclined.length,
        approved_total: approvedTotal,
        pct_subscribed: pctSubscribed,
      };

      // Fetch advisor info
      let advisor_name = null, advisor_firm = null, advisor_email = null;
      if (deal.advisor_id && deal.advisor_id.startsWith('adv-')) {
        const adv = await kvGet(`advisor:${deal.advisor_id}`);
        if (adv) {
          advisor_name = adv.name || null;
          advisor_firm = adv.firm_name || null;
          advisor_email = adv.email || null;
        }
      }

      // Fetch docs from deal_doc slots (metadata only — no binary data)
      const docSlots = ['nda', 'mgmt', 'fin', 'term'];
      const docs = [];
      await Promise.all(docSlots.map(async slot => {
        const doc = await kvGet(`deal_doc:${dealId}:${slot}`);
        if (doc) docs.push({ slot, name: doc.name, type: doc.type });
      }));

      // Prism economics — read from deal, fall back to defaults
      const fee_pct = deal.prism_fee_pct ?? 1.5;
      const carry_pct = deal.prism_carry_pct ?? 10;
      const mgmt_fee_pct = deal.prism_mgmt_fee_pct ?? 0.5;
      const projected_fee_revenue = Math.round(targetAlloc * fee_pct / 100);
      const projected_mgmt_revenue = Math.round(targetAlloc * mgmt_fee_pct / 100);
      const projected_carry = 0; // complex; show 0 until realized
      const total_projected_revenue = projected_fee_revenue + projected_mgmt_revenue + projected_carry;

      const prism_economics = {
        fee_pct,
        carry_pct,
        mgmt_fee_pct,
        projected_fee_revenue,
        projected_carry,
        projected_mgmt_revenue,
        total_projected_revenue,
      };

      // Recent audit — last 10 entries, newest first
      const recent_audit = (deal.audit_log || []).slice(-10).reverse();

      const enriched = {
        ...deal,
        platform_alloc_usd: deal.platform_alloc_usd || null,
        platform_min_ticket_usd: deal.platform_min_ticket_usd || null,
        company_overview: deal.company_overview || '',
        admin_notes: deal.admin_notes || '',
        ioi_summary,
        iois: dealIois.map(i => ({
          id: i.id,
          investor_firm: i.investor_firm || i.investor_email || i.investor_id,
          institution_type: i.institution_type || '',
          geo: i.geo || '',
          amount: i.amount || 0,
          status: i.status,
          submitted_at: i.submitted_at,
          pushed: i.pushed || false,
          data_room_access: i.data_room_access || false,
        })),
        docs: docs.length ? docs : (deal.docs || []),
        advisor_name,
        advisor_firm,
        advisor_email,
        prism_economics,
        recent_audit,
      };

      return ok(res, { deal: enriched });
    }

    // ── update-prism-economics ─────────────────────────────────────
    if (op === 'update-prism-economics') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const { dealId, fee_pct, carry_pct, mgmt_fee_pct } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');

      const parsedFee = parseFloat(fee_pct);
      const parsedCarry = parseFloat(carry_pct);
      const parsedMgmt = parseFloat(mgmt_fee_pct);
      if (isNaN(parsedFee) || isNaN(parsedCarry) || isNaN(parsedMgmt)) {
        return bad(res, 'fee_pct, carry_pct, and mgmt_fee_pct must be numbers');
      }

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const now = new Date().toISOString();
      const prev = {
        prism_fee_pct: deal.prism_fee_pct ?? 1.5,
        prism_carry_pct: deal.prism_carry_pct ?? 10,
        prism_mgmt_fee_pct: deal.prism_mgmt_fee_pct ?? 0.5,
      };

      deal.prism_fee_pct = parsedFee;
      deal.prism_carry_pct = parsedCarry;
      deal.prism_mgmt_fee_pct = parsedMgmt;
      deal.updated_at = now;
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({
        at: now,
        actor: admin.email,
        action: 'prism_economics_updated',
        meta: {
          from: prev,
          to: { prism_fee_pct: parsedFee, prism_carry_pct: parsedCarry, prism_mgmt_fee_pct: parsedMgmt },
        },
      });

      await saveDeal(deal);
      return ok(res, { ok: true, deal });
    }

    // ── push-preview ──────────────────────────────────────────────
    if (op === 'push-preview') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      // Fetch IOIs for this deal
      const allIois = await getAllIois();
      const dealIois = allIois.filter(i => i.deal_id === dealId);
      const approvedIois = dealIois.filter(i => i.status === 'approved');

      const approvedTotal = approvedIois.reduce((s, i) => s + (i.amount || 0), 0);
      const targetAlloc = deal.target_alloc_usd || 0;
      const pctOfTarget = targetAlloc > 0 ? Math.round(approvedTotal / targetAlloc * 100) : 0;
      const alreadyPushed = approvedIois.some(i => i.pushed === true);

      // Type breakdown
      const typeMap = {};
      for (const ioi of approvedIois) {
        const t = ioi.institution_type || 'Unknown';
        if (!typeMap[t]) typeMap[t] = { type: t, count: 0, amount: 0 };
        typeMap[t].count += 1;
        typeMap[t].amount += ioi.amount || 0;
      }

      // Geo breakdown
      const geoMap = {};
      for (const ioi of approvedIois) {
        const g = ioi.geo || 'Unknown';
        if (!geoMap[g]) geoMap[g] = { geo: g, count: 0, amount: 0 };
        geoMap[g].count += 1;
        geoMap[g].amount += ioi.amount || 0;
      }

      // Advisor info
      let advisorName = '', advisorFirm = '';
      if (deal.advisor_id && deal.advisor_id.startsWith('adv-')) {
        const adv = await kvGet(`advisor:${deal.advisor_id}`);
        if (adv) { advisorName = adv.name || ''; advisorFirm = adv.firm_name || ''; }
      }

      let suggestedAction = 'No approved IOIs yet — review pending indications before pushing.';
      if (approvedIois.length > 0 && alreadyPushed) {
        suggestedAction = 'Package already pushed. Re-push will update the advisor with current approved IOIs.';
      } else if (approvedIois.length > 0 && pctOfTarget >= 80) {
        suggestedAction = 'Round substantially covered — schedule close calls with approved investors.';
      } else if (approvedIois.length > 0) {
        suggestedAction = 'Schedule close calls with approved investors.';
      }

      return ok(res, {
        preview: {
          dealId,
          dealName: deal.name,
          advisorName,
          advisorFirm,
          approvedCount: approvedIois.length,
          approvedTotal,
          targetAlloc,
          pctOfTarget,
          typeBreakdown: Object.values(typeMap),
          geoBreakdown: Object.values(geoMap),
          alreadyPushed,
          suggestedAction,
        },
      });
    }

    // ── push-package ──────────────────────────────────────────────
    if (op === 'push-package') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const { dealId, comment } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      // Collect all IOIs for this deal
      const allIois = await getAllIois();
      const dealIois = allIois.filter(i => i.deal_id === dealId);
      const approvedIois = dealIois.filter(i => i.status === 'approved');

      const indicatedTotal = approvedIois.reduce((s, i) => s + (i.amount || 0), 0);
      const targetAlloc = deal.target_alloc_usd || 0;

      const pkg = {
        packageId: `pkg_${dealId}_${Date.now()}`,
        dealId,
        dealName: deal.name,
        generatedAt: new Date().toISOString(),
        targetAlloc,
        indicatedTotal,
        pct: targetAlloc > 0 ? Math.round(indicatedTotal / targetAlloc * 100) : 0,
        raise_status: deal.raise_status || 'open',
        admin_comment: comment || '',
        iois: approvedIois.map(i => ({
          id: i.id,
          name: i.investor_firm || i.investor_email || i.investor_id,
          type: i.institution_type || '',
          geo: i.geo || '',
          amount: i.amount || 0,
          date: i.submitted_at,
        })),
        advisorId: deal.advisor_id,
      };

      // Persist package
      await kvSet(`package:${pkg.packageId}`, pkg);

      // Append packageId to the deal's package list (stored as JSON array)
      const listKey = `packages:deal:${dealId}`;
      const existing = await kvGet(listKey);
      const pkgList = existing ? (Array.isArray(existing) ? existing : JSON.parse(existing)) : [];
      pkgList.push(pkg.packageId);
      await kvSet(listKey, pkgList);

      // Mark all approved IOIs as pushed on their records
      await Promise.all(approvedIois.map(async ioi => {
        ioi.pushed = true;
        ioi.pushed_at = new Date().toISOString();
        await kvSet(`ioi:${ioi.id}`, ioi);
      }));

      // Audit log on deal + auto-advance to DD
      deal.audit_log = deal.audit_log || [];
      const prevStage = deal.stage;
      deal.stage = 'dd';
      deal.audit_log.push({
        at: new Date().toISOString(),
        actor: admin.email,
        action: 'package_pushed',
        meta: { packageId: pkg.packageId, approvedCount: approvedIois.length, indicatedTotal },
      });
      deal.audit_log.push({
        at: new Date().toISOString(),
        actor: 'system',
        action: 'stage_changed',
        meta: { from: prevStage, to: 'dd', trigger: 'package_pushed' },
      });

      // In-app notification for advisor
      const pushedAt = new Date().toISOString();
      deal.notifications = deal.notifications || [];
      deal.notifications.push({
        id: `notif_${Date.now()}`,
        type: 'ioi_pushed',
        ioi_id: pkg.packageId,
        investor_firm: approvedIois.length === 1
          ? (approvedIois[0].investor_firm || approvedIois[0].investor_email || 'Investor')
          : `${approvedIois.length} investors`,
        amount: indicatedTotal,
        pushed_at: pushedAt,
        read: false,
      });

      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);

      // Notify advisor — aggregate stats only, no investor names (compliance boundary)
      if (deal.advisor_id && deal.advisor_id.startsWith('adv-')) {
        try {
          const adv = await kvGet(`advisor:${deal.advisor_id}`);
          if (adv?.email) {
            const pct = targetAlloc > 0 ? Math.round(indicatedTotal / targetAlloc * 100) : 0;

            // Build type breakdown
            const typeMap = {};
            for (const ioi of approvedIois) {
              const t = ioi.institution_type || 'Other';
              typeMap[t] = (typeMap[t] || 0) + (ioi.amount || 0);
            }

            // Build geo breakdown
            const geoMap = {};
            for (const ioi of approvedIois) {
              const g = ioi.geo || 'Other';
              geoMap[g] = (geoMap[g] || 0) + (ioi.amount || 0);
            }

            await sendIoiPackage({
              to: adv.email,
              advisor_name: adv.name || '',
              advisor_firm: adv.firm_name || '',
              deal_name: deal.name,
              approved_count: approvedIois.length,
              indicated_total: indicatedTotal,
              target_alloc: targetAlloc,
              pct,
              type_breakdown: Object.entries(typeMap).map(([label, amount]) => ({ label, amount })),
              geo_breakdown: Object.entries(geoMap).map(([label, amount]) => ({ label, amount })),
              package_id: pkg.packageId,
              generated_at: pkg.generatedAt,
              admin_comment: comment || '',
            });
          }
        } catch (emailErr) {
          console.error('[push-package] advisor email failed (non-fatal):', emailErr.message);
        }
      }

      return ok(res, { ok: true, package: pkg });
    }

    // ── send-to-advisor-review ────────────────────────────────────
    if (op === 'send-to-advisor-review') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId, thesis, tagline, highlights } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      // Promote AI draft fields to top-level so advisor can read them
      if (deal.ai_draft) {
        if (!deal.thesis && deal.ai_draft.thesis) deal.thesis = deal.ai_draft.thesis;
        if (!deal.tagline && deal.ai_draft.tagline) deal.tagline = deal.ai_draft.tagline;
        if ((!deal.highlights || !deal.highlights.length) && deal.ai_draft.highlights?.length) {
          deal.highlights = deal.ai_draft.highlights.map(h => ({
            icon: h.icon || '◆',
            s: h.s || h.title || '',
            b: h.b || h.body || '',
          }));
        }
      }

      // Accept explicit overrides from request body (admin sending content directly)
      if (thesis) deal.thesis = thesis;
      if (tagline) deal.tagline = tagline;
      if (highlights) deal.highlights = highlights;

      deal.advisor_review_status = 'pending';
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: new Date().toISOString(), actor: admin.email, action: 'sent_for_advisor_review', meta: { promoted_ai_draft: !!deal.ai_draft } });

      deal.notifications = deal.notifications || [];
      deal.notifications.push({
        id: `notif_${Date.now()}`,
        type: 'deal_review_requested',
        deal_name: deal.name,
        sent_at: new Date().toISOString(),
        read: false,
      });

      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
      return ok(res, { ok: true });
    }

    // ── send-subscription-doc ─────────────────────────────────────
    // Send a subscription agreement PDF to an investor for e-signature via DocuSign.
    // STUBBED until DOCUSIGN_ACCESS_TOKEN + DOCUSIGN_ACCOUNT_ID are set — see api/_lib/docusign.js.
    // Stores deal.subscriptionEnvelopeId when sent; sets deal.subscriptionSigned = true when complete.
    if (op === 'send-subscription-doc') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId, investorId } = req.body || {};
      if (!dealId || !investorId) return bad(res, 'dealId and investorId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      const inst = await kvGet(`inst:${investorId}`);
      if (!inst) return bad(res, 'Investor not found', 404);

      // Load the subscription document from deal_doc slot 'term' (term sheet / sub doc)
      const subDoc = await kvGet(`deal_doc:${dealId}:term`);
      const documentBase64 = subDoc?.data || null;

      console.log(`[v2] send-subscription-doc: deal=${dealId} investor=${investorId}`);

      const result = await sendSubscriptionDocument(
        inst.email,
        inst.contact_name || inst.firm_name,
        deal.name,
        documentBase64
      );

      if (!result.stubbed && result.envelopeId) {
        deal.subscriptionEnvelopeId = result.envelopeId;
        deal.subscriptionSentAt = new Date().toISOString();
        deal.subscriptionSentTo = investorId;
        deal.audit_log = deal.audit_log || [];
        deal.audit_log.push({
          at: new Date().toISOString(),
          actor: admin.email,
          action: 'subscription_doc_sent',
          meta: { investorId, envelopeId: result.envelopeId },
        });
        deal.updated_at = new Date().toISOString();
        await saveDeal(deal);
      }

      return ok(res, { ok: true, ...result });
    }

    // ── check-subscription-status ─────────────────────────────────
    // Poll DocuSign for envelope completion and update deal.subscriptionSigned.
    // STUBBED until DOCUSIGN_ACCESS_TOKEN + DOCUSIGN_ACCOUNT_ID are set.
    if (op === 'check-subscription-status') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (!deal.subscriptionEnvelopeId) {
        return ok(res, { status: 'not_sent', subscriptionSigned: false });
      }

      const statusResult = await checkEnvelopeStatus(deal.subscriptionEnvelopeId);

      if (statusResult.status === 'completed' && !deal.subscriptionSigned) {
        deal.subscriptionSigned = true;
        deal.subscriptionSignedAt = statusResult.completedAt || new Date().toISOString();
        deal.audit_log = deal.audit_log || [];
        deal.audit_log.push({
          at: new Date().toISOString(),
          actor: 'system',
          action: 'subscription_signed',
          meta: { envelopeId: deal.subscriptionEnvelopeId },
        });
        deal.updated_at = new Date().toISOString();
        await saveDeal(deal);
      }

      return ok(res, {
        ok: true,
        envelopeId: deal.subscriptionEnvelopeId,
        subscriptionSigned: deal.subscriptionSigned || false,
        ...statusResult,
      });
    }

    // ── kyc-status ────────────────────────────────────────────────
    // Poll KYC/AML status for an investor and update investor record.
    // STUBBED until KYC_PROVIDER_API_KEY is set — see api/_lib/kyc.js.
    if (op === 'kyc-status') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { inst_id } = req.query;
      if (!inst_id) return bad(res, 'inst_id required');

      const inst = await kvGet(`inst:${inst_id}`);
      if (!inst) return bad(res, 'Investor not found', 404);
      if (!inst.kycCheckId) {
        return ok(res, { kycStatus: 'not_initiated', kycCheckId: null });
      }

      const statusResult = await getKycStatus(inst.kycCheckId);
      inst.kycStatus = statusResult.status;
      if (statusResult.result) inst.kycResult = statusResult.result;
      inst.kycLastChecked = new Date().toISOString();
      await kvSet(`inst:${inst_id}`, inst);

      return ok(res, { ok: true, kycCheckId: inst.kycCheckId, ...statusResult });
    }

    // ── delete-investor (PDPA deletion) ──────────────────────────
    if (op === 'delete-investor') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { investorId } = req.body || {};
      if (!investorId) return bad(res, 'investorId required');
      const inst = await kvGet(`inst:${investorId}`);
      if (!inst) return bad(res, 'Investor not found', 404);

      let keysRemoved = 0;

      // Delete main record and email/code lookups
      await kvDel(`inst:${investorId}`); keysRemoved++;
      if (inst.email) { await kvDel(`inst_email:${inst.email.toLowerCase()}`); keysRemoved++; }
      if (inst.code) { await kvDel(`inst_code:${inst.code}`); keysRemoved++; }

      // Delete all IOI records belonging to this investor
      const delAllIois = await getAllIois();
      const investorIois = delAllIois.filter(i => i.investor_id === investorId);
      for (const ioi of investorIois) {
        await kvDel(`ioi:${ioi.id}`); keysRemoved++;
        await kvZrem('ioi_index', ioi.id);
        await kvDel(`ioi_exists:${ioi.deal_id}:${investorId}`); keysRemoved++;
        // P-6: only decrement the deal counters if the IOI was actually
        // counted (rejected IOIs are excluded from ioi_count / ioi_agg_usd).
        if (ioi.status !== 'rejected') {
          await bumpIoiCounters(ioi.deal_id, -1, -(ioi.amount || 0));
        }
      }
      try {
        await kvDel('cache:iois:all');
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}

      // Delete NDA signature records
      const ndaKeys = await kvKeys(`nda_signed:${investorId}:*`);
      for (const k of ndaKeys) { await kvDel(k); keysRemoved++; }

      console.log(`[PDPA] Investor ${investorId} deleted by ${admin.email} — ${keysRemoved} keys removed`);
      return ok(res, { deleted: true, keysRemoved });
    }

    // ── audit-log (append-only sorted set read) ───────────────────
    if (op === 'audit-log') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const entries = await kvZrange(`audit:${dealId}`, 0, -1, { rev: false });
      const parsed = entries.map(e => { try { return JSON.parse(e); } catch { return e; } });
      return ok(res, { dealId, log: parsed });
    }

    // ── unassigned-deals (admin) — list deals without an advisor + active advisors ──
    if (op === 'unassigned-deals') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const allDeals = await listDeals();
      const orphans = allDeals
        .filter(d => !d.advisor_id || (typeof d.advisor_id === 'string' && !d.advisor_id.startsWith('adv-')))
        .map(d => ({ id: d.id, name: d.name, stage: d.stage, created_at: d.created_at || null }));
      const advKeys = await kvKeys('advisor:adv-*');
      const advisors = (await Promise.all(advKeys.map(k => kvGet(k))))
        .filter(a => a && a.status === 'active')
        .map(a => ({ id: a.id, name: a.name || '', firm: a.firm_name || '', email: a.email }));
      return ok(res, { deals: orphans, advisors });
    }

    // ── assign-advisor (admin) ────────────────────────────────────
    if (op === 'assign-advisor') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId, advisorId } = req.body || {};
      if (!dealId || !advisorId) return bad(res, 'dealId and advisorId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      const adv = await kvGet(`advisor:${advisorId}`);
      if (!adv) return bad(res, 'Advisor not found', 404);
      const prev = deal.advisor_id || null;
      deal.advisor_id = advisorId;
      deal.advisor_admin_mode = false;
      deal.updated_at = new Date().toISOString();
      const auditEntry = { at: deal.updated_at, actor: admin.email, action: 'advisor_assigned', meta: { by_admin: admin.email, advisor_id: advisorId, prev_advisor_id: prev } };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(auditEntry);
      await saveDeal(deal);
      await appendAuditEntry(dealId, auditEntry);
      return ok(res, { ok: true });
    }

    // ── advisor-banking (admin) — full unmasked record + audit view ──
    if (op === 'advisor-banking') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { advisorId } = req.query;
      if (!advisorId) return bad(res, 'advisorId required');
      const rec = await kvGet(`advisor_banking:${advisorId}`);
      const viewedAt = new Date().toISOString();
      // Audit the view on the advisor's audit trail (no PII in the audit payload)
      await kvZadd(`audit:advisor:${advisorId}`, Date.now(), JSON.stringify({
        at: viewedAt, actor: admin.email, action: 'banking_viewed', meta: { viewer_admin_id: admin.email, viewed_at: viewedAt },
      }));
      return ok(res, { banking: rec || null });
    }

    // ── capital-call-notify ───────────────────────────────────────
    if (op === 'capital-call-notify') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId, investorIds } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const ccDeal = await getDeal(dealId);
      if (!ccDeal) return bad(res, 'Deal not found', 404);

      let ccTargetIds = investorIds;
      if (!ccTargetIds?.length) {
        const ccAllIois = await getAllIois();
        ccTargetIds = ccAllIois
          .filter(i => i.deal_id === dealId && i.status === 'approved' && i.investor_id.startsWith('inv-'))
          .map(i => i.investor_id);
      }

      let ccSent = 0;
      const ccNoticeBatchId = Date.now().toString(36);
      const ccNowIso = new Date().toISOString();
      const ccDateIssued = ccNowIso.slice(0, 10);
      // Pre-fetch IOIs once so we can attach per-investor capital-call amount.
      const ccAllIoisForNotice = await getAllIois();
      for (const invId of (ccTargetIds || [])) {
        const inv = await kvGet(`inst:${invId}`);
        if (!inv) continue;
        await sendCapitalCallNotice(inv, ccDeal).catch(console.error);
        // Persist per-investor notice record for the Notices tab.
        const investorIoi = ccAllIoisForNotice.find(i => i.deal_id === dealId && i.investor_id === invId && i.status === 'approved');
        const noticeId = `cc-${dealId}-${invId}-${ccNoticeBatchId}`;
        await kvSet(`notice:${invId}:${noticeId}`, {
          id: noticeId,
          type: 'capital_call',
          deal_id: dealId,
          deal_name: ccDeal.name,
          status: 'pending',
          date_issued: ccDateIssued,
          amount: investorIoi?.amount || null,
          wire_instructions: null,
          reference: noticeId.toUpperCase(),
          due_date: null,
          notes: req.body?.notes || null,
          created_at: ccNowIso,
        });
        ccSent++;
      }

      const ccAuditEntry = { at: new Date().toISOString(), actor: admin.email, action: 'capital_call_issued', meta: { dealId, recipientCount: ccSent } };
      ccDeal.audit_log = ccDeal.audit_log || [];
      ccDeal.audit_log.push(ccAuditEntry);
      ccDeal.updated_at = new Date().toISOString();
      await saveDeal(ccDeal);
      await appendAuditEntry(dealId, ccAuditEntry);
      return ok(res, { ok: true, sent: ccSent });
    }

    // ── distribution-notify ───────────────────────────────────────
    if (op === 'distribution-notify') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId, investorIds } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const distDeal = await getDeal(dealId);
      if (!distDeal) return bad(res, 'Deal not found', 404);

      let distTargetIds = investorIds;
      if (!distTargetIds?.length) {
        const distAllIois = await getAllIois();
        distTargetIds = distAllIois
          .filter(i => i.deal_id === dealId && i.status === 'approved' && i.investor_id.startsWith('inv-'))
          .map(i => i.investor_id);
      }

      let distSent = 0;
      const distNoticeBatchId = Date.now().toString(36);
      const distNowIso = new Date().toISOString();
      const distDateIssued = distNowIso.slice(0, 10);
      const distAllIoisForNotice = await getAllIois();
      const distApprovedTotal = distAllIoisForNotice
        .filter(i => i.deal_id === dealId && i.status === 'approved')
        .reduce((s, i) => s + (i.amount || 0), 0);
      const distPoolUsd = parseFloat(req.body?.amount) || distDeal.deployed_usd || 0;
      for (const invId of (distTargetIds || [])) {
        const inv = await kvGet(`inst:${invId}`);
        if (!inv) continue;
        await sendDistributionNotice(inv, distDeal).catch(console.error);
        const investorIoi = distAllIoisForNotice.find(i => i.deal_id === dealId && i.investor_id === invId && i.status === 'approved');
        // Distribution amount = investor's pro-rata share of the distribution pool.
        const share = (investorIoi && distApprovedTotal > 0) ? (investorIoi.amount / distApprovedTotal) : 0;
        const investorAmount = distPoolUsd > 0 && share > 0 ? Math.round(distPoolUsd * share) : null;
        const noticeId = `dist-${dealId}-${invId}-${distNoticeBatchId}`;
        await kvSet(`notice:${invId}:${noticeId}`, {
          id: noticeId,
          type: 'distribution',
          deal_id: dealId,
          deal_name: distDeal.name,
          status: 'pending',
          date_issued: distDateIssued,
          amount: investorAmount,
          wire_instructions: null,
          reference: noticeId.toUpperCase(),
          due_date: null,
          notes: req.body?.notes || null,
          created_at: distNowIso,
        });
        distSent++;
      }

      const distAuditEntry = { at: new Date().toISOString(), actor: admin.email, action: 'distribution_issued', meta: { dealId, recipientCount: distSent } };
      distDeal.audit_log = distDeal.audit_log || [];
      distDeal.audit_log.push(distAuditEntry);
      distDeal.updated_at = new Date().toISOString();
      await saveDeal(distDeal);
      await appendAuditEntry(dealId, distAuditEntry);
      return ok(res, { ok: true, sent: distSent });
    }

    // ── qa-cron (daily 9am UTC — Vercel cron or admin-triggered) ──
    if (op === 'qa-cron') {
      const cronSecret = process.env.CRON_SECRET;
      const cronHeader = req.headers['authorization'];
      const isCronCall = cronSecret && cronHeader === `Bearer ${cronSecret}`;
      const cronAdmin = await getAdmin();
      if (!cronAdmin && !isCronCall) return unauth(res);

      const pendingKeys = await kvKeys('qa_pending:*');
      const nowMs = Date.now();
      const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

      // Group by deal so we send one batched reminder per deal
      const dealMap = {};
      for (const key of pendingKeys) {
        const raw = await kvGet(key);
        if (!raw) continue;
        let pending;
        try { pending = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
        if (pending.reminderSent) continue;
        if (nowMs - new Date(pending.submittedAt).getTime() < TWENTY_FOUR_H) continue;
        if (!dealMap[pending.dealId]) dealMap[pending.dealId] = [];
        dealMap[pending.dealId].push({ key, pending });
      }

      let remindersSent = 0;
      for (const [cronDealId, items] of Object.entries(dealMap)) {
        const cronDeal = await getDeal(cronDealId);
        if (!cronDeal?.advisor_id?.startsWith('adv-')) continue;
        const cronAdvisor = await kvGet(`advisor:${cronDeal.advisor_id}`);
        if (!cronAdvisor?.email) continue;
        await sendQaReminder(cronAdvisor, cronDeal.name, items.length).catch(console.error);
        remindersSent++;
        for (const { key, pending } of items) {
          pending.reminderSent = true;
          await kvSet(key, JSON.stringify(pending), { ex: 86400 });
        }
      }

      return ok(res, { ok: true, remindersSent, dealsChecked: Object.keys(dealMap).length });
    }

    // ── match-investors ───────────────────────────────────────────
    // GET resource=admin&op=match-investors&dealId=X
    // Returns ranked investor matches for a deal
    if (op === 'match-investors') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const matchAllIois = await getAllIois();
      const dealIois = matchAllIois.filter(i => i.deal_id === dealId);
      const existingIoiByInvestor = {};
      for (const ioi of dealIois) {
        existingIoiByInvestor[ioi.investor_id] = ioi.status;
      }

      const instKeys = await kvKeys('inst:inv-*');
      const allInvestors = (await Promise.all(instKeys.map(k => kvGet(k)))).filter(Boolean);

      const matches = allInvestors.map(investor => {
        const reasons = [];
        let score = 0;

        // Factor 1: asset_class match
        const prefClasses = Array.isArray(investor.preferred_asset_classes) ? investor.preferred_asset_classes : [];
        if (deal.asset_class && prefClasses.length > 0) {
          if (prefClasses.some(c => c.toLowerCase() === (deal.asset_class || '').toLowerCase())) {
            score++;
            reasons.push('asset_class_match');
          }
        }

        // Factor 2: geography match
        const prefGeos = Array.isArray(investor.preferred_geographies) ? investor.preferred_geographies : [];
        if (deal.geography && prefGeos.length > 0) {
          if (prefGeos.some(g => g.toLowerCase() === (deal.geography || '').toLowerCase())) {
            score++;
            reasons.push('geography_match');
          }
        }

        // Factor 3: investment capacity >= minimum_investment
        const capacity = parseFloat(investor.investment_capacity) || 0;
        const minInv = parseFloat(deal.min_ticket_usd || deal.minimum_investment) || 0;
        if (capacity > 0 && minInv > 0 && capacity >= minInv) {
          score++;
          reasons.push('capacity_sufficient');
        }

        // Factor 4: no prior rejected IOI
        const priorStatus = existingIoiByInvestor[investor.id];
        if (priorStatus !== 'rejected') {
          score++;
          reasons.push('no_prior_rejection');
        }

        // Factor 5: no existing IOI (investor hasn't already submitted)
        const alreadyHasIoi = priorStatus === 'approved' || priorStatus === 'pending';
        if (!alreadyHasIoi) {
          score++;
          reasons.push('no_existing_ioi');
        }

        return {
          investorId: investor.id,
          name: investor.contact_name || investor.firm_name,
          firm: investor.firm_name,
          email: investor.email,
          status: investor.status,
          score,
          matchReasons: reasons,
          alreadyHasIoi,
        };
      });

      matches.sort((a, b) => b.score - a.score);
      return ok(res, { dealId, matches });
    }

    // ── compliance-cron ───────────────────────────────────────────
    // POST/GET resource=admin&op=compliance-cron
    // Also accepts Authorization: Bearer {CRON_SECRET}
    if (op === 'compliance-cron') {
      const cronSecret = process.env.CRON_SECRET;
      const cronHeader = req.headers['authorization'];
      const isCronCall = cronSecret && cronHeader === `Bearer ${cronSecret}`;
      const compAdmin = await getAdmin();
      if (!compAdmin && !isCronCall) return unauth(res);

      const compInstKeys = await kvKeys('inst:inv-*');
      const compInvestors = (await Promise.all(compInstKeys.map(k => kvGet(k)))).filter(Boolean);

      // Fetch all IOIs once to check which investors have active IOIs
      const compAllIois = await getAllIois();
      const investorWithActiveIoi = new Set(
        compAllIois
          .filter(i => i.status === 'approved' || i.status === 'pending')
          .map(i => i.investor_id)
      );

      const now = Date.now();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const flaggedResults = [];
      let flaggedCount = 0;

      for (const investor of compInvestors) {
        const flags = [];

        // KYC check: pending/failed AND initiated > 30 days ago
        if ((investor.kycStatus === 'pending' || investor.kycStatus === 'failed') && investor.kycInitiatedAt) {
          const initiatedMs = new Date(investor.kycInitiatedAt).getTime();
          if (!isNaN(initiatedMs) && (now - initiatedMs) > THIRTY_DAYS_MS) {
            flags.push('compliance_review_needed');
          }
        }

        // NDA check: has active IOIs but no NDA signed
        if (investorWithActiveIoi.has(investor.id) && !investor.ndaSigned) {
          flags.push('nda_missing');
        }

        // Access code expiry check
        if (investor.accessCodeExpiry) {
          const expiryMs = new Date(investor.accessCodeExpiry).getTime();
          if (!isNaN(expiryMs) && expiryMs > now && (expiryMs - now) < SEVEN_DAYS_MS) {
            flags.push('access_expiring');
          }
        }

        if (flags.length > 0) {
          const flagRecord = {
            investorId: investor.id,
            name: investor.contact_name || investor.firm_name,
            email: investor.email,
            flags,
            checkedAt: new Date().toISOString(),
          };
          // TTL: 32 days
          await kvSet(`compliance_flag:${investor.id}`, flagRecord, { ex: 32 * 24 * 60 * 60 });
          flaggedResults.push(flagRecord);
          flaggedCount++;
        }
      }

      return ok(res, {
        checked: compInvestors.length,
        flagged: flaggedCount,
        flags: flaggedResults,
      });
    }

    // ── compliance-flags ──────────────────────────────────────────
    // GET resource=admin&op=compliance-flags — all current compliance flag records
    if (op === 'compliance-flags') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const flagKeys = await kvKeys('compliance_flag:*');
      const flags = (await Promise.all(flagKeys.map(k => kvGet(k)))).filter(Boolean);
      flags.sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''));
      return ok(res, { flags, count: flags.length });
    }

    // ── generate-statements ───────────────────────────────────────
    // POST resource=admin&op=generate-statements&dealId=X
    // Generates quarterly statements for all approved IOI holders on a deal
    if (op === 'generate-statements') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const dealId = req.query.dealId || (req.body || {}).dealId;
      if (!dealId) return bad(res, 'dealId required');

      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const stmtAllIois = await getAllIois();
      const stmtApproved = stmtAllIois.filter(i => i.deal_id === dealId && i.status === 'approved' && i.investor_id.startsWith('inv-'));

      const now = new Date();
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      const period = `Q${quarter} ${now.getFullYear()}`;
      const generatedAt = now.toISOString();

      const generated = [];
      for (const ioi of stmtApproved) {
        const totalCommitmentForDeal = deal.totalCommitment || deal.ioi_agg_usd || 0;
        const totalNavUsd = deal.totalNavUsd || 0;
        const currentValue = totalCommitmentForDeal > 0 && (ioi.amount || 0) > 0
          ? ((ioi.amount || 0) / totalCommitmentForDeal) * totalNavUsd
          : 0;

        // Collect distributions for this investor/deal
        const stmtDistKeys = await kvKeys(`distribution:${dealId}:*`);
        const stmtDists = (await Promise.all(stmtDistKeys.map(k => kvGet(k)))).filter(Boolean);
        const investorDists = [];
        for (const dist of stmtDists) {
          const myEntry = (dist.perInvestorAmounts || []).find(e => e.investorId === ioi.investor_id);
          if (myEntry) {
            investorDists.push({
              distributionId: dist.distributionId,
              type: dist.distributionType,
              date: dist.distributionDate,
              amount: myEntry.distributionAmount,
            });
          }
        }

        const statement = {
          investorId: ioi.investor_id,
          dealId,
          period,
          generatedAt,
          nav: deal.currentNav || null,
          navAsOf: deal.navAsOf || null,
          investorCommitment: ioi.amount || 0,
          currentValue: Math.round(currentValue * 100) / 100,
          distributions: investorDists,
          status: 'generated',
        };

        const stmtKey = `statement:${dealId}:${ioi.investor_id}:${period.replace(/ /g, '_')}`;
        await kvSet(stmtKey, statement);

        // Email investor
        const stmtInv = await kvGet(`inst:${ioi.investor_id}`);
        if (stmtInv) {
          await sendStatementAvailable(stmtInv, { dealName: deal.name, period }).catch(console.error);
        }
        generated.push({ investorId: ioi.investor_id, stmtKey, period });
      }

      return ok(res, { ok: true, dealId, period, generated: generated.length, statements: generated });
    }

    // ── statements (admin) ────────────────────────────────────────
    // GET resource=admin&op=statements&dealId=X — all statements for a deal
    if (op === 'statements') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const adminStmtKeys = await kvKeys(`statement:${dealId}:*`);
      const adminStatements = (await Promise.all(adminStmtKeys.map(k => kvGet(k)))).filter(Boolean);
      adminStatements.sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
      return ok(res, { statements: adminStatements, count: adminStatements.length });
    }

    // ── generate-statements-cron ──────────────────────────────────
    // POST resource=admin&op=generate-statements-cron
    // Quarterly cron: scans all active deals and generates statements
    if (op === 'generate-statements-cron') {
      const cronSecret = process.env.CRON_SECRET;
      const cronHeader = req.headers['authorization'];
      const isCronCall = cronSecret && cronHeader === `Bearer ${cronSecret}`;
      const cronAdmin = await getAdmin();
      if (!cronAdmin && !isCronCall) return unauth(res);

      const activeStages = ['live', 'dd', 'terms', 'close'];
      const cronDeals = await listDeals();
      const targetDeals = cronDeals.filter(d => activeStages.includes(d.stage));

      const now = new Date();
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      const period = `Q${quarter} ${now.getFullYear()}`;
      const cronGeneratedAt = now.toISOString();

      let totalGenerated = 0;
      const dealResults = [];

      // Fetch all IOIs once outside the per-deal loop to avoid redundant round trips
      const cronStmtAllIois = await getAllIois();
      for (const deal of targetDeals) {
        const cronApproved = cronStmtAllIois.filter(i => i.deal_id === deal.id && i.status === 'approved' && i.investor_id.startsWith('inv-'));

        let dealStatementCount = 0;
        for (const ioi of cronApproved) {
          const stmtKey = `statement:${deal.id}:${ioi.investor_id}:${period.replace(/ /g, '_')}`;
          const existing = await kvGet(stmtKey);
          if (existing) continue; // already generated for this period

          const totalCommitmentForDeal = deal.totalCommitment || deal.ioi_agg_usd || 0;
          const totalNavUsd = deal.totalNavUsd || 0;
          const currentValue = totalCommitmentForDeal > 0 && (ioi.amount || 0) > 0
            ? ((ioi.amount || 0) / totalCommitmentForDeal) * totalNavUsd
            : 0;

          const cronStmtDistKeys = await kvKeys(`distribution:${deal.id}:*`);
          const cronStmtDists = (await Promise.all(cronStmtDistKeys.map(k => kvGet(k)))).filter(Boolean);
          const investorDists = [];
          for (const dist of cronStmtDists) {
            const myEntry = (dist.perInvestorAmounts || []).find(e => e.investorId === ioi.investor_id);
            if (myEntry) {
              investorDists.push({ distributionId: dist.distributionId, type: dist.distributionType, date: dist.distributionDate, amount: myEntry.distributionAmount });
            }
          }

          const statement = {
            investorId: ioi.investor_id,
            dealId: deal.id,
            period,
            generatedAt: cronGeneratedAt,
            nav: deal.currentNav || null,
            navAsOf: deal.navAsOf || null,
            investorCommitment: ioi.amount || 0,
            currentValue: Math.round(currentValue * 100) / 100,
            distributions: investorDists,
            status: 'generated',
          };
          await kvSet(stmtKey, statement);

          const cronInv = await kvGet(`inst:${ioi.investor_id}`);
          if (cronInv) await sendStatementAvailable(cronInv, { dealName: deal.name, period }).catch(console.error);
          dealStatementCount++;
          totalGenerated++;
        }
        if (dealStatementCount > 0) dealResults.push({ dealId: deal.id, dealName: deal.name, generated: dealStatementCount });
      }

      return ok(res, { ok: true, period, dealsProcessed: targetDeals.length, totalGenerated, deals: dealResults });
    }

    // ── welcome-cron ──────────────────────────────────────────────
    // GET/POST resource=admin&op=welcome-cron — daily 8am UTC
    // Sends Day 2 and Day 7 welcome sequence emails to newly approved investors
    if (op === 'welcome-cron') {
      const cronSecret = process.env.CRON_SECRET;
      const cronHeader = req.headers['authorization'];
      const isCronCall = cronSecret && cronHeader === `Bearer ${cronSecret}`;
      const wcAdmin = await getAdmin();
      if (!wcAdmin && !isCronCall) return unauth(res);

      const wcKeys = await kvKeys('welcome_seq:*');
      const nowMs = Date.now();
      const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
      const SEVEN_DAYS_MS2 = 7 * 24 * 60 * 60 * 1000;

      let day2Sent = 0;
      let day7Sent = 0;

      for (const key of wcKeys) {
        let seq;
        const raw = await kvGet(key);
        if (!raw) continue;
        try { seq = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
        if (!seq.approvedAt) continue;

        const approvedMs = new Date(seq.approvedAt).getTime();
        if (isNaN(approvedMs)) continue;

        let dirty = false;
        const investorId = key.replace('welcome_seq:', '');
        const inv = await kvGet(`inst:${investorId}`);
        if (!inv) continue;

        // Day 7 check first (so we don't double-fire if both thresholds pass on same run)
        if (!seq.day7Sent && (nowMs - approvedMs) >= SEVEN_DAYS_MS2) {
          // Fetch open deals for context
          const openDeals = (await listDeals({ live: true }))
            .filter(d => d.stage === 'live' && d.member_visible)
            .slice(0, 3)
            .map(d => ({ name: d.name, asset_class: d.asset_class, target_irr: d.target_irr }));
          await sendWelcomeDay7(inv, { openDeals }).catch(console.error);
          seq.day7Sent = true;
          dirty = true;
          day7Sent++;
        } else if (!seq.day2Sent && (nowMs - approvedMs) >= TWO_DAYS_MS) {
          await sendWelcomeDay2(inv).catch(console.error);
          seq.day2Sent = true;
          dirty = true;
          day2Sent++;
        }

        if (dirty) {
          await kvSet(key, JSON.stringify(seq));
        }
      }

      return ok(res, { ok: true, day2Sent, day7Sent, checked: wcKeys.length });
    }

    // ─── Production wipe: wipe only, no reseed ───────────────────
    if (op === 'production-wipe') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      try {
        const wiped = await wipeAll();
        return ok(res, { wiped });
      } catch (e) {
        console.error('[production-wipe] wipeAll failed:', e?.message || e);
        return bad(res, 'Wipe failed: ' + (e?.message || 'unknown'), 500);
      }
    }

    // ─── Bot-test sandbox: destructive wipe + reseed ─────────────
    if (op === 'sandbox-reset') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { confirm } = req.body || {};
      if (confirm !== 'WIPE ALL DATA') return bad(res, 'Confirmation phrase required: pass body { confirm: "WIPE ALL DATA" }');
      let wiped, accounts, volume;
      try {
        wiped = await wipeAll();
      } catch (e) {
        console.error('[sandbox-reset] wipeAll failed:', e?.message || e);
        return bad(res, 'Reset failed during wipe phase: ' + (e?.message || 'unknown'), 500);
      }
      try {
        accounts = await seedBotAccounts();
      } catch (e) {
        console.error('[sandbox-reset] seedBotAccounts failed:', e?.message || e);
        return bad(res, 'Reset failed during bot-account seed: ' + (e?.message || 'unknown'), 500);
      }
      try {
        volume = await seedHighVolume();
      } catch (e) {
        console.error('[sandbox-reset] seedHighVolume failed:', e?.message || e);
        return bad(res, 'Reset failed during high-volume seed: ' + (e?.message || 'unknown'), 500);
      }
      // Bust all caches so next polls compute fresh
      try {
        await kvDel('bot:status:cache');
        await kvDel('cache:iois:all');
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}
      return ok(res, {
        wiped,
        advisors: volume.advisors_created + 1,
        investors: volume.investors_created + 1,
        deals: volume.deals_created,
        iois: volume.iois_created,
        bot_accounts: accounts,
      });
    }

    if (op === 'sandbox-status') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      // Cache the heavy fan-out aggregation in Redis with a 5s TTL.
      // sandbox-status fans out to ~2,000 reads per call (deals + iois + advisors +
      // investors + audit samples). Driver + viewer polling every 1.5-5s would burn
      // tens of thousands of ops per minute. Cache turns most polls into a single
      // kvGet, dropping cost ~40x while keeping freshness within 5s.
      try {
        const cached = await kvGet('bot:status:cache');
        if (cached && typeof cached === 'object') {
          return ok(res, cached);
        }
      } catch { /* cache miss is fine, fall through to recompute */ }

      const dealIds = await kvZrange('deals:index', 0, -1, { rev: true });
      // P-6: route through getDeal so the merged atomic counter values (the
      // real source of truth post-P-6) are used. Embedded deal.ioi_count is
      // never updated by bumpIoiCounters — reading it directly would lie.
      const allDeals = (await Promise.all(dealIds.map(id => getDeal(id)))).filter(Boolean);
      const allIois = await getAllIois();
      const advKeys = await kvKeys('advisor:adv-*');
      const advisors = (await Promise.all(advKeys.map(k => kvGet(k)))).filter(Boolean);
      const advisorBotKeys = await kvKeys('advisor:adv-bot-*');
      const advisorBot = (await Promise.all(advisorBotKeys.map(k => kvGet(k)))).filter(Boolean);
      const advisorPinnedBot = await kvGet('advisor:bot-adv');
      const allAdvisors = [...advisors, ...advisorBot, ...(advisorPinnedBot ? [advisorPinnedBot] : [])];
      const advMap = new Map();
      for (const a of allAdvisors) advMap.set(a.id, a);

      const instKeys = await kvKeys('inst:*');
      const investors = (await Promise.all(instKeys.map(k => kvGet(k)))).filter(Boolean).filter(i => i && typeof i === 'object' && i.id && !i.id.startsWith('advisor'));

      const deals_by_stage = {};
      for (const d of allDeals) deals_by_stage[d.stage] = (deals_by_stage[d.stage] || 0) + 1;
      const iois_by_status = {};
      for (const i of allIois) iois_by_status[i.status] = (iois_by_status[i.status] || 0) + 1;
      const investors_by_status = {};
      for (const inv of investors) investors_by_status[inv.status] = (investors_by_status[inv.status] || 0) + 1;

      const recent_deals = allDeals.slice(0, 25).map(d => ({
        id: d.id, name: d.name, stage: d.stage, advisor_id: d.advisor_id,
        target_alloc_usd: d.target_alloc_usd, ioi_count: d.ioi_count,
        created_at: d.created_at,
      }));

      const recent_iois = [...allIois]
        .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
        .slice(0, 25)
        .map(i => ({
          id: i.id, deal_id: i.deal_id, investor_id: i.investor_id,
          investor_firm: i.investor_firm, amount: i.amount,
          status: i.status, submitted_at: i.submitted_at,
        }));

      const auditSampleDeals = allDeals.slice(0, 25);
      const auditEntries = [];
      await Promise.all(auditSampleDeals.map(async d => {
        const entries = await kvZrange(`audit:${d.id}`, 0, -1, { rev: true });
        for (const raw of entries) {
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            auditEntries.push({ deal_id: d.id, ...parsed });
          } catch {}
        }
      }));
      auditEntries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      const audit = auditEntries.slice(0, 50);

      // Pending investor + advisor lists for AdminBot's approval queue.
      // Computed from data already fetched above — zero extra Redis ops.
      const pending_investors = investors
        .filter(i => i.status === 'pending')
        .slice(0, 25)
        .map(i => ({ id: i.id, email: i.email, firm_name: i.firm_name, contact_name: i.contact_name, category: i.category }));
      const pending_advisors = [...advMap.values()]
        .filter(a => a.status === 'pending')
        .slice(0, 25)
        .map(a => ({ id: a.id, email: a.email, firm_name: a.firm_name, name: a.name }));

      const payload = {
        counts: {
          deals: allDeals.length,
          deals_by_stage,
          iois: allIois.length,
          iois_by_status,
          advisors: advMap.size,
          investors: investors.length,
          investors_by_status,
        },
        recent_deals,
        recent_iois,
        pending_investors,
        pending_advisors,
        audit,
      };
      // Cache for 5s — keeps polling cheap. Reset endpoint should bust this cache.
      try { await kvSet('bot:status:cache', payload, { ex: 5 }); } catch {}
      return ok(res, payload);
    }

    if (op === 'sandbox-summary') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);

      const dealIds = await kvZrange('deals:index', 0, -1);
      // P-6: getDeal merges atomic counter keys — same source of truth that
      // every real consumer reads. Audit must match.
      const allDeals = (await Promise.all(dealIds.map(id => getDeal(id)))).filter(Boolean);
      const dealById = new Map(allDeals.map(d => [d.id, d]));
      const allIois = await getAllIois();

      const instKeys = await kvKeys('inst:*');
      const allInvestors = (await Promise.all(instKeys.map(k => kvGet(k)))).filter(Boolean)
        .filter(i => i && typeof i === 'object' && i.id);
      const investorById = new Map(allInvestors.map(i => [i.id, i]));

      const issues = [];
      const now = Date.now();

      const orphanCandidates = allIois.filter(i => i.investor_id && !investorById.has(i.investor_id) && !i.investor_id.startsWith('INV-SEED-'));
      // Defensive: kvKeys('inst:*') can occasionally miss a recently-written key
      // under high concurrency. Confirm orphans via direct lookup before flagging.
      const orphanIois = [];
      const directChecks = await Promise.all(orphanCandidates.map(async i => {
        const direct = await kvGet(`inst:${i.investor_id}`);
        return direct ? null : i;
      }));
      for (const r of directChecks) if (r) orphanIois.push(r);
      if (orphanIois.length) issues.push({
        type: 'orphan_iois', severity: 'high', count: orphanIois.length,
        samples: orphanIois.slice(0, 5).map(i => ({ ioi_id: i.id, investor_id: i.investor_id, deal_id: i.deal_id })),
      });

      const ioisNoDeal = allIois.filter(i => !dealById.has(i.deal_id));
      if (ioisNoDeal.length) issues.push({
        type: 'iois_without_deal', severity: 'high', count: ioisNoDeal.length,
        samples: ioisNoDeal.slice(0, 5).map(i => ({ ioi_id: i.id, deal_id: i.deal_id })),
      });

      // Stuck-deal detection — only fire on TRULY long-stalled deals.
      // Previous rule (60s–10min window) generated noise from normal bot-test
      // pipeline backpressure: with hundreds of review-stage deals queued,
      // AdminBot can't pick every live deal every minute, so they show as
      // "stuck" by the 60s rule. In production, deals sit in stages for
      // weeks — that's normal, not a bug.
      // New rule: only flag deals in active stages (live/ioi/dd/terms) with
      // NO audit activity for > 30 days. This is the real "abandoned deal"
      // signal that matters in production.
      const stuckSet = new Set(['live', 'ioi', 'dd', 'terms']);
      const STUCK_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
      const stuckDeals = [];
      const auditCheckResults = await Promise.all(allDeals.map(async d => {
        if (!stuckSet.has(d.stage)) return null;
        const entries = await kvZrange(`audit:${d.id}`, 0, -1, { rev: true });
        let lastTs = 0;
        let nonSeedCount = 0;
        for (const raw of entries) {
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const actor = String(parsed.actor || '');
            if (actor.startsWith('system:bot-seed')) continue;
            if (parsed.meta && parsed.meta.bot_seed === true) continue;
            nonSeedCount++;
            const t = new Date(parsed.at).getTime();
            if (t > lastTs) lastTs = t;
          } catch {}
        }
        return { deal: d, lastTs, entryCount: entries.length, nonSeedCount };
      }));
      for (const r of auditCheckResults) {
        if (!r) continue;
        if (!r.nonSeedCount) continue;
        if (!r.lastTs) continue;
        const age = now - r.lastTs;
        if (age > STUCK_AGE_MS) {
          stuckDeals.push({ id: r.deal.id, stage: r.deal.stage, last_audit_age_days: Math.round(age / 86400000) });
        }
      }
      if (stuckDeals.length) issues.push({
        type: 'stuck_deals', severity: 'low', count: stuckDeals.length,
        samples: stuckDeals.slice(0, 5),
      });

      const missingAudit = [];
      for (const r of auditCheckResults) {
        if (r && r.entryCount === 0) missingAudit.push({ id: r.deal.id, stage: r.deal.stage });
      }
      const remainingDeals = allDeals.filter(d => !stuckSet.has(d.stage));
      const remainingChecks = await Promise.all(remainingDeals.map(async d => {
        const entries = await kvZrange(`audit:${d.id}`, 0, 0);
        return entries.length === 0 ? { id: d.id, stage: d.stage } : null;
      }));
      for (const r of remainingChecks) if (r) missingAudit.push(r);
      if (missingAudit.length) issues.push({
        type: 'missing_audit_entries', severity: 'high', count: missingAudit.length,
        samples: missingAudit.slice(0, 5),
      });

      const ioiCountByDeal = new Map();
      const ioiAggByDeal = new Map();
      for (const i of allIois) {
        if (i.status === 'rejected') continue;
        ioiCountByDeal.set(i.deal_id, (ioiCountByDeal.get(i.deal_id) || 0) + 1);
        ioiAggByDeal.set(i.deal_id, (ioiAggByDeal.get(i.deal_id) || 0) + (i.amount || 0));
      }
      // P-6 atomic counters fix means counter drift should be zero in normal
      // operation. Audit no longer auto-heals — any mismatch is reported
      // honestly so we can investigate root cause. If transient drift ever
      // appears (e.g., from a partial bumpIoiCounters failure), operator
      // can manually run reconcileIoiCounters via the rescore path.
      const counterMismatch = [];
      for (const d of allDeals) {
        const actualCount = ioiCountByDeal.get(d.id) || 0;
        const actualAgg = ioiAggByDeal.get(d.id) || 0;
        const declaredCount = d.ioi_count || 0;
        const declaredAgg = d.ioi_agg_usd || 0;
        if (actualCount !== declaredCount || actualAgg !== declaredAgg) {
          counterMismatch.push({
            deal_id: d.id,
            declared_count: declaredCount, actual_count: actualCount,
            declared_agg: declaredAgg, actual_agg: actualAgg,
          });
        }
      }
      if (counterMismatch.length) issues.push({
        type: 'ioi_counter_mismatch', severity: 'medium', count: counterMismatch.length,
        samples: counterMismatch.slice(0, 5),
      });

      const approvedNoCode = allInvestors.filter(i => i.status === 'approved' && !i.code);
      if (approvedNoCode.length) issues.push({
        type: 'approved_investors_without_code', severity: 'high', count: approvedNoCode.length,
        samples: approvedNoCode.slice(0, 5).map(i => ({ id: i.id, email: i.email, firm_name: i.firm_name })),
      });

      const totalIssueCount = issues.reduce((s, i) => s + i.count, 0);
      return ok(res, {
        ok: issues.length === 0,
        issues,
        summary: `${totalIssueCount} issue${totalIssueCount === 1 ? '' : 's'} found across ${issues.length} categor${issues.length === 1 ? 'y' : 'ies'}`,
      });
    }

  }

  // ─────────────────────────────────────────────────────────────
  // MARKETPLACE (IOI) RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'marketplace') {

    if (op === 'ioi') {
      // Inst-only — review HIGH #1: previously accepted advisor/admin auth and
      // used auth.advisor_id || auth.email as investorId, polluting the IOI
      // index with non-inv-* IDs and firing investor-shaped emails against
      // null records. Now strictly investor.
      const auth = await getInst();
      if (!auth) return unauth(res);
      const { deal_id, amount, notes } = req.body || {};
      if (!deal_id || amount == null || amount === '') return bad(res, 'Deal ID and amount required');
      const amt = parseFloat(amount);
      // Review HIGH #2: parseFloat('foo') = NaN, NaN was sneaking through the
      // truthy `if (!amount)` check and the `amt < minT` check (NaN < anything
      // is false). Result: IOIs stored with amount=NaN and counter corrupted
      // via Math.round(NaN). Reject non-finite or non-positive amounts up front.
      if (!Number.isFinite(amt) || amt <= 0) return bad(res, 'Amount must be a positive number');
      const deal = await getDeal(deal_id);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (!deal.member_visible) return bad(res, 'Deal not available');
      // Platform minimum
      const minT = Math.max(10000, deal.min_ticket_usd || 0);
      if (amt < minT) return bad(res, `Minimum ticket is $${minT.toLocaleString()}`);
      // Atomic dedup — SET NX prevents race condition between concurrent requests
      const investorId = auth.inst_id;
      const dedupKey = `ioi_exists:${deal_id}:${investorId}`;
      // Check existing value first to give a meaningful error for already-approved IOIs
      const existingDedup = await kvGet(dedupKey);
      if (existingDedup && existingDedup !== 'rejected') return res.status(409).json({ error: 'IOI already submitted' });
      // Atomic SET NX — only one concurrent request will succeed; the other gets null back
      const claimed = await kvSetnx(dedupKey, 'pending');
      if (!claimed) return res.status(409).json({ error: 'IOI already submitted' });
      const ioiId = 'IOI-' + Date.now().toString(36).toUpperCase();
      const instObj = auth.inst_id ? await kvGet(`inst:${auth.inst_id}`) : null;
      const ioi = {
        id: ioiId, deal_id, amount: amt, notes: notes || '',
        investor_id: investorId,
        investor_email: auth.email || instObj?.email,
        investor_firm: auth.firm || instObj?.firm_name || '',
        status: 'pending',
        data_room_access: false,
        submitted_at: new Date().toISOString(),
      };
      await kvSet(`ioi:${ioiId}`, ioi);
      // Register in sorted set index (score = submission time ms)
      await kvZadd('ioi_index', Date.now(), ioiId);
      // dedupKey was already set to 'pending' atomically above via kvSetnx.
      // P-6: atomic INCR on dedicated counter keys — race-safe under
      // concurrent IOI submissions to the same deal.
      await bumpIoiCounters(deal_id, 1, amt);
      try {
        await kvDel('cache:iois:all');
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}
      // Send IOI confirmation email to investor
      const ioiInst = auth.inst_id ? await kvGet(`inst:${auth.inst_id}`) : null;
      if (ioiInst) await sendIoiConfirmation(ioiInst, deal).catch(console.error);
      return ok(res, { ioi });
    }

    if (op === 'approve-ioi') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { ioi_id } = req.body || {};
      const ioi = await kvGet(`ioi:${ioi_id}`);
      if (!ioi) return bad(res, 'IOI not found', 404);
      // Idempotent: a duplicate approve call returns the existing record
      // without re-firing the data-room-access email or re-recalcing counters.
      if (ioi.status === 'approved') {
        return ok(res, { ioi, idempotent: true });
      }
      // P-6 un-reject case: if the IOI was previously rejected, the counter
      // was decremented at reject time. Approving from rejected → approved
      // must re-increment, otherwise counters drift permanently low.
      // Pending → approved is a no-op on counters (both already counted).
      const prevStatus = ioi.status;
      ioi.status = 'approved';
      ioi.data_room_access = true;
      ioi.approved_at = new Date().toISOString();
      ioi.approved_by = admin.email;
      await kvSet(`ioi:${ioi_id}`, ioi);
      // Update dedup to approved (allows future re-consideration)
      await kvSet(`ioi_exists:${ioi.deal_id}:${ioi.investor_id}`, 'approved');
      if (prevStatus === 'rejected') {
        await bumpIoiCounters(ioi.deal_id, 1, ioi.amount || 0);
      }
      try {
        await kvDel('cache:iois:all');
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}
      // Send data room access email
      const inst = ioi.investor_id.startsWith('inv-') ? await kvGet(`inst:${ioi.investor_id}`) : null;
      const deal = await getDeal(ioi.deal_id);
      if (inst && deal) await sendDataRoomAccess(inst, deal).catch(console.error);
      return ok(res, { ioi });
    }

    if (op === 'reject-ioi') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { ioi_id } = req.body || {};
      const ioi = await kvGet(`ioi:${ioi_id}`);
      if (!ioi) return bad(res, 'IOI not found', 404);
      const prevStatus = ioi.status;
      const wasApproved = prevStatus === 'approved';
      ioi.status = 'rejected';
      ioi.data_room_access = false;
      ioi.rejected_at = new Date().toISOString();
      ioi.rejected_by = admin.email;
      await kvSet(`ioi:${ioi_id}`, ioi);
      // DELETE dedup key so investor can re-submit
      await kvDel(`ioi_exists:${ioi.deal_id}:${ioi.investor_id}`);
      // P-6: counter only includes non-rejected IOIs. If this IOI was already
      // rejected (idempotent re-call) skip the decrement to avoid double-counting.
      if (prevStatus !== 'rejected') {
        await bumpIoiCounters(ioi.deal_id, -1, -(ioi.amount || 0));
      }
      try {
        await kvDel('cache:iois:all');
        await kvDel('cache:marketplace:public');
        await kvDel('cache:marketplace:admin');
      } catch {}
      // Send rejection email to investor
      const rejInst = ioi.investor_id.startsWith('inv-') ? await kvGet(`inst:${ioi.investor_id}`) : null;
      const rejDeal = await getDeal(ioi.deal_id);
      if (rejInst && rejDeal) await sendIoiRejection(rejInst, rejDeal).catch(console.error);
      return ok(res, { ioi });
    }

    if (op === 'my-iois') {
      const auth = await getAnyAuth();
      if (!auth) return unauth(res);
      const investorId = auth.inst_id || auth.advisor_id || auth.email;
      const allIoiRecords = await getAllIois();
      const iois = allIoiRecords.filter(i => i.investor_id === investorId);
      return ok(res, { iois });
    }

    if (op === 'deal-iois') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { deal_id } = req.query;
      const allIoisList = await getAllIois();
      const iois = allIoisList.filter(i => !deal_id || i.deal_id === deal_id);
      return ok(res, { iois });
    }

  }

  // ─────────────────────────────────────────────────────────────
  // MEMBER RESOURCE (TACC member compatibility)
  // ─────────────────────────────────────────────────────────────
  if (resource === 'member') {
    if (op === 'me') {
      const auth = await getAnyAuth();
      if (!auth) return unauth(res);
      return ok(res, { role: auth.role, email: auth.email });
    }
  }

  return bad(res, 'Unknown resource or operation', 404);
}

// ── Helpers ──────────────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function sanitizeAdvisor(adv) {
  // Review HIGH #4: previously only stripped password_hash. Seed records carry
  // temp_pw (plain-text shared dev password) and is_admin (privilege flag) on
  // the advisor object; both leaked in API responses. Strip every sensitive
  // field. Also strip setup_token if it ever appears.
  const { password_hash, temp_pw, is_admin, setup_token, ...safe } = adv;
  return safe;
}

function sanitizeInst(inst) {
  const { code, ...safe } = inst; return { ...safe, has_access: inst.status === 'approved' };
}

async function seedAdvisors() {
  const advisors = [
    { id:'adv-tkj', email:'tkj@theaurumcc.com',     firm_name:'TACC Pte Ltd',             name:'T. Kwan',         intro_fee_pct:1,   carry_pct:0,  status:'active',  requires_setup:false, temp_pw:'1234',        is_admin:true },
    { id:'adv-sg1', email:'sarah@capitalgroup.sg',   firm_name:'Chen Capital Partners',    name:'Sarah Chen',      intro_fee_pct:1,   carry_pct:10, status:'active',  requires_setup:false },
    { id:'adv-mc1', email:'marcus@mchadvisory.com',  firm_name:'Marcus Chen Advisory',     name:'Marcus Chen',     intro_fee_pct:1,   carry_pct:10, status:'active',  requires_setup:false },
    { id:'adv-mg1', email:'priya@mehtainv.sg',       firm_name:'Mehta Investment Group',   name:'Priya Mehta',     intro_fee_pct:1,   carry_pct:10, status:'active',  requires_setup:false },
    { id:'adv-lc1', email:'james@limcap.sg',         firm_name:'Lim Capital SG',           name:'James Lim',       intro_fee_pct:1,   carry_pct:10, status:'active',  requires_setup:false },
    { id:'adv-pk1', email:'david@parkassoc.sg',      firm_name:'Park & Associates',        name:'David Park',      intro_fee_pct:1,   carry_pct:10, status:'active',  requires_setup:false },
    { id:'adv-tk1', email:'thomas@kimrep.sg',        firm_name:'Kim Real Estate Partners', name:'Thomas Kim',      intro_fee_pct:1.5, carry_pct:10, status:'active',  requires_setup:false },
    { id:'adv-pb1', email:'dliu@pacificbridge.com',  firm_name:'Pacific Bridge Partners',  name:'David Liu',       intro_fee_pct:1.5, carry_pct:5,  status:'pending', requires_setup:false },
  ];
  for (const a of advisors) {
    // Always update tkj account so credential changes take effect immediately
    const exists = await kvGet(`advisor:${a.id}`);
    if (!exists || a.id === 'adv-tkj') {
      a.password_hash = await bcrypt.hash(a.temp_pw || 'Advisor123!', 12);
      a.created_at = a.created_at || new Date().toISOString();
      await kvSet(`advisor:${a.id}`, a);
      await kvSet(`advisor_email:${a.email}`, a.id);
    }
  }
}

async function seedInvestors() {
  const investors = [
    { id:'inv-tkj', email:'tkj@theaurumcc.com',           firm_name:'TACC Pte Ltd',                 contact_name:'Thomas K J',        institution_type:'Family Office',     aum_range:'Over $1B',    ticket_range:'Over $5M',    status:'approved', code:'TKJDEV1' },
    { id:'inv-001', email:'jwc@theaurumcc.com',            firm_name:'Meridian Family Office',       contact_name:'James Walker',       institution_type:'Family Office',     aum_range:'$50M–$250M',  ticket_range:'$1M–$5M',     status:'approved', code:'1234' },
    { id:'inv-002', email:'priya@atlascap.com',            firm_name:'Atlas Capital Management',     contact_name:'Priya Sharma',       institution_type:'Institutional Fund', aum_range:'$250M–$1B',   ticket_range:'Over $5M',    status:'pending',  code:null },
    { id:'inv-003', email:'m.chen@northfield.edu',         firm_name:'Westbrook Endowment',          contact_name:'Michael Chen',       institution_type:'Endowment',          aum_range:'Over $1B',    ticket_range:'$1M–$5M',     status:'pending',  code:null },
    { id:'inv-004', email:'skim@pacificavc.com',           firm_name:'Pacifica Ventures',            contact_name:'Sarah Kim',          institution_type:'PE / VC Fund',       aum_range:'$50M–$250M',  ticket_range:'$250K–$1M',   status:'approved', code:'INST-Q3PX7KMN' },
    { id:'inv-005', email:'dliu@egf.com',                  firm_name:'Eastern Growth Fund',          contact_name:'David Liu',          institution_type:'Institutional Fund', aum_range:'$250M–$1B',   ticket_range:'$1M–$5M',     status:'approved', code:'INST-B8WZK4LR' },
    { id:'inv-006', email:'harrison@harrisonfo.com',       firm_name:'Whitmore Family Office',       contact_name:'William Harrison',   institution_type:'Family Office',     aum_range:'$250M–$1B',   ticket_range:'$1M–$5M',     status:'pending',  code:null },
    { id:'inv-007', email:'kessler@kesslerfo.com',         firm_name:'Sterling Family Office',       contact_name:'James Kessler',      institution_type:'Family Office',     aum_range:'$50M–$250M',  ticket_range:'$250K–$1M',   status:'pending',  code:null },
    { id:'inv-008', email:'weiss@wellingtonsg.com',        firm_name:'Hargrove Capital SG',          contact_name:'Richard Weiss',      institution_type:'Institutional Fund', aum_range:'Over $1B',    ticket_range:'Over $5M',    status:'pending',  code:null },
    { id:'inv-009', email:'nakashima@rnfamily.jp',         firm_name:'Tanaka Family Office',         contact_name:'R. Nakashima',       institution_type:'Family Office',     aum_range:'$250M–$1B',   ticket_range:'$1M–$5M',     status:'approved', code:'INST-RN7KXP2Q' },
    { id:'inv-010', email:'pemberton@pembertonhold.co.uk', firm_name:'Ashford Holdings',             contact_name:'C. Pemberton',       institution_type:'Family Office',     aum_range:'Over $1B',    ticket_range:'Over $5M',    status:'approved', code:'INST-PH4WM9VB' },
    { id:'inv-011', email:'riviera@rivieracapsg.com',      firm_name:'Marquette Capital SG',         contact_name:'A. Fournier',        institution_type:'Institutional Fund', aum_range:'$250M–$1B',   ticket_range:'$1M–$5M',     status:'approved', code:'INST-RC2ZK8LN' },
    { id:'inv-012', email:'chen@meridianam.sg',            firm_name:'Meridian Asset Management',    contact_name:'J. Chen',            institution_type:'Institutional Fund', aum_range:'Over $1B',    ticket_range:'Over $5M',    status:'pending',  code:null },
    { id:'inv-013', email:'stonegate@stonegatefo.com',     firm_name:'Stonegate Family Office',      contact_name:'D. Ashford',         institution_type:'Family Office',     aum_range:'$50M–$250M',  ticket_range:'$250K–$1M',   status:'pending',  code:null },
  ];
  for (const i of investors) {
    const exists = await kvGet(`inst:${i.id}`);
    if (!exists) {
      i.created_at = i.created_at || new Date().toISOString();
      await kvSet(`inst:${i.id}`, i);
      await kvSet(`inst_email:${i.email}`, i.id);
      if (i.code) await kvSet(`inst_code:${i.code}`, i.id);
    }
  }
}
