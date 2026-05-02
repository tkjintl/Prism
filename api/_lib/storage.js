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

// ─────────────────────────────────────────────────────────────────────────────
// Storage primitives.
//
// Failure mode contract: if Redis IS configured (`getRedis()` returns non-null),
// errors from the Redis client are thrown to the caller. Silently falling
// through to the empty in-memory `_mem` map in production hides outages and
// returns wrong data (zero deals, missing investors, lost writes).
//
// In-memory fallback only applies when Redis is NOT configured at all
// (local dev with no KV_REST_API_* env vars). One retry on transient errors
// is performed before throwing — Upstash REST has occasional connection blips.
// ─────────────────────────────────────────────────────────────────────────────

function isQuotaError(err) {
  const msg = (err?.message || String(err || '')).toLowerCase();
  return msg.includes('max requests limit') || msg.includes('quota') || msg.includes('429') || msg.includes('exceeded');
}

async function withRedis(op, fallback) {
  const r = getRedis();
  if (!r) return await fallback();
  // 2 retries with backoff (100ms / 400ms) for transient REST blips.
  // DO NOT retry on quota / 429 / max-requests errors — retries multiply
  // billable commands against an already-exhausted quota and never recover.
  // Surface quota errors immediately so the platform fails fast and the
  // operator sees the real problem.
  const delays = [100, 400];
  let lastErr = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await op(r);
    } catch (e) {
      lastErr = e;
      if (isQuotaError(e)) {
        console.error('[STORAGE] Quota exhausted — not retrying:', e?.message);
        throw e;
      }
      if (attempt < delays.length) {
        await new Promise(res => setTimeout(res, delays[attempt]));
      }
    }
  }
  console.error('[STORAGE] Redis op failed after retries:', lastErr?.message || lastErr);
  throw lastErr;
}

export async function kvGet(key) {
  return await withRedis(
    r => r.get(key),
    () => (_mem.has(key) ? _mem.get(key) : null)
  );
}

export async function kvSet(key, value, opts = {}) {
  return await withRedis(
    r => opts.ex ? r.set(key, value, { ex: opts.ex }) : r.set(key, value),
    () => {
      _mem.set(key, value);
      if (opts.ex) setTimeout(() => _mem.delete(key), opts.ex * 1000);
      return 'OK';
    }
  );
}

export async function kvDel(key) {
  return await withRedis(
    r => r.del(key),
    () => { _mem.delete(key); return 1; }
  );
}

export async function kvKeys(pattern) {
  return await withRedis(
    r => r.keys(pattern),
    () => {
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return [..._mem.keys()].filter(k => re.test(k));
    }
  );
}

export async function kvSetnx(key, value) {
  return await withRedis(
    r => r.setnx(key, value),
    () => {
      if (_mem.has(key)) return 0;
      _mem.set(key, value); return 1;
    }
  );
}

export async function kvIncrby(key, n) {
  return await withRedis(
    r => r.incrby(key, n),
    () => {
      const cur = parseFloat(_mem.get(key) || '0');
      const next = cur + n; _mem.set(key, String(next)); return next;
    }
  );
}

export async function zAdd(key, score, member) {
  return await withRedis(
    r => r.zadd(key, { score, member }),
    () => {
      const raw = _mem.get(key);
      const arr = raw ? JSON.parse(raw) : [];
      const idx = arr.findIndex(x => x.member === member);
      if (idx >= 0) arr[idx].score = score; else arr.push({ score, member });
      _mem.set(key, JSON.stringify(arr));
    }
  );
}

export async function zRevRange(key, start, stop) {
  return await withRedis(
    r => r.zrange(key, start, stop, { rev: true }),
    () => {
      const raw = _mem.get(key);
      if (!raw) return [];
      const arr = JSON.parse(raw).sort((a, b) => b.score - a.score);
      const end = stop === -1 ? arr.length : stop + 1;
      return arr.slice(start, end).map(x => x.member);
    }
  );
}

// Append-only sorted set add (alias with explicit naming for audit log usage)
export async function kvZadd(key, score, member) {
  return zAdd(key, score, member);
}

// Remove a member from a sorted set
export async function kvZrem(key, member) {
  return await withRedis(
    r => r.zrem(key, member),
    () => {
      const raw = _mem.get(key);
      if (!raw) return 0;
      const arr = JSON.parse(raw).filter(x => x.member !== member);
      _mem.set(key, JSON.stringify(arr));
      return 1;
    }
  );
}

// SCAN-based key deletion. Iterates with cursor until exhausted, batching DELs.
// Returns count of keys deleted. Used by bot-seed wipeAll — never use KEYS in prod.
export async function kvScanDel(pattern, batchSize = 200) {
  const r = getRedis();
  let total = 0;
  if (r) {
    let cursor = '0';
    do {
      const result = await r.scan(cursor, { match: pattern, count: batchSize });
      // Upstash returns [nextCursor, keysArray]
      const next = Array.isArray(result) ? result[0] : result.cursor;
      const keys = Array.isArray(result) ? result[1] : result.keys;
      cursor = String(next);
      if (keys && keys.length) {
        // Batch DELs in groups of 50 to avoid hitting payload limits
        for (let i = 0; i < keys.length; i += 50) {
          const slice = keys.slice(i, i + 50);
          await Promise.all(slice.map(k => r.del(k).catch(() => 0)));
          total += slice.length;
        }
      }
    } while (cursor !== '0');
    return total;
  }
  // In-memory fallback (Redis not configured)
  const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const k of [..._mem.keys()]) {
    if (re.test(k)) { _mem.delete(k); total++; }
  }
  return total;
}

// Range query for audit sorted set — returns members in score order (ascending by default)
export async function kvZrange(key, start, stop, opts = {}) {
  return await withRedis(
    r => opts.rev
      ? r.zrange(key, start, stop, { rev: true })
      : r.zrange(key, start, stop),
    () => {
      const raw = _mem.get(key);
      if (!raw) return [];
      const arr = JSON.parse(raw).sort((a, b) => opts.rev ? b.score - a.score : a.score - b.score);
      const end = stop === -1 ? arr.length : stop + 1;
      return arr.slice(start, end).map(x => x.member);
    }
  );
}
