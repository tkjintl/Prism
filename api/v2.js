import { verifyToken, signToken, signResetCode, verifyResetToken, cookieOpts, clearCookieOpts } from './_lib/auth.js';
import { ok, bad, unauth, getCookie, setCookieHeader } from './_lib/http.js';
import { kvGet, kvSet, kvDel, kvKeys, kvSetnx, kvIncrby, healthCheck } from './_lib/storage.js';
import { createDeal, updateDeal, getDeal, saveDeal, listDeals, seedDeals } from './_lib/deal-storage.js';
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
      const token = await signToken({ advisor_id: adv.id, email: adv.email, firm: adv.firm_name, role: 'advisor' }, '7d');
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
      const token = await signToken({ advisor_id: adv.id, email: adv.email, firm: adv.firm_name, role: 'advisor' }, '7d');
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
      const deals = await listDeals({ advisor_id: adv.advisor_id });
      return ok(res, { advisor: sanitizeAdvisor(full), deals });
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
      // Strip internal fields for non-admin
      const admin = await getAdmin();
      const safe = admin ? deals : deals.map(d => { const { advisor_id, audit_log, ...rest } = d; return rest; });
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
      const dealIds = await seedDeals();
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
        // Stage change email
        if (result.stage_changed) {
          const advId = result.deal.advisor_id;
          if (advId && advId.startsWith('adv-')) {
            const adv = await kvGet(`advisor:${advId}`);
            if (adv) await sendStageChange(result.deal, adv, result.new_stage).catch(console.error);
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
      const { email, code } = req.body || {};
      if (!email || !code) return bad(res, 'Email and access code required');
      const instId = await kvGet(`inst_email:${email.toLowerCase().trim()}`);
      if (!instId) return bad(res, 'Invalid credentials', 401);
      const inst = await kvGet(`inst:${instId}`);
      if (!inst || inst.status !== 'approved') return bad(res, 'Access not yet approved or invalid credentials', 401);
      if (inst.code !== code.toUpperCase().trim()) return bad(res, 'Invalid access code', 401);
      const token = await signToken({ inst_id: instId, email: inst.email, firm: inst.firm_name, role: 'inst' }, '30d');
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
      if (!apiKey) return bad(res, 'ANTHROPIC_API_KEY not configured', 500);
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
  "highlights": ["bullet 1", "bullet 2", "bullet 3", "bullet 4"],
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

      // Merge content fields
      if (tagline  !== undefined) deal.tagline    = tagline;
      if (thesis   !== undefined) deal.thesis     = thesis;
      if (highlights !== undefined) deal.highlights = highlights;
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

      // Audit log on deal
      deal.audit_log = deal.audit_log || [];
      deal.audit_log.push({
        at: new Date().toISOString(),
        actor: admin.email,
        action: 'package_pushed',
        meta: { packageId: pkg.packageId, approvedCount: approvedIois.length, indicatedTotal },
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
    { id:'adv-tkj', email:'tkj@theaurumcc.com', firm_name:'TACC Pte Ltd', name:'Thomas K J', intro_fee_pct:1, carry_pct:0, status:'active', requires_setup:false, temp_pw:'1234' },
    { id:'adv-sg1', email:'sarah@capitalgroup.sg', firm_name:'SG Capital Group', name:'Sarah Chen', intro_fee_pct:1, carry_pct:0, status:'active', requires_setup:false },
    { id:'adv-mc1', email:'jtan@meridiancap.com', firm_name:'Meridian Capital', name:'James Tan', intro_fee_pct:1, carry_pct:0, status:'active', requires_setup:false },
    { id:'adv-pb1', email:'dliu@pacificbridge.com', firm_name:'Pacific Bridge Partners', name:'David Liu', intro_fee_pct:1.5, carry_pct:5, status:'active', requires_setup:false },
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
    { id:'inv-tkj', email:'tkj@theaurumcc.com', firm_name:'TACC Pte Ltd', contact_name:'Thomas K J', institution_type:'Family Office', aum_range:'Over $1B', ticket_range:'Over $5M', status:'approved', code:'TKJDEV1' },
    { id:'inv-001', email:'jwc@theaurumcc.com', firm_name:'Meridian Family Office', contact_name:'James Walker', institution_type:'Family Office', aum_range:'$50M–$250M', ticket_range:'$1M–$5M', status:'approved', code:'1234' },
    { id:'inv-002', email:'priya@atlascap.com', firm_name:'Atlas Capital Management', contact_name:'Priya Sharma', institution_type:'Institutional Fund', aum_range:'$250M–$1B', ticket_range:'Over $5M', status:'pending', code:null },
    { id:'inv-003', email:'m.chen@northfield.edu', firm_name:'Northfield Endowment', contact_name:'Michael Chen', institution_type:'Endowment', aum_range:'Over $1B', ticket_range:'$1M–$5M', status:'pending', code:null },
    { id:'inv-004', email:'skim@pacificavc.com', firm_name:'Pacifica Ventures', contact_name:'Sarah Kim', institution_type:'PE / VC Fund', aum_range:'$50M–$250M', ticket_range:'$250K–$1M', status:'approved', code:'INST-Q3PX7KMN' },
    { id:'inv-005', email:'dliu@egf.com', firm_name:'Eastern Growth Fund', contact_name:'David Liu', institution_type:'Institutional Fund', aum_range:'$250M–$1B', ticket_range:'$1M–$5M', status:'approved', code:'INST-B8WZK4LR' },
  ];
  for (const i of investors) {
    const exists = await kvGet(`inst:${i.id}`);
    if (!exists || i.id === 'inv-tkj' || i.id === 'inv-001') {
      i.created_at = i.created_at || new Date().toISOString();
      await kvSet(`inst:${i.id}`, i);
      await kvSet(`inst_email:${i.email}`, i.id);
      if (i.code) await kvSet(`inst_code:${i.code}`, i.id);
    }
  }
}
