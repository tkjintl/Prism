import { verifyToken } from './_lib/auth.js';
import { ok, unauth, getCookie } from './_lib/http.js';

export default async function handler(req, res) {
  const adminT   = getCookie(req, 'prism_admin');
  const advisorT = getCookie(req, 'prism_advisor');
  const instT    = getCookie(req, 'prism_inst');
  const payload  = await verifyToken(adminT) || await verifyToken(advisorT) || await verifyToken(instT);
  if (!payload) return unauth(res, 'Not authenticated');
  return ok(res, {
    role:   payload.role,
    email:  payload.email,
    name:   payload.name || null,
    firm:   payload.firm || null,
    id:     payload.advisor_id || payload.inst_id || null,
  });
}
