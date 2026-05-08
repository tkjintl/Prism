import { verifyToken } from './_lib/auth.js';
import { ok, bad, unauth, getCookie } from './_lib/http.js';
import { kvSet } from './_lib/storage.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const VALID_SLOTS = new Set(['nda', 'mgmt', 'fin', 'term']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 'Method not allowed', 405);

  const { slot, name, type, data, dealId, tempId } = req.body || {};

  if (!slot || !VALID_SLOTS.has(slot)) return bad(res, 'Invalid slot. Must be one of: nda, mgmt, fin, term');
  if (!name || typeof name !== 'string') return bad(res, 'name required');
  if (!type || typeof type !== 'string') return bad(res, 'type required');
  if (!data || typeof data !== 'string') return bad(res, 'data (base64) required');
  if (data.length > 2_800_000) return res.status(413).json({ ok: false, error: 'File too large. Maximum 2MB.' });

  const now = new Date().toISOString();
  const docValue = { name, type, data, size: data.length, uploaded_at: now };

  // Admin path: store to temp key with 1hr TTL
  const adminToken = getCookie(req, 'prism_admin');
  if (adminToken) {
    const adminPayload = await verifyToken(adminToken);
    if (adminPayload && adminPayload.role === 'admin') {
      if (!tempId) return bad(res, 'tempId required for admin doc uploads');
      await kvSet(`pdoc_admin:${tempId}:${slot}`, docValue, { ex: 3600 });
      return ok(res, { ok: true, slot, name });
    }
  }

  // Advisor path
  const token = getCookie(req, 'prism_advisor');
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'advisor') return unauth(res);

  const advisorId = payload.advisor_id;

  if (dealId) {
    await kvSet(`deal_doc:${dealId}:${slot}`, docValue);
  } else {
    await kvSet(`pdoc:${advisorId}:${slot}`, docValue, { ex: 86400 });
    await kvSet(`pdoc_meta:${advisorId}:${slot}`, { name, type, size: data.length });
  }

  return ok(res, { ok: true, slot, name });
}
