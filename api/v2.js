import { verifyToken, signToken, signResetCode, verifyResetToken, cookieOpts, clearCookieOpts } from './_lib/auth.js';
import { ok, bad, unauth, getCookie, setCookieHeader } from './_lib/http.js';
import { kvGet, kvSet, kvDel, kvKeys, kvSetnx, kvIncrby, kvZrange, kvZadd, kvZrem, healthCheck, isKvUnavailable } from './_lib/storage.js';
import { createDeal, updateDeal, getDeal, saveDeal, listDeals, seedDeals, seedIois, recalcIoiCounters, appendAuditEntry } from './_lib/deal-storage.js';
import {
  sendAccessCode, sendDealReceived, sendStageChange,
  sendDataRoomAccess, sendAccessApplication,
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
import bcrypt from 'bcryptjs';

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
    console.error('[v2] Unhandled error:', err?.message, { resource, op });
    await captureException(err, { resource, op }).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
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
    return await getAdmin() || await getAdvisor() || await getInst();
  }

  // Fetch all IOI records via the ioi_index sorted set — O(log N + M) vs O(N) KEYS scan.
  // Returns an array of hydrated IOI objects (nulls filtered).
  async function getAllIois() {
    const ioiIds = await kvZrange('ioi_index', 0, -1);
    return (await Promise.all(ioiIds.map(id => kvGet(`ioi:${id}`)))).filter(Boolean);
  }

  // ─────────────────────────────────────────────────────────────
  // ADVISOR RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'advisor') {

    if (op === 'login') {
      const ip = getClientIp(req);
      if (await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
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
        // Create new deal
        const advisorId = adv ? adv.advisor_id : null;
        const deal = await createDeal(data, advisorId, admin ? admin.email : null);
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
      const tempPw = generateTempPassword();
      const adv = {
        id, email, firm_name: data.firm_name.trim(), name: data.name.trim(),
        intro_fee_pct: parseFloat(data.intro_fee_pct) || 1,
        carry_pct: parseFloat(data.carry_pct) || 0,
        status: 'active',
        requires_setup: true,
        password_hash: await bcrypt.hash(tempPw, 12),
        created_at: new Date().toISOString(),
      };
      await kvSet(`advisor:${id}`, adv);
      await kvSet(`advisor_email:${email}`, id);
      await sendAdvisorWelcome(adv, tempPw);
      return ok(res, { advisor: sanitizeAdvisor(adv) });
    }

    if (op === 'forgot-password') {
      const ip = getClientIp(req);
      if (await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
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

    // ── VDR: upload files ────────────────────────────────────────
    // KV keys:
    //   vdr:{dealId}:index          — JSON array of file metadata
    //   vdr:{dealId}:file:{fileId}  — base64 file content
    if (op === 'vdr-upload') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, files } = req.body || {};
      if (!dealId || !Array.isArray(files) || files.length === 0) return bad(res, 'dealId and files array required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);

      // Load existing index and merge
      const existingIndex = (await kvGet(`vdr:${dealId}:index`)) || [];
      const existingIds = new Set(existingIndex.map(f => f.id));

      const newMeta = [];
      for (const file of files) {
        if (!file.id || !file.name || !file.data) return bad(res, `File entry missing id, name, or data`);

        // [BLOB] Attempt Vercel Blob upload; fall back to base64-in-Redis if not activated.
        // Set BLOB_READ_WRITE_TOKEN in Vercel env vars to activate — see api/_lib/blob-storage.js.
        const contentType = file.type || 'application/octet-stream';
        const blobUrl = await uploadDocument(
          `vdr/${dealId}/${file.id}-${file.name}`,
          file.data,
          contentType
        );
        // Store URL if uploaded to Blob, otherwise store raw base64 (legacy path)
        await kvSet(`vdr:${dealId}:file:${file.id}`, blobUrl || file.data);

        const meta = {
          id: file.id,
          name: file.name,
          size: file.size || 0,
          folder: file.folder || '',
          type: contentType,
          uploadedAt: new Date().toISOString(),
          storageType: blobUrl ? 'blob' : 'redis',
        };
        if (!existingIds.has(file.id)) {
          existingIndex.push(meta);
          existingIds.add(file.id);
        } else {
          // Replace metadata for re-uploaded file
          const idx = existingIndex.findIndex(f => f.id === file.id);
          if (idx >= 0) existingIndex[idx] = meta;
        }
        newMeta.push(meta);
      }

      await kvSet(`vdr:${dealId}:index`, existingIndex);

      // Audit log on deal
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({
        at: new Date().toISOString(),
        actor: adv.advisor_id,
        action: 'vdr_upload',
        meta: { fileCount: files.length, fileNames: newMeta.map(f => f.name) },
      });
      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);

      return ok(res, { ok: true, files: newMeta });
    }

    // ── VDR: list files (advisor view) ───────────────────────────
    if (op === 'vdr-files') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const files = (await kvGet(`vdr:${dealId}:index`)) || [];
      return ok(res, { ok: true, files });
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
    if (op === 'qa-thread-advisor') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const qa = (await kvGet(`qa:${dealId}`)) || [];
      return ok(res, { ok: true, qa });
    }

    // ── Q&A: answer a question ───────────────────────────────────
    if (op === 'answer-qa') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, qaId, answer, broadcast, message } = req.body || {};
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const advObj = await kvGet(`advisor:${adv.advisor_id}`);
      const senderName = advObj?.name || advObj?.firm_name || adv.advisor_id;
      const qa = (await kvGet(`qa:${dealId}`)) || [];
      // Broadcast / opening statement path
      if (broadcast && message) {
        const broadcastEntry = {
          id: 'qa-bc-' + Date.now().toString(36),
          type: 'advisor_open',
          message: message.trim(),
          sentBy: senderName,
          sentAt: new Date().toISOString(),
          broadcast: true,
        };
        qa.push(broadcastEntry);
        await kvSet(`qa:${dealId}`, qa);
        return ok(res, { ok: true });
      }
      // Standard Q&A reply path
      if (!qaId || !answer) return bad(res, 'dealId, qaId, and answer required');
      const entry = qa.find(q => q.id === qaId);
      if (!entry) return bad(res, 'Question not found', 404);
      entry.answer = answer.trim();
      entry.answeredAt = new Date().toISOString();
      entry.answeredBy = senderName;
      await kvSet(`qa:${dealId}`, qa);
      // Delete the pending reminder key — question is answered
      await kvDel(`qa_pending:${dealId}:${qaId}`);
      // Email the investor who asked
      if (entry.investor_id && entry.investor_id.startsWith('inv-')) {
        const qaInvestor = await kvGet(`inst:${entry.investor_id}`);
        if (qaInvestor) await sendQaAnswerToInvestor(qaInvestor, deal).catch(console.error);
      }
      return ok(res, { ok: true });
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
    if (op === 'respond-package') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const { dealId, packageId, decision } = req.body || {};
      if (!dealId || !packageId || !['accepted', 'declined'].includes(decision)) {
        return bad(res, 'dealId, packageId, and decision (accepted|declined) required');
      }
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (deal.advisor_id !== adv.advisor_id) return bad(res, 'Not your deal', 403);
      const pkg = await kvGet(`package:${packageId}`);
      if (!pkg) return bad(res, 'Package not found', 404);
      // Persist decision on both the package and deal
      pkg.advisor_decision = decision;
      pkg.advisor_decision_at = new Date().toISOString();
      await kvSet(`package:${packageId}`, pkg);
      deal.pushed_ioi_status = decision;
      if (decision === 'accepted') {
        deal.stage = 'dd';
      }
      const pkgAuditEntry = { at: new Date().toISOString(), actor: adv.advisor_id, action: `package_${decision}`, meta: { packageId } };
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push(pkgAuditEntry);
      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
      await appendAuditEntry(dealId, pkgAuditEntry);
      // Recalculate IOI counters after package response
      await recalcIoiCounters(dealId);
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
      return ok(res, { ok: true, decision, stage: deal.stage });
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
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: new Date().toISOString(), actor: adv.email, action: 'advisor_confirmed_deal', meta: { edits: Object.keys(edits || {}) } });

      deal.notifications = deal.notifications || [];
      deal.notifications.push({
        id: `notif_${Date.now()}`,
        type: 'advisor_confirmed_deal',
        deal_name: deal.name,
        advisor_name: adv.name || adv.email,
        confirmed_at: new Date().toISOString(),
        read: false,
      });

      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
      return ok(res, { ok: true, deal });
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
      const deals = await listDeals({ live: true });
      // Strip internal fields for non-admin; also exclude preview deals from investor view
      const admin = await getAdmin();
      const visibleDeals = admin
        ? deals
        : deals.filter(d => d.member_visible && d.stage === 'live' && d.launch_mode !== 'preview');
      const safe = admin
        ? visibleDeals
        : visibleDeals.map(d => { const { advisor_id, audit_log, ...rest } = d; return rest; });
      return ok(res, { deals: safe });
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
      const data = req.body || {};
      if (!data.email || !data.firm_name || !data.contact_name) return bad(res, 'Email, firm name, and contact name required');
      const email = data.email.toLowerCase().trim();
      const existing = await kvGet(`inst_email:${email}`);
      if (existing) return bad(res, 'This email is already registered');
      const id = 'inv-' + Date.now().toString(36);
      const inst = {
        id, email, firm_name: data.firm_name.trim(), contact_name: data.contact_name.trim(),
        institution_type: data.institution_type || '', aum_range: data.aum_range || '',
        ticket_range: data.ticket_range || '', invest_focus: data.invest_focus || '',
        status: 'pending', code: null,
        created_at: new Date().toISOString(),
      };
      await kvSet(`inst:${id}`, inst);
      await kvSet(`inst_email:${email}`, id);
      await sendAccessApplication(inst).catch(console.error);
      return ok(res, { message: 'Application received. You will be notified by email when reviewed.' });
    }

    if (op === 'login') {
      const ip = getClientIp(req);
      if (await checkRateLimit(ip) > 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
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
    if (op === 'vdr-files') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return bad(res, 'Data room access requires an approved indication of interest', 403);

      const files = (await kvGet(`vdr:${dealId}:index`)) || [];
      const ddDeadline = getDdDeadline(deal);
      const ddExpired = ddDeadline ? new Date() > ddDeadline : false;

      return ok(res, {
        ok: true,
        files,
        dd_deadline: ddDeadline ? ddDeadline.toISOString() : null,
        dd_expired: ddExpired,
      });
    }

    // ── VDR: download single file (investor view) ────────────────
    if (op === 'vdr-file') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId, fileId } = req.query;
      if (!dealId || !fileId) return bad(res, 'dealId and fileId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return bad(res, 'Data room access requires an approved indication of interest', 403);

      const index = (await kvGet(`vdr:${dealId}:index`)) || [];
      const fileMeta = index.find(f => f.id === fileId);
      if (!fileMeta) return bad(res, 'File not found', 404);

      const rawFileData = await kvGet(`vdr:${dealId}:file:${fileId}`);
      if (!rawFileData) return bad(res, 'File content not found', 404);

      // [BLOB] Resolve stored value: Blob URL returned directly, base64 wrapped in data URI.
      // Clients receiving a value starting with https:// should redirect; otherwise decode
      // as a data URI (legacy Redis path).
      const resolvedFileData = getDocumentUrl(
        rawFileData,
        fileMeta.type || 'application/octet-stream'
      );

      return ok(res, {
        ok: true,
        name: fileMeta.name,
        type: fileMeta.type,
        data: resolvedFileData,
        watermark: {
          investorId: instAuth.inst_id,
          investorName: inst.firm_name || inst.contact_name || instAuth.inst_id,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ── Q&A: submit a question ───────────────────────────────────
    // qa:{dealId} — JSON array of {id, question, askedBy, askedAt, answer, answeredAt, answeredBy}
    if (op === 'submit-qa') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId, question } = req.body || {};
      if (!dealId || !question) return bad(res, 'dealId and question required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return bad(res, 'Q&A access requires an approved indication of interest', 403);

      const ddDeadline = getDdDeadline(deal);
      if (ddDeadline && new Date() > ddDeadline) return bad(res, 'DD period has closed — questions are no longer accepted', 403);

      const qaId = 'qa-' + Date.now().toString(36);
      const qaSubmittedAt = new Date().toISOString();
      const qa = (await kvGet(`qa:${dealId}`)) || [];
      qa.push({
        id: qaId,
        question: question.trim(),
        askedBy: inst.firm_name || inst.contact_name || instAuth.inst_id,
        askedAt: qaSubmittedAt,
        investor_id: instAuth.inst_id,
        answer: null,
        answeredAt: null,
        answeredBy: null,
      });
      await kvSet(`qa:${dealId}`, qa);

      // Store pending key for 48h reminder (score = submission timestamp ms)
      // TTL is 48h — question auto-expires from pending set if ignored beyond reminder window
      await kvSet(`qa_pending:${dealId}:${qaId}`, JSON.stringify({ dealId, qaId, submittedAt: qaSubmittedAt, reminderSent: false }), { ex: 172800 });

      // Email the deal's advisor
      if (deal.advisor_id && deal.advisor_id.startsWith('adv-')) {
        const qaAdvisor = await kvGet(`advisor:${deal.advisor_id}`);
        if (qaAdvisor) await sendQaQuestionToAdvisor(qaAdvisor, deal, question.trim()).catch(console.error);
      }

      return ok(res, { ok: true, qaId });
    }

    // ── Q&A: fetch full thread (investor view) ───────────────────
    if (op === 'qa-thread') {
      const instAuth = await getInst();
      if (!instAuth) return unauth(res);
      const inst = await kvGet(`inst:${instAuth.inst_id}`);
      if (!inst || inst.status !== 'approved') return unauth(res);
      const { dealId } = req.query;
      if (!dealId) return bad(res, 'dealId required');
      const deal = await getDeal(dealId);
      if (!deal) return bad(res, 'Deal not found', 404);

      const approvedIoi = await getApprovedIoi(dealId, instAuth.inst_id);
      if (!approvedIoi) return bad(res, 'Q&A access requires an approved indication of interest', 403);

      const qa = (await kvGet(`qa:${dealId}`)) || [];
      return ok(res, { ok: true, qa });
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

      const code = 'INST-' + generateCode();
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
        await recalcIoiCounters(ioi.deal_id);
      }

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
      for (const invId of (ccTargetIds || [])) {
        const inv = await kvGet(`inst:${invId}`);
        if (inv) { await sendCapitalCallNotice(inv, ccDeal).catch(console.error); ccSent++; }
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
      for (const invId of (distTargetIds || [])) {
        const inv = await kvGet(`inst:${invId}`);
        if (inv) { await sendDistributionNotice(inv, distDeal).catch(console.error); distSent++; }
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

  }

  // ─────────────────────────────────────────────────────────────
  // MARKETPLACE (IOI) RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'marketplace') {

    if (op === 'ioi') {
      const auth = await getAnyAuth();
      if (!auth) return unauth(res);
      const { deal_id, amount, notes } = req.body || {};
      if (!deal_id || !amount) return bad(res, 'Deal ID and amount required');
      const amt = parseFloat(amount);
      const deal = await getDeal(deal_id);
      if (!deal) return bad(res, 'Deal not found', 404);
      if (!deal.member_visible) return bad(res, 'Deal not available');
      // Platform minimum
      const minT = Math.max(10000, deal.min_ticket_usd || 0);
      if (amt < minT) return bad(res, `Minimum ticket is $${minT.toLocaleString()}`);
      // Atomic dedup — SET NX prevents race condition between concurrent requests
      const investorId = auth.inst_id || auth.advisor_id || auth.email;
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
      // dedupKey was already set to 'pending' atomically above via kvSetnx
      // Increment deal counters
      // Recalculate IOI counters from live records — single source of truth
      await recalcIoiCounters(deal_id);
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
      ioi.status = 'approved';
      ioi.data_room_access = true;
      ioi.approved_at = new Date().toISOString();
      ioi.approved_by = admin.email;
      await kvSet(`ioi:${ioi_id}`, ioi);
      // Update dedup to approved (allows future re-consideration)
      await kvSet(`ioi_exists:${ioi.deal_id}:${ioi.investor_id}`, 'approved');
      // Recalculate IOI counters
      await recalcIoiCounters(ioi.deal_id);
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
      const wasApproved = ioi.status === 'approved';
      ioi.status = 'rejected';
      ioi.data_room_access = false;
      ioi.rejected_at = new Date().toISOString();
      ioi.rejected_by = admin.email;
      await kvSet(`ioi:${ioi_id}`, ioi);
      // DELETE dedup key so investor can re-submit
      await kvDel(`ioi_exists:${ioi.deal_id}:${ioi.investor_id}`);
      // Recalculate IOI counters from live records — single source of truth
      await recalcIoiCounters(ioi.deal_id);
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
  const { password_hash, ...safe } = adv; return safe;
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
