# Bot Debug Log

Single source of truth for every bug surfaced during bot testing. Each entry tagged as **production code** (live platform) or **bot infrastructure** (test harness only). Production bugs are why we run this.

**Statuses:** ✅ FIXED · ⚠️ NEEDS REVERT · ❌ OPEN · 🧹 CLEANUP

Each entry includes file path + line numbers + exact diff prescription, so all open items can be applied as a batch later.

---

# Open / Pending Fixes (apply in this order)

## P-9 · `marketplace&op=approve-ioi` not idempotent ❌ OPEN — production bug

**File:** `api/v2.js` line ~3196 (approve-ioi handler)
**Severity:** High — duplicate emails to investors in production
**Symptom in bot test:** AdminBot reads cached sandbox-status (5s TTL); within one cache window, ~12 ticks at 5× speed all see the same pending IOI and approve it. API happily re-approves on every call. Action log shows "Approved IOI IOI-DL-BOT0008-001" four times in 4 seconds.
**Production impact:** an operator double-clicking the Approve button, or a network retry, sends `sendDataRoomAccess(...)` email to the investor multiple times.

**Fix prescription (when batching):**

In `api/v2.js`, locate the approve-ioi handler. Right after `const ioi = await kvGet(...)` and the `if (!ioi) return bad('IOI not found', 404)` line, add:
```js
if (ioi.status === 'approved') {
  return ok(res, { ioi, idempotent: true });
}
```
Body unchanged otherwise. The kvSet + counter recalc + email send only runs on the first call; subsequent calls return the existing IOI without side effects.

---

## P-10 · `admin&op=publish-deal` not idempotent ❌ OPEN — production bug

**File:** `api/v2.js` line ~1654 (publish-deal handler)
**Severity:** Medium — duplicate audit entries + duplicate stage_changed emails
**Symptom in bot test:** "Published 'Northwind Renewables Fund · 2024-06' to live" appeared 5 times in 5 seconds.
**Production impact:** if an operator clicks Publish twice (or a retry), the audit log gets duplicate `stage_changed` entries and the email-on-stage-change fires multiple times.

**Fix prescription:**

After `const deal = await getDeal(dealId)` and the `if (!deal) return bad(...)` line:
```js
if (deal.stage === 'live') {
  return ok(res, { deal, idempotent: true });
}
```
Place this BEFORE the `validateDealForPublish(deal)` call so re-publishing doesn't re-validate (the deal is already live, validation passed once).

---

## P-11 · `admin&op=approve` (investor) not idempotent ❌ OPEN — production bug

**File:** `api/v2.js` line ~1444 (admin approve handler)
**Severity:** High — duplicate access-code emails to investors
**Symptom in bot test:** "Approved investor Ashford Family Office" appeared 4 times in 6 seconds.
**Production impact:** a real investor receives multiple "your access code is X" emails, eroding trust. Worse: each call generates a NEW `code` via `'INST-' + generateCode()` and overwrites `inst.code`, so each call also INVALIDATES the previously-emailed code. If they were on the line of receiving codes 1, 2, 3, only code 3 works — codes 1 and 2 are dead.

**Fix prescription:**

After `const inst = await kvGet(...)` and `if (!inst) return bad('Institution not found', 404)`, BEFORE the `reveal_code` branch:
```js
// reveal_code is the explicit re-fetch path — leave that flow unchanged.
if (!reveal_code && inst.status === 'approved') {
  return ok(res, { inst: sanitizeInst(inst), idempotent: true });
}
```
This preserves the existing `reveal_code` flow (operator can ask to see the code for an already-approved investor) while preventing accidental re-approval from rotating the code or re-firing the email.

**Code rotation as a separate concern:** the access code SHOULD only be generated once. If lost, operator should reset via a deliberate `op=rotate-code` endpoint, not by re-clicking Approve. That's a follow-up.

---

## P-7 · No required-content gating before deal can be published ✅ FIXED

**Files:** `api/_lib/deal-storage.js`, `api/v2.js`, `advisor-portal.html`, `admin-portal.html`, `bot-driver.html`
**Commit:** (this session)
**Severity:** Was: Medium-High. Now: closed.
**Fix shipped:**
1. New `validateDealForSubmission(data)` and `validateDealForPublish(deal)` exported from `deal-storage.js`. Both share the same field list: name, asset_class, deal_structure, geography, originator, tagline, company_overview (≥50ch), thesis (≥50ch), highlights (≥2), target_alloc_usd, target_irr, term_months, hurdle_rate, min_ticket_usd, closing_date.
2. `createDeal` throws `DEAL_VALIDATION` error with `missing` array when any required field is missing. The `advisor&op=deals` POST handler converts that to a 400 response with the missing field list.
3. `admin&op=publish-deal` re-validates before transitioning stage to `live` — admin cannot publish an incomplete deal. Returns 400 with missing-field list.
4. **Advisor wizard** (`advisor-portal.html`): added `originator`, `tagline`, `highlights` (multi-line) inputs. Fixed long-standing bug where `thesis` was being stored as `mk_notes` so investor portal saw empty thesis. Client-side validation gates submit and jumps back to the failing step.
5. **Admin "Add New Deal" form**: added same fields. Same client-side validation. Server-side rejection surfaces missing fields in toast.
6. **AdvisorBot** (`bot-driver.html`): submitDeal now constructs tagline + company_overview + highlights from template data so bot deals pass the gate.
**Verification on next bot run:** AdvisorBot submissions should succeed; if any deal slips through with missing fields, the API now returns 400 + the missing list (visible in action log as a red row).

---

## P-7-OLD-ENTRY — kept for reference

(Original entry below superseded by ✅ FIXED above; kept until next log compaction.)

**Files:** `api/_lib/deal-storage.js` `createDeal` (lines 54–~95) + `api/v2.js` `publish-deal` op
**Severity:** Medium-High (investor experience / brand integrity)
**Symptom:** A deal can be submitted, advanced through review, and published to live with blank `company_overview`, `highlights`, `tagline`, `closing_date`. Investor portal renders empty sections on the deal detail view. The "Active Deals" table on the admin shows blank fields and dashes mid-flow.
**Root cause:** `createDeal` only validates `name`, `target_alloc_usd ≥ $1,000`, and `target_irr` non-zero. No required-fields check before stage advance.

**Fix prescription (when batching):**

Two options:

**Option A — required at create time:**
In `api/_lib/deal-storage.js` `createDeal` (line 54), add field validation:
```js
if (!data.tagline?.trim()) throw new Error('Tagline required');
if (!data.company_overview?.trim() || data.company_overview.length < 50) throw new Error('Company overview required (min 50 chars)');
if (!data.thesis?.trim() || data.thesis.length < 50) throw new Error('Investment thesis required (min 50 chars)');
if (!Array.isArray(data.highlights) || data.highlights.length < 2) throw new Error('At least 2 highlights required');
if (!data.closing_date) throw new Error('Target closing date required');
```

**Option B — required at publish time** (advisors can save drafts, but can't publish without completeness):
In `api/v2.js` `publish-deal` op, before stage transition:
```js
const missing = [];
if (!deal.tagline?.trim()) missing.push('tagline');
if (!deal.company_overview?.trim() || deal.company_overview.length < 50) missing.push('company_overview');
if (!deal.thesis?.trim() || deal.thesis.length < 50) missing.push('investment_thesis');
if (!Array.isArray(deal.highlights) || deal.highlights.length < 2) missing.push('highlights');
if (!deal.closing_date) missing.push('closing_date');
if (missing.length) return bad(res, `Missing required fields for publish: ${missing.join(', ')}`, 400);
```

**Recommended:** Option B. Allows advisors to draft incomplete deals and iterate; gates publish only.

**Also check:** advisor portal submit form (`advisor-portal.html`) — verify it has client-side required attributes on the same fields, so the production advisor flow surfaces the requirement up front rather than at publish time.

---

## P-8 · AI generation tool wired into deal flow ❌ OPEN — operator preference

**Files:** `api/_lib/ai.js` `scoreDeal()`, `api/v2.js` `op=ai-generate` and post-submit `scoreDeal` background fire
**Severity:** Operator preference (user wants AI generation removed)
**Symptom:** Two AI hooks active in code:
- `scoreDeal(deal)` runs as background fire-and-forget after every advisor deal submission. Populates `deal.aiScore` and `deal.aiScoredAt`. Visible in admin "AI Analysis" dial. With `BOT_MODE=1` returns synthetic score (no Anthropic call) but still writes to deal.
- `admin&op=ai-generate` is a manual admin button in Deal Studio that calls Anthropic to generate `tagline / company_overview / thesis / highlights` copy.

**User position:** explicitly does not want AI generation tool used in the live site.

**Fix prescription (when batching):**

Pick one approach:

**Approach 1 — Remove entirely:**
- Delete `api/_lib/ai.js`
- Delete the post-submit `scoreDeal(deal).then(...)` call site in `api/v2.js` (search for `scoreDeal(`)
- Delete `op === 'ai-generate'` and `op === 'rescore-deal'` blocks in `api/v2.js`
- Remove "AI Analysis" panel and "Run Analysis" button from `admin-portal.html`
- Remove "Generate with AI →" button from deal detail / IOI queue in admin-portal.html

**Approach 2 — Gate with `DISABLE_AI=1` env flag:**
- In `api/_lib/ai.js` `scoreDeal()` and `callAI()`, top of function: `if (process.env.DISABLE_AI === '1') return null;`
- In `api/v2.js` `op === 'ai-generate'`: `if (process.env.DISABLE_AI === '1') return bad(res, 'AI generation is disabled', 403);`
- In `admin-portal.html`, hide "AI Analysis" panel and "Run Analysis" button when a config flag is set, OR just hide them unconditionally (since user doesn't want them)

**Recommended:** Approach 2 — keeps the code in place for future toggling, simple env-flag flip. Approach 1 is cleaner but harder to reverse.

---

## B-11 · Audit false positive from `getAllIois` cache ❌ OPEN — bot-only

**File:** `api/v2.js` `sandbox-summary` handler (around line 3058 where `allIois = await getAllIois();`)
**Severity:** Bot-only (no impact on production data; only audit reports lie)
**Symptom:** Audit reports `ioi_counter_mismatch` with `declared = N+1, actual = N` even when the underlying data is consistent. Auto-heal "fixes" it but re-check still flags it, because the re-check compares fresh declared (T1, post-heal) against stale cached actual (T0).

**Root cause:** P-4 fix added a 5-second Redis cache to `getAllIois()` (line 152–166). The audit reads from that cache for "actual" counts. Recent IOIs (created in the last 5 seconds) won't be in the cached snapshot but ARE reflected in the corresponding deal record's atomic counter. False positive.

**Fix prescription (when batching):**

In `api/v2.js`, at the start of the `sandbox-summary` handler block (around line 3010 after the admin check), add:
```js
// Bypass the IOI cache for audit ground truth — audit must see fresh data.
try { await kvDel('cache:iois:all'); } catch {}
```

OR — better — modify `getAllIois` to accept a `{ skipCache: true }` option:

In `api/v2.js` lines 152–166, change:
```js
async function getAllIois() {
  try {
    const cached = await kvGet('cache:iois:all');
    if (Array.isArray(cached)) return cached;
  } catch {}
  const ioiIds = await kvZrange('ioi_index', 0, -1);
  const list = (await Promise.all(ioiIds.map(id => kvGet(`ioi:${id}`)))).filter(Boolean);
  try { await kvSet('cache:iois:all', list, { ex: 5 }); } catch {}
  return list;
}
```
to:
```js
async function getAllIois(opts = {}) {
  if (!opts.skipCache) {
    try {
      const cached = await kvGet('cache:iois:all');
      if (Array.isArray(cached)) return cached;
    } catch {}
  }
  const ioiIds = await kvZrange('ioi_index', 0, -1);
  const list = (await Promise.all(ioiIds.map(id => kvGet(`ioi:${id}`)))).filter(Boolean);
  try { await kvSet('cache:iois:all', list, { ex: 5 }); } catch {}
  return list;
}
```

Then in `sandbox-summary` change `await getAllIois()` to `await getAllIois({ skipCache: true })`.

**Operational impact while open:** when running Audit on the live bot test, occasional `ioi_counter_mismatch` reports of the form `declared = N, actual = N-1` are likely false positives from this cache. To distinguish from the real P-6 race, look at the magnitude — false positives will always be exactly off by the count of IOIs created in the last 5 seconds before the audit ran. Real P-6 races persist regardless of timing.

**Production impact:** none. The cache is correct for actual user-facing endpoints; the audit endpoint just needs ground truth.

---

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

## OQ-3 — Deal stage transitions past `dd` ✅ DONE
**Status:** Closed in this session.
**What was added:**
- `admin&op=advance-stage` (api/v2.js) — generic stage advancer for `dd→terms`, `terms→close`, `close→realized`, and `*→killed`. Validates transition table, appends audit entry, busts marketplace cache.
- AdminBot extended to pick `advance_dd_to_terms` / `advance_terms_to_close` / `advance_close_to_realized` from its action choices when matching deals exist.
**Result:** Bot now drives the full lifecycle `submit → review → live → ioi → dd → terms → close → realized`. Real production endpoints exercised at every stage.

## OQ-7 — Advisor + investor signup approval flow ✅ DONE
**Status:** New entry, closed in same session.
**What was added:**
- `advisor&op=register` (public) — advisor self-signup with required profile (firm_name, name, title, phone, firm_website, jurisdiction, year_founded, regulatory_status, aum_managed, primary_asset_classes). Status='pending'.
- `admin&op=approve-advisor` — approves a pending advisor; re-validates required profile fields; generates temp password; sends welcome (suppressed under BOT_MODE).
- `admin&op=pending-advisors` — lists pending advisor applications for the admin queue.
- `ApplicantBot` persona (bot-driver.html) — generates fake advisor + investor signups at 5s/tick (slow rate to avoid burn). 50/50 split between advisor and investor applications.
- AdminBot extended to also approve pending advisors (in addition to existing pending investors).
**Investor signup approval flow** was already wired (existing `inst&op=register` + `admin&op=approve`). ApplicantBot now exercises both halves end-to-end.
**Email triggers fire** in BOT_MODE — Resend calls suppressed but each notification path is invoked, so any bug in the trigger path surfaces in logs without sending real email.
**Production fix queue** correspondingly updated below.

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

## B-12 · Admin display formatting issues 🧹 CLEANUP — minor

**File:** `admin-portal.html`
**Severity:** Low (cosmetic, but real)
**Symptoms observed in pipeline view:**
- IRR displayed to 14+ decimal places (`23.9925021734758% IRR`). Should be `23.99%` or `24.0%`.
- "Submitted —" shown for deals where the date is set on a different field name. Render expects `submitted_at` but field may be `created_at` on bot-created deals.
- "Close" column shows `NaNd` for deals where `closing_date` is null (admin-portal does `(closing_date - now)/86400000` → NaN). Pre-existing handling for null closing_date is missing.
- IOI table shows `—` for investor name and type even when investor record exists. Display logic likely reads stale fields not populated on the IOI record.
- "From {advisor} · ·" shows double bullet separator with empty string between (probably an empty `firm_name` or an unset field interleaved into the join).

**Fix prescription (when batching):**

In `admin-portal.html`, search for the deal-card render template (`renderDealCard` or similar):
- Round IRR display: replace `${d.target_irr}%` with `${(+d.target_irr).toFixed(1)}%` (or `.toFixed(2)`)
- Submitted date: use `d.created_at || d.submitted_at` and format via `new Date(...).toLocaleDateString()`
- Close column: `closing_date ? Math.max(0, Math.round((new Date(closing_date) - Date.now())/86400000)) + 'd' : '—'`
- IOI table investor cells: ensure render falls back through `i.investor_firm || i.investor_email || i.investor_id || '—'`
- Double-bullet `· ·`: find the join statement and filter out empty strings before joining

These are all in template literals. Each fix is a one-line edit. Total ~5 lines.

---

## B-13 · AdvisorBot deal submission misses 3 memo fields ❌ OPEN — bot-only

**File:** `bot-driver.html` lines 499–512 (`AdvisorBot.submitDeal`)
**Severity:** Bot-only (causes test data to look incomplete in admin views)
**Symptom:** AdvisorBot's submit body omits `company_overview`, `highlights`, `tagline`. Bot-created deals show blank investor-facing memo fields. Compounds with P-7 (no gating) so bot deals look like "real but incomplete" rather than what a real advisor would produce after using the production form.

**Fix prescription:**

In `bot-driver.html` line ~501, after the existing `t = rand(DEAL_TEMPLATES);` line, also pull the rich memo content. The DEAL_TEMPLATES const in bot-driver.html (line 471) is a different list from the api/_lib/deal-templates.js list — driver's list lacks the memo fields. Two options:

**Option a — copy memo content into bot-driver's DEAL_TEMPLATES** (lines 471–479): add `company_overview`, `highlights`, `tagline` to each template entry, then submit them in the body.

**Option b — fetch from the API's deal-templates** (cleaner, avoids duplication): add an admin op `op=deal-template` that returns one randomized template. AdvisorBot calls it before submitting. More plumbing.

**Recommended:** (a). Copy ~8 strings into the bot's template list. ~5 minutes.

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

**Production code fixes (real platform):**
1. **P-6** atomic IOI counters — `api/_lib/deal-storage.js` lines 14–27, `getDeal` line 33, `api/v2.js` 5 call sites (lines 649, 2364, 3196, 3217, 3240), `api/_lib/bot-seed.js` seed counter keys.
2. ~~P-7 required-content gating~~ ✅ DONE this session.
3. **P-8** remove / disable AI generation tool — operator preference. Approach 2 (env flag).
4. **B-12** admin display formatting cleanup — round IRR, format dates, NaNd → `—`, dedup separators. ~5 lines in `admin-portal.html`.

**Bot-test infrastructure (after production fixes):**
5. **B-10** revert audit auto-heal — `api/v2.js` lines 3095–3132 (after P-6 lands).
6. **B-11** audit reads must bypass IOI cache — small fix.
7. **B-13** AdvisorBot send full memo content — `bot-driver.html` DEAL_TEMPLATES.

**Investigation / coverage:**
8. **OQ-2** kvKeys consistency stress test.
9. **OQ-3** stage advancement past dd.
10. **OQ-4 / OQ-5 / OQ-6** — manual QA passes with `BOT_MODE` off for emails / AI / crons.

---

*Last updated: 2026-05-02. Append entries to top of relevant section as new bugs surface. Each entry should include file path, line numbers (current at time of entry), and a complete diff prescription so we never have to re-investigate.*
