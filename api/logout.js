import { ok } from './_lib/http.js';
import { clearCookieOpts, cookieOpts } from './_lib/auth.js';
import { setCookieHeader } from './_lib/http.js';

export default async function handler(req, res) {
  const cookies = ['prism_admin','prism_advisor','prism_inst','prism_access'].map(
    name => setCookieHeader(name, '', clearCookieOpts())
  );
  res.setHeader('Set-Cookie', cookies);
  return ok(res, { message: 'Logged out' });
}
