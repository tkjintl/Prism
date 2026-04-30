import { ok } from './_lib/http.js';
import { healthCheck } from './_lib/storage.js';

export default async function handler(req, res) {
  const h = await healthCheck();
  res.status(h.persistent ? 200 : 503).json({ ok: h.persistent, ...h });
}
