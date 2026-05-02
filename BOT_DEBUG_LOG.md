# Bot Debug Log

Single source of truth for every bug surfaced during bot testing. Each entry tagged as **production code** (live platform) or **bot infrastructure** (test harness only). Production bugs are why we run this.

**Statuses:** ✅ FIXED · ⚠️ NEEDS REVERT · ❌ OPEN · 🧹 CLEANUP

Each entry includes file path + line numbers + exact diff prescription, so all open items can be applied as a batch later.

---

# Open / Pending Fixes (apply in this order)

## P-6 · `recalcIoiCounters` race condition ❌ OPEN — HIGH PRIORITY

**Files:** `api/_lib/deal-storage.js`, `api/v2.js`
**Severity:** High (money-relevant)
**Symptom:** When two IOIs are submitted concurrently to the same deal, `deal.ioi_count` and `deal.ioi_agg_usd` drift. Last write wins. Audit reports `declared_count = N+1, actual_count = N` after high-concurrency runs.

**Root cause:** `api/_lib/deal-storage.js:16–27`. Read-modify-write pattern with no concurrency control:
```
read deal -> read all IOIs -> compute count -> write deal
```

**Recommended fix — Option A (atomic counters):**

The cleanest race-free fix. ~30 lines plus 5 call-site updates.

### A.1 — `api/_lib/deal-storage.js`

**Replace lines 14–27** (the entire `recalcIoiCounters` function):

```js
// Atomic IOI counter delta. Race-safe — uses Redis INCRBY which is atomic.
// dCount: +1 on IOI create or un-reject, -1 on IOI reject. Approve does not
// move the counter (already counted from creation).
// dAggUsd: signed amount delta in dollars. Use parseFloat-able strings.
export async function bumpIoiCounters(dealId, dCount, dAggUsd) {
  await Promise.all([
    kvIncrby(`deal:${dealId}:ioi_count`, dCount),
    kvIncrby(`deal:${dealId}:ioi_agg_usd`, Math.round(dAggUsd)),
  ]);
}

// Manual reconciliation pass — call from admin tool only, NOT from hot paths.
// Reads live IOI records and overwrites the atomic counters. Last line of
// defense if drift is somehow ever detected.
export async function reconcileIoiCounters(dealId) {
  const ioiIds = await kvZrange('ioi_index', 0, -1);
  const allIois = (await Promise.all(ioiIds.map(id => kvGet(`ioi:${id}`)))).filter(Boolean);
  const dealIois = allIois.filter(i => i.deal_id === dealId && i.status !== 'rejected');
  const count = dealIois.length;
  const agg = dealIois.reduce((s, i) => s + (i.amount || 0), 0);
  await Promise.all([
    kvSet(`deal:${dealId}:ioi_count`, count),
    kvSet(`deal:${dealId}:ioi_agg_usd`, Math.round(agg)),
  ]);
  return { ioi_count: count, ioi_agg_usd: agg };
}

// Legacy export kept for backwards-compat — delegates to reconcile.
// Remove once all call sites are migrated to bumpIoiCounters.
export async function recalcIoiCounters(dealId) {
  return reconcileIoiCounters(dealId);
}
```

**Modify `getDeal` (line 33):**
```js
export async function getDeal(id) {
  const [deal, count, agg] = await Promise.all([
    kvGet(`deal:${id}`),
    kvGet(`deal:${id}:ioi_count`),
    kvGet(`deal:${id}:ioi_agg_usd`),
  ]);
  if (!deal) return null;
  return {
    ...deal,
    ioi_count: count == null ? (deal.ioi_count || 0) : Number(count),
    ioi_agg_usd: agg == null ? (deal.ioi_agg_usd || 0) : Number(agg),
  };
}
```

**Modify `listDeals` (line 44):** wrap each `kvGet(\`deal:${id}\`)` to also fetch + merge counters. Or simpler: have listDeals call `getDeal(id)` for each id. Slightly slower but consistent. **Verify cache invalidation** — the `cache:marketplace:*` keys hold the merged response; bumpIoiCounters should bust them so investors see fresh aggregates within 5s.

### A.2 — `api/v2.js` IOI hot-path call sites

Replace each `recalcIoiCounters(...)` in the hot path with `bumpIoiCounters(...)`:

| Line | Op | Current call | Replacement |
|---|---|---|---|
| 649 | `marketplace&op=approve-ioi` (legacy path) | `await recalcIoiCounters(dealId);` | **Delete** (approve doesn't change count, only status) |
| 2364 | `admin&op=delete-investor` (cleanup) | `await recalcIoiCounters(ioi.deal_id);` | `await bumpIoiCounters(ioi.deal_id, -1, -(ioi.amount \|\| 0));` if IOI was non-rejected |
| 3196 | `marketplace&op=ioi` (create) | `await recalcIoiCounters(deal_id);` | `await bumpIoiCounters(deal_id, 1, amt);` |
| 3217 | `marketplace&op=approve-ioi` | `await recalcIoiCounters(ioi.deal_id);` | **Delete** (no count change on approve) |
| 3240 | `marketplace&op=reject-ioi` | `await recalcIoiCounters(ioi.deal_id);` | `await bumpIoiCounters(ioi.deal_id, -1, -(ioi.amount \|\| 0));` if `wasApproved` or `was-pending` (i.e., previous status !== 'rejected') |

**Also bust `cache:marketplace:*` after each bump:**
```js
await kvDel('cache:marketplace:public');
await kvDel('cache:marketplace:admin');
```

### A.3 — `api/_lib/bot-seed.js` initial seed

The seed currently writes `deal.ioi_count` directly on the deal object (lines 364–365). Update so it ALSO sets the atomic counter keys:
```js
await kvSet(`deal:${dealId}`, deal);
await kvSet(`deal:${dealId}:ioi_count`, deal.ioi_count);
await kvSet(`deal:${dealId}:ioi_agg_usd`, deal.ioi_agg_usd);
```

### A.4 — Migration

For existing deals, atomic counter keys don't exist yet. `getDeal` falls back to the embedded `deal.ioi_count` field (line shown in A.1 above) — so legacy data keeps working until the first `bumpIoiCounters` call. No DB migration needed.

**Estimated effort:** ~45 minutes including testing.

**Alternative — Option B (per-deal lock):** simpler, no data-shape change, slightly slower:

```js
export async function recalcIoiCounters(dealId) {
  const lockKey = `lock:recalc:${dealId}`;
  const acquired = await kvSetnx(lockKey, '1');
  if (!acquired) {
    // Another recalc in flight — wait and skip
    await new Promise(r => setTimeout(r, 50));
    return null;
  }
  try {
    // existing recalc body
    ...
  } finally {
    await kvDel(lockKey);
  }
}
```

Lock TTL via `kvSet(lockKey, '1', { ex: 5 })` to prevent stuck locks. Recommend Option A — atomic counters scale better and eliminate the read-modify-write entirely.

---

## B-10 · Audit auto-heal hides P-6 ⚠️ NEEDS REVERT (after P-6 lands)

**File:** `api/v2.js` lines 3095–3132 (sandbox-summary)
**Severity:** Bot-only, but masks production bug

**Current code (commit `2cfd326`):**
```js
const counterMismatchInitial = [];   // line 3095
for (const d of allDeals) { ... }
// Self-heal: recalc on each mismatched deal then re-check.
let counterMismatch = counterMismatchInitial;
let healed = 0;
if (counterMismatchInitial.length > 0) {
  await Promise.all(counterMismatchInitial.map(m => recalcIoiCounters(m.deal_id).catch(() => null)));
  ...
}
```

**Revert to:**
```js
const counterMismatch = [];          // simpler — no auto-heal
for (const d of allDeals) {
  const actualCount = ioiCountByDeal.get(d.id) || 0;
  const actualAgg = ioiAggByDeal.get(d.id) || 0;
  const declaredCount = d.ioi_count || 0;
  const declaredAgg = d.ioi_agg_usd || 0;
  if (actualCount !== declaredCount || actualAgg !== declaredAgg) {
    counterMismatch.push({
      deal_id: d.id,
      declared_count: declaredCount, actual_count: actualCount,
      declared_agg: declaredAgg, actual_agg: actualAgg,
    });
  }
}
if (counterMismatch.length) issues.push({
  type: 'ioi_counter_mismatch', severity: 'medium', count: counterMismatch.length,
  samples: counterMismatch.slice(0, 5),
});
```

**Order:** apply P-6 first, then revert B-10. After P-6, the audit should report 0 mismatches naturally.

---

## OQ-1 — Confirm P-6 fix with bot run
After P-6 + B-10 revert: run bots at MAX for 2 min, click Run Audit. Expected: 0 mismatches.

## OQ-2 — `kvKeys('inst:*')` consistency under load
B-5 fixed the *symptom* via defensive direct lookup. Root cause not investigated. To verify whether real production endpoints (e.g., `admin/list-investors`, `admin/approve` lookup) are vulnerable:
- Add a unit test in `api/v2.js` test suite that writes 200 inst:* keys, then immediately calls `kvKeys('inst:*')` 10× concurrently. If any call returns < 200 keys, the issue is real.
- If real, audit every other `kvKeys(...)` call site (~12 locations in v2.js per `grep -n kvKeys api/v2.js`) and replace with sorted-set-index reads.

## OQ-3 — Deal stage transitions past `dd` not exercised
**Where in code:** AdminBot in `bot-driver.html` only calls `publish-deal` and `push-package`. There's no admin endpoint to advance from `dd → terms → close → realized`.
**Action:** Either add a generic admin op `advance-stage` in `api/v2.js`, or wire AdminBot to call whatever specific endpoint exists for each transition. Then code paths in `api/v2.js` for terms/close/realized stages get exercised.

## OQ-4 — Email triggers under bot load not exercised
**Where in code:** `api/_lib/email.js send()` short-circuits when `BOT_MODE === '1'` (the suppression we want for bot tests).
**Action:** Separate test session with `BOT_MODE` unset and a Resend test API key. Verify each trigger fires at the right point. Not safe to combine with bot test (would blast emails). Defer to manual QA pass before production launch.

## OQ-5 — AI scoring under bot load not exercised
**Where in code:** `api/_lib/ai.js scoreDeal()` short-circuits with synthetic score when `BOT_MODE === '1'`.
**Action:** Same as OQ-4 — separate session with `BOT_MODE` unset and `ANTHROPIC_API_KEY` set. Submit a few deals and inspect AI output.

## OQ-6 — Cron jobs not exercised
**Where in code:** `api/v2.js`: `qa-cron`, `compliance-cron`, `welcome-cron`, `generate-statements-cron`. Schedule defined in `vercel.json`.
**Action:** Trigger each manually via authenticated admin POST with the right query string and verify they handle the lean seed correctly.

---

# Closed (production fixes shipped)

## P-1 · Storage silent fallback ✅ FIXED
**File:** `api/_lib/storage.js`
**Commits:** `99a5b79` (initial fix) → `e088972` (retry/backoff) → `c250337` (no-retry on quota)
**Severity:** Critical — pre-existing bug affecting every read/write across the platform.
**Fix shape:** New `withRedis(op, fallback)` wrapper. If Redis IS configured, errors throw to caller (with 2 retries on transient blips, 0 retries on quota errors). In-memory fallback only when Redis unconfigured.
**Verification after fix:** marketplace endpoint stopped flickering 0/311.

## P-2 · `getAnyAuth` admin-cookie bleed ✅ FIXED
**File:** `api/v2.js` line 133–143
**Commit:** `ee22fef`
**Severity:** High
**Fix shape:** `getAnyAuth()` now reads optional `x-bot-as` header to pin which role's cookie to honor. Header-absent path unchanged.

## P-3 · `deals?op=marketplace` fan-out ✅ FIXED
**File:** `api/v2.js` lines 859–880
**Commit:** `eac0995`
**Severity:** High — would have killed prod under any decent load.
**Fix shape:** 5-second Redis cache (`cache:marketplace:public` / `cache:marketplace:admin`). First call computes ~500 ops; cached calls cost 1 op.

## P-4 · `getAllIois` fan-out ✅ FIXED
**File:** `api/v2.js` lines 152–166
**Commit:** `eac0995`
**Severity:** High — used by 15+ endpoints.
**Fix shape:** 5-second Redis cache (`cache:iois:all`). All 15+ callers transparently benefit.

## P-5 · Storage retries on quota errors ✅ FIXED
**File:** `api/_lib/storage.js`
**Commit:** `c250337`
**Severity:** Medium
**Fix shape:** `isQuotaError(err)` short-circuits retries on quota / 429 / max-requests errors.

---

## C-1 · Failed-revert: Aurum Kilo content ✅ FIXED
**Files:** `index.html`, `investor-portal.html`, `CLAUDE.md`, `.claude/agents/*.md`
**Commits:** `df2c98b`, `46accf5`, `0a25ef5`
**Severity:** High (brand)

## C-2 · Access Tiers section: 1 card under "Two ways" header ✅ FIXED
**Files:** `index.html`, `api/v2.js`
**Commit:** `e2ef1b3`
**Fix shape:** Two-card layout (Institutional + HNW). Required `category` selection on signup. Backend `inst/register` validates `category in {institutional, hnw}`.

## C-3 · `tkjintl@gmail.com` admin 🧹 USER FIXED (env var)
Not in code. User updated `ADMIN_USERS` directly in Vercel.

---

## B-1 through B-9 · Bot test harness fixes ✅ FIXED

| ID | File | Commit | Issue |
|---|---|---|---|
| B-1 | `api/v2.js` | `5fba3f5` | Sandbox endpoints in marketplace block instead of admin block |
| B-2 | `api/_lib/bot-seed.js` | `fb48583` | wipeAll WRONGTYPE on sorted-set keys (used kvGet instead of kvDel) |
| B-3 | `bot-driver.html`, `bot-viewer.html` | `ee22fef` | Counter UI read fields API didn't return |
| B-4 | `api/v2.js` (sandbox-summary) | `1b49f79` | stuck_deals false-positive on idle seeded deals |
| B-5 | `api/v2.js` (sandbox-summary) | `3103da5` | kvKeys('inst:*') occasional miss → orphan_iois false positive — defensive direct lookup added |
| B-6 | `bot-driver.html` (AdminBot, InvestorBot) | `3103da5` | Race noise — soft-skip 404/409 with `(raced — target moved)` |
| B-7 | `api/v2.js` (sandbox-status) | `c250337` | Fan-out caching (5s TTL) |
| B-8 | `bot-driver.html` | `c250337` | Counter polling 1.5s → 6s, paused while idle |
| B-9 | `bot-driver.html` (SPEED_MS) | `eac0995` | MAX speed floored at 50ms |

## B-10 · Audit auto-heal — see Open Fixes section above ⚠️ NEEDS REVERT

---

## O-1 · Upstash quota exhausted (500K) ⚠️ WORKAROUND
New free Upstash database `crisp-kite-113455` created. Vercel env vars updated. Permanent prevention via P-3, P-4, P-5, B-7, B-8, B-9 fixes.

## O-2 · Generic "Internal server error" hid real bugs ✅ FIXED
**File:** `api/v2.js` outer try/catch
**Commit:** `5ab2dee`
**Fix shape:** When `BOT_MODE=1`, 500 responses include actual error message prefixed `[resource/op]`. Production behavior unchanged.

## O-3 · Seed volume reduced ✅ DONE
**Commits:** `ae5de11` → `d99b739`
**Current:** 2 advisors / 4 investors / 10 deals / ~12 IOIs. Reset cost ~90 Redis ops.

---

# Production Fix Queue (apply in this order)

1. **P-6** atomic IOI counters — `api/_lib/deal-storage.js` lines 14–27 (replace recalcIoiCounters), `getDeal` line 33 (merge counter keys), `api/v2.js` 5 call sites (lines 649, 2364, 3196, 3217, 3240), `api/_lib/bot-seed.js` (set counter keys in seed).
2. **B-10** revert audit auto-heal — `api/v2.js` lines 3095–3132 → restore simpler block per spec above.
3. **OQ-2** investigate kvKeys consistency — quick stress test, then audit ~12 call sites if real.
4. **OQ-3** add stage advancement endpoint or extend AdminBot — to exercise `terms / close / realized` paths.
5. **OQ-4 / OQ-5 / OQ-6** — manual QA passes with `BOT_MODE` off for emails / AI / crons.

---

*Last updated: 2026-05-02. Append entries to top of relevant section as new bugs surface. Each entry should include file path, line numbers (current at time of entry), and a complete diff prescription so we never have to re-investigate.*
