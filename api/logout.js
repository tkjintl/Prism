import { ok } from './_lib/http.js';
import { clearCookieOpts, verifyToken } from './_lib/auth.js';
import { setCookieHeader, getCookie } from './_lib/http.js';
import { kvSet } from './_lib/storage.js';

export default async function handler(req, res) {
  // Revoke admin token jti so it can't be reused within its 12h TTL
  const adminT = getCookie(req, 'prism_admin');
  if (adminT) {
    const p = await verifyToken(adminT);
    if (p?.jti) await kvSet('revoked:' + p.jti, '1', { ex: 43200 }).catch(() => {});
  }
  const cookies = ['prism_admin','prism_advisor','prism_inst','prism_access'].map(
    name => setCookieHeader(name, '', clearCookieOpts())
  );
  res.setHeader('Set-Cookie', cookies);
  return ok(res, { message: 'Logged out' });
}
