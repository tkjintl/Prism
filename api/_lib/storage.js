import { Redis } from '@upstash/redis';

let _redis = null;
let _kvHealthy = null;
let _mem = new Map();
let kvUnavailable = false;

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!kvUnavailable) {
      kvUnavailable = true;
      console.error('[STORAGE] KV unavailable — using in-memory fallback. DATA WILL BE LOST ON RESTART.');
    }
    return null;
  }
  try { _redis = new Redis({ url, token }); return _redis; }
  catch {
    kvUnavailable = true;
    console.error('[STORAGE] KV unavailable — using in-memory fallback. DATA WILL BE LOST ON RESTART.');
    return null;
  }
}

export function isKvUnavailable() { return kvUnavailable; }

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

export async function zAdd(key, score, member) {
  const r = getRedis();
  if (r) { try { return await r.zadd(key, { score, member }); } catch { /* fall through */ } }
  // In-memory fallback: store as JSON array of {score,member}
  const raw = _mem.get(key);
  const arr = raw ? JSON.parse(raw) : [];
  const idx = arr.findIndex(x => x.member === member);
  if (idx >= 0) arr[idx].score = score; else arr.push({ score, member });
  _mem.set(key, JSON.stringify(arr));
}

export async function zRevRange(key, start, stop) {
  const r = getRedis();
  if (r) { try { return await r.zrange(key, start, stop, { rev: true }); } catch { /* fall through */ } }
  const raw = _mem.get(key);
  if (!raw) return [];
  const arr = JSON.parse(raw).sort((a, b) => b.score - a.score);
  const end = stop === -1 ? arr.length : stop + 1;
  return arr.slice(start, end).map(x => x.member);
}

// Append-only sorted set add (alias with explicit naming for audit log usage)
export async function kvZadd(key, score, member) {
  return zAdd(key, score, member);
}

// Range query for audit sorted set — returns members in score order (ascending by default)
export async function kvZrange(key, start, stop, opts = {}) {
  const r = getRedis();
  if (r) {
    try {
      return opts.rev
        ? await r.zrange(key, start, stop, { rev: true })
        : await r.zrange(key, start, stop);
    } catch { /* fall through */ }
  }
  const raw = _mem.get(key);
  if (!raw) return [];
  const arr = JSON.parse(raw).sort((a, b) => opts.rev ? b.score - a.score : a.score - b.score);
  const end = stop === -1 ? arr.length : stop + 1;
  return arr.slice(start, end).map(x => x.member);
}
