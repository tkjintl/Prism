import { verifyToken, signToken, signResetCode, verifyResetToken, cookieOpts, clearCookieOpts } from './_lib/auth.js';
import { ok, bad, unauth, getCookie, setCookieHeader } from './_lib/http.js';
import { kvGet, kvSet, kvDel, kvKeys, kvSetnx, kvIncrby, healthCheck } from './_lib/storage.js';
import { createDeal, updateDeal, getDeal, saveDeal, listDeals, seedDeals, seedIois } from './_lib/deal-storage.js';
import {
  sendAccessCode, sendDealReceived, sendStageChange,
  sendDataRoomAccess, sendAccessApplication,
  sendAdvisorWelcome, sendPasswordReset, sendIoiPackage,
} from './_lib/email.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  const { resource, op } = req.query;

  // ── CORS for dev ────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── Health check ────────────────────────────────────────────
  if (resource === 'health') {
    const h = await healthCheck();
    return ok(res, h);
  }

  // ── Auth helpers ─────────────────────────────────────────────
  async function getAdmin() {
    const t = getCookie(req, 'prism_admin');
    if (!t) return null;
    const p = await verifyToken(t);
    return p?.role === 'admin' ? p : null;
  }
  async function getAdvisor() {
    const t = getCookie(req, 'prism_advisor');
    if (!t) return null;
    const p = await verifyToken(t);
    return p?.role === 'advisor' ? p : null;
  }
  async function getInst() {
    const t = getCookie(req, 'prism_inst');
    if (!t) return null;
    const p = await verifyToken(t);
    return p?.role === 'inst' ? p : null;
  }
  async function getAnyAuth() {
    return await getAdmin() || await getAdvisor() || await getInst();
  }

  // ─────────────────────────────────────────────────────────────
  // ADVISOR RESOURCE
  // ─────────────────────────────────────────────────────────────
  if (resource === 'advisor') {

    if (op === 'login') {
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
      if (password.length < 1) return bad(res, 'Password required');
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
      res.setHeader('Set-Cookie', setCookieHeader('prism_advisor', '', clearCookieOpts()));
      return ok(res);
    }

    if (op === 'me') {
      const adv = await getAdvisor();
      if (!adv) return unauth(res);
      const full = await kvGet(`advisor:${adv.advisor_id}`);
      if (!full) return unauth(res);
      let deals = await listDeals({ advisor_id: adv.advisor_id });
      // Auto-seed on fresh deploy so advisor always sees their deals
      if (deals.length === 0) {
        try { await seedAdvisors(); await seedDeals(); deals = await listDeals({ advisor_id: adv.advisor_id }); }
        catch (e) { /* seed unavailable */ }
      }
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
        return ok(res, { deal });
      }

      // GET: list advisor's deals
      let deals = adv ? await listDeals({ advisor_id: adv.advisor_id }) : await listDeals();
      // Auto-seed if empty — fresh deploy or KV not yet populated
      if (deals.length === 0) {
        try {
          await seedAdvisors();
          await seedInvestors();
          await seedDeals();
          deals = adv ? await listDeals({ advisor_id: adv.advisor_id }) : await listDeals();
        } catch (e) { /* seed unavailable — return empty */ }
      }
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
      if (password.length < 1) return bad(res, 'Password required');
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
        await kvSet(`vdr:${dealId}:file:${file.id}`, file.data);
        const meta = {
          id: file.id,
          name: file.name,
          size: file.size || 0,
          folder: file.folder || '',
          type: file.type || 'application/octet-stream',
          uploadedAt: new Date().toISOString(),
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
        deal.ioi_agg_usd = (deal.ioi_agg_usd || 0) + (pkg.indicatedTotal || 0);
        deal.ioi_count = (deal.ioi_count || 0) + (pkg.iois?.length || 0);
      }
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({ at: new Date().toISOString(), actor: adv.advisor_id, action: `package_${decision}`, meta: { packageId } });
      deal.updated_at = new Date().toISOString();
      await saveDeal(deal);
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
      let deals = await listDeals({ live: true });
      // Auto-seed on fresh deploy — if KV has no live deals, seed silently so the
      // marketplace is never empty without manual "Load Test Data" action
      if (deals.length === 0) {
        try {
          await seedAdvisors();
          await seedInvestors();
          await seedDeals();
          deals = await listDeals({ live: true });
        } catch (e) {
          // Seed failed (e.g. no KV configured) — proceed with empty array
        }
      }
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
      const sig = req.headers['x-tacc-signature'];
      const bridgeSecret = process.env.PRISM_TACC_BRIDGE_SECRET;
      if (bridgeSecret && sig !== bridgeSecret) return unauth(res, 'Invalid bridge signature');
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

    let deals = await listDeals();
    // Auto-heal: if KV has stale/partial data, force reseed before returning
    if (deals.length < 8) {
      try {
        await seedAdvisors();
        await seedInvestors();
        await seedDeals(true);
        await seedIois(true);
        deals = await listDeals();
      } catch (e) { /* seed unavailable — return what we have */ }
    }
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
      // ioiId is 'approved' for the dedup sentinel set by approve-ioi — look up by scan
      // The dedup value was set to 'approved' (a string), so we need the actual IOI id.
      // Scan ioi:IOI-* for the matching record.
      const ioiKeys = await kvKeys('ioi:IOI-*');
      const iois = (await Promise.all(ioiKeys.map(k => kvGet(k)))).filter(Boolean);
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

      const data = await kvGet(`vdr:${dealId}:file:${fileId}`);
      if (!data) return bad(res, 'File content not found', 404);

      return ok(res, {
        ok: true,
        name: fileMeta.name,
        type: fileMeta.type,
        data,
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
      const qa = (await kvGet(`qa:${dealId}`)) || [];
      qa.push({
        id: qaId,
        question: question.trim(),
        askedBy: inst.firm_name || inst.contact_name || instAuth.inst_id,
        askedAt: new Date().toISOString(),
        answer: null,
        answeredAt: null,
        answeredBy: null,
      });
      await kvSet(`qa:${dealId}`, qa);

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
      const adminPayload = await verifyToken(getCookie(req, 'prism_admin'));
      if (!adminPayload) return unauth(res);
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
      const adminPayload = await verifyToken(getCookie(req, 'prism_admin'));
      if (!adminPayload) return unauth(res);
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
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
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
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: 'user', content: [...docBlocks, { type: 'text', text: userPrompt }] }],
          }),
        });
        if (!response.ok) {
          const err = await response.text();
          console.error('Claude API error:', err);
          return bad(res, 'AI generation failed', 500);
        }
        const result = await response.json();
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
        const allKeys = await kvKeys('deal:*');
        await Promise.all(allKeys.map(async key => {
          const other = await kvGet(key);
          if (other && other.id !== dealId && other.featured) {
            other.featured = false;
            await kvSet(key, other);
          }
        }));
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
      const ioiKeys = await kvKeys('ioi:IOI-*');
      const allIois = (await Promise.all(ioiKeys.map(k => kvGet(k)))).filter(Boolean);
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
      const ioiKeys = await kvKeys('ioi:IOI-*');
      const allIois = (await Promise.all(ioiKeys.map(k => kvGet(k)))).filter(Boolean);
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
      const ioiKeys = await kvKeys('ioi:IOI-*');
      const allIois = (await Promise.all(ioiKeys.map(k => kvGet(k)))).filter(Boolean);
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
      const ioiKeys = await kvKeys('ioi:IOI-*');
      const allIois = (await Promise.all(ioiKeys.map(k => kvGet(k)))).filter(Boolean);
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
      // Dedup check
      const investorId = auth.inst_id || auth.advisor_id || auth.email;
      const dedupKey = `ioi_exists:${deal_id}:${investorId}`;
      const alreadyExists = await kvGet(dedupKey);
      if (alreadyExists && alreadyExists !== 'rejected') return bad(res, 'You have already submitted an IOI for this deal');
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
      await kvSet(dedupKey, 'pending');
      // Increment deal counters
      await kvIncrby(`deal_ioi_count:${deal_id}`, 1);
      await kvIncrby(`deal_ioi_agg:${deal_id}`, amt);
      // Sync back to deal object
      const updatedDeal = await getDeal(deal_id);
      if (updatedDeal) {
        updatedDeal.ioi_count = (updatedDeal.ioi_count || 0) + 1;
        updatedDeal.ioi_agg_usd = (updatedDeal.ioi_agg_usd || 0) + amt;
        await kvSet(`deal:${deal_id}`, updatedDeal);
      }
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
      // DECREMENT deal counters (fix audit finding)
      const deal = await getDeal(ioi.deal_id);
      if (deal && ioi.amount) {
        deal.ioi_count = Math.max(0, (deal.ioi_count || 0) - 1);
        deal.ioi_agg_usd = Math.max(0, (deal.ioi_agg_usd || 0) - ioi.amount);
        await kvSet(`deal:${ioi.deal_id}`, deal);
      }
      return ok(res, { ioi });
    }

    if (op === 'my-iois') {
      const auth = await getAnyAuth();
      if (!auth) return unauth(res);
      const investorId = auth.inst_id || auth.advisor_id || auth.email;
      const keys = await kvKeys('ioi:IOI-*');
      const iois = (await Promise.all(keys.map(k => kvGet(k)))).filter(i => i && i.investor_id === investorId);
      return ok(res, { iois });
    }

    if (op === 'deal-iois') {
      const admin = await getAdmin();
      if (!admin) return unauth(res);
      const { deal_id } = req.query;
      const keys = await kvKeys('ioi:IOI-*');
      const all = await Promise.all(keys.map(k => kvGet(k)));
      const iois = all.filter(i => i && (!deal_id || i.deal_id === deal_id));
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
