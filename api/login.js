import { signToken, verifyToken, cookieOpts, clearCookieOpts } from './_lib/auth.js';
import { ok, bad, unauth, getCookie, setCookieHeader } from './_lib/http.js';
import { kvGet } from './_lib/storage.js';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 'POST only', 405);

  const { op } = req.query;
  const body = req.body || {};

  // ── Admin login ──────────────────────────────────────────────
  if (!op || op === 'admin') {
    const { email, password } = body;
    if (!email || !password) return bad(res, 'Email and password required');
    const adminStr = process.env.ADMIN_USERS || '';
    const adminMap = Object.fromEntries(
      adminStr.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
        const colonIdx = pair.lastIndexOf(':');
        return [pair.slice(0, colonIdx).toLowerCase(), pair.slice(colonIdx + 1)];
      })
    );
    const emailLower = email.toLowerCase().trim();
    const storedPw = adminMap[emailLower] || '';
    const buf1 = Buffer.alloc(72); Buffer.from(storedPw).copy(buf1);
    const buf2 = Buffer.alloc(72); Buffer.from(password || '').copy(buf2);
    let isAdmin = storedPw.length > 0 && password.length === storedPw.length && timingSafeEqual(buf1, buf2);

    // Fallback: allow KV advisors flagged is_admin:true (e.g. tkj@theaurumcc.com)
    if (!isAdmin) {
      const { kvGet } = await import('./_lib/storage.js');
      const advId = await kvGet(`advisor_email:${emailLower}`);
      if (advId) {
        const adv = await kvGet(`advisor:${advId}`);
        if (adv?.is_admin) {
          const match = await bcrypt.compare(password, adv.password_hash);
          if (match) isAdmin = true;
        }
      }
    }

    if (!isAdmin) return bad(res, 'Invalid credentials', 401);
    const adminToken = await signToken({ email: emailLower, role: 'admin' }, '12h');
    const cookies = [setCookieHeader('prism_admin', adminToken, cookieOpts(43200))];

    // If this admin email also maps to an advisor account, issue advisor cookie too
    // so they can navigate advisor-portal without a separate login
    const { kvGet: _kvGet } = await import('./_lib/storage.js');
    const advId = await _kvGet(`advisor_email:${emailLower}`);
    if (advId) {
      const adv = await _kvGet(`advisor:${advId}`);
      if (adv) {
        const advToken = await signToken({ advisor_id: adv.id, email: adv.email, firm: adv.firm_name, role: 'advisor' }, '7d');
        cookies.push(setCookieHeader('prism_advisor', advToken, cookieOpts(604800)));
      }
    }

    res.setHeader('Set-Cookie', cookies);
    return ok(res, { role: 'admin' });
  }

  // ── Member (TACC) password login ─────────────────────────────
  if (op === 'member-login') {
    const { email, password } = body;
    if (!email || !password) return bad(res, 'Email and password required');
    const { kvGet } = await import('./_lib/storage.js');
    const instId = await kvGet(`inst_email:${email.toLowerCase().trim()}`);
    if (!instId) return bad(res, 'Invalid credentials', 401);
    const inst = await kvGet(`inst:${instId}`);
    if (!inst || inst.status !== 'approved') return bad(res, 'Invalid credentials', 401);
    if (!inst.password_hash) return bad(res, 'Password not set. Use your access code to log in.', 401);
    const match = await bcrypt.compare(password, inst.password_hash);
    if (!match) return bad(res, 'Invalid credentials', 401);
    const token = await signToken({ inst_id: instId, email: inst.email, firm: inst.firm_name, role: 'inst' }, '30d');
    res.setHeader('Set-Cookie', setCookieHeader('prism_inst', token, cookieOpts(2592000)));
    return ok(res, { role: 'inst' });
  }

  // ── Refresh / check ──────────────────────────────────────────
  if (op === 'check') {
    const adminT = getCookie(req, 'prism_admin');
    const advisorT = getCookie(req, 'prism_advisor');
    const instT = getCookie(req, 'prism_inst');
    const payload = await verifyToken(adminT) || await verifyToken(advisorT) || await verifyToken(instT);
    if (!payload) return unauth(res);
    // Check revocation denylist — same check performed in v2.js getAdmin/getAdvisor/getInst
    if (payload.jti) {
      const revoked = await kvGet('revoked:' + payload.jti);
      if (revoked) return unauth(res);
    }
    return ok(res, { role: payload.role });
  }

  return bad(res, 'Unknown op', 400);
}
