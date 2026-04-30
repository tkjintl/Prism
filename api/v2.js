import { verifyToken, signToken, signResetCode, verifyResetToken, cookieOpts, clearCookieOpts } from './_lib/auth.js';
import { ok, bad, unauth, getCookie, setCookieHeader } from './_lib/http.js';
import { kvGet, kvSet, kvDel, kvKeys, kvSetnx, kvIncrby, healthCheck } from './_lib/storage.js';
import { createDeal, updateDeal, getDeal, listDeals, seedDeals } from './_lib/deal-storage.js';
import {
  sendAccessCode, sendDealReceived, sendStageChange,
  sendDataRoomAccess, sendAccessApplication,
  sendAdvisorWelcome, sendPasswordReset,
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
      const deals = await listDeals({ live: true });
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
        stage: d.stage, mk_notes: d.mk_notes, highlights: d.highlights || [],
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
    { id:'inv-tkj', email:'tkj@theaurumcc.com', firm_name:'TACC Pte Ltd', contact_name:'Thomas K J', institution_type:'Family Office', aum_range:'Over $1B', ticket_range:'Over $5M', status:'approved', code:'1234' },
    { id:'inv-001', email:'james@meridianfund.com', firm_name:'Meridian Family Office', contact_name:'James Walker', institution_type:'Family Office', aum_range:'$50M–$250M', ticket_range:'$1M–$5M', status:'approved', code:'INST-K7MQ2WXN' },
    { id:'inv-002', email:'priya@atlascap.com', firm_name:'Atlas Capital Management', contact_name:'Priya Sharma', institution_type:'Institutional Fund', aum_range:'$250M–$1B', ticket_range:'Over $5M', status:'pending', code:null },
    { id:'inv-003', email:'m.chen@northfield.edu', firm_name:'Northfield Endowment', contact_name:'Michael Chen', institution_type:'Endowment', aum_range:'Over $1B', ticket_range:'$1M–$5M', status:'pending', code:null },
    { id:'inv-004', email:'skim@pacificavc.com', firm_name:'Pacifica Ventures', contact_name:'Sarah Kim', institution_type:'PE / VC Fund', aum_range:'$50M–$250M', ticket_range:'$250K–$1M', status:'approved', code:'INST-Q3PX7KMN' },
    { id:'inv-005', email:'dliu@egf.com', firm_name:'Eastern Growth Fund', contact_name:'David Liu', institution_type:'Institutional Fund', aum_range:'$250M–$1B', ticket_range:'$1M–$5M', status:'approved', code:'INST-B8WZK4LR' },
  ];
  for (const i of investors) {
    const exists = await kvGet(`inst:${i.id}`);
    if (!exists || i.id === 'inv-tkj') {
      i.created_at = i.created_at || new Date().toISOString();
      await kvSet(`inst:${i.id}`, i);
      await kvSet(`inst_email:${i.email}`, i.id);
      if (i.code) await kvSet(`inst_code:${i.code}`, i.id);
    }
  }
}
