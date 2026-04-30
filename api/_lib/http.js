export const ok  = (res, data = {})            => res.status(200).json({ ok: true,  ...data });
export const bad = (res, msg = 'Bad request', code = 400) => res.status(code).json({ ok: false, error: msg });
export const unauth = (res, msg = 'Unauthorized') => res.status(401).json({ ok: false, error: msg });
export const notFound = (res, msg = 'Not found')  => res.status(404).json({ ok: false, error: msg });

export function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setCookieHeader(name, value, opts) {
  return `${name}=${encodeURIComponent(value)}; ${opts}`;
}
