import { healthCheck } from './_lib/storage.js';

async function checkBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { connected: false, reason: 'BLOB_READ_WRITE_TOKEN not set' };
  try {
    const { list } = await import('@vercel/blob');
    await list({ token, limit: 1 });
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

export default async function handler(req, res) {
  const [h, blob] = await Promise.all([healthCheck(), checkBlob()]);
  res.status(h.persistent ? 200 : 503).json({ ok: h.persistent, ...h, blob });
}
