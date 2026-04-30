import { Redis } from '@upstash/redis';

let _redis = null;
let _kvHealthy = null;
let _mem = new Map();

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try { _redis = new Redis({ url, token }); return _redis; }
  catch { return null; }
}

async function pingKv() {
  const r = getRedis();
  if (!r) { _kvHealthy = false; return false; }
  try { await r.ping(); _kvHealthy = true; return true; }
  catch { _kvHealthy = false; return false; }
}

export async function healthCheck() {
  const ok = await pingKv();
  return {
    kv: ok ? 'connected' : 'memory-fallback',
    persistent: ok,
    warning: ok ? null : 'KV not connected — data will be lost on cold start. Set KV_REST_API_URL and KV_REST_API_TOKEN.',
    timestamp: new Date().toISOString(),
  };
}

export async function kvGet(key) {
  const r = getRedis();
  if (r) { try { return await r.get(key); } catch { /* fall through */ } }
  return _mem.has(key) ? _mem.get(key) : null;
}

export async function kvSet(key, value, opts = {}) {
  const r = getRedis();
  if (r) { try { return opts.ex ? await r.set(key, value, { ex: opts.ex }) : await r.set(key, value); } catch { /* fall through */ } }
  _mem.set(key, value);
  if (opts.ex) setTimeout(() => _mem.delete(key), opts.ex * 1000);
  return 'OK';
}

export async function kvDel(key) {
  const r = getRedis();
  if (r) { try { return await r.del(key); } catch { /* fall through */ } }
  _mem.delete(key); return 1;
}

export async function kvKeys(pattern) {
  const r = getRedis();
  if (r) { try { return await r.keys(pattern); } catch { /* fall through */ } }
  const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return [..._mem.keys()].filter(k => re.test(k));
}

export async function kvSetnx(key, value) {
  const r = getRedis();
  if (r) { try { return await r.setnx(key, value); } catch { /* fall through */ } }
  if (_mem.has(key)) return 0;
  _mem.set(key, value); return 1;
}

export async function kvIncrby(key, n) {
  const r = getRedis();
  if (r) { try { return await r.incrby(key, n); } catch { /* fall through */ } }
  const cur = parseFloat(_mem.get(key) || '0');
  const next = cur + n; _mem.set(key, String(next)); return next;
}
