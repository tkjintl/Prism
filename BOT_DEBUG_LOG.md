# Bot Debug Log

Single source of truth for every bug surfaced during bot testing. Each entry is tagged with whether the bug is in **production code** (real platform issue) or **bot infrastructure** (only affects the test harness). Production bugs are the reason we're running this.

**Statuses:** ✅ FIXED · ⚠️ PARTIAL / WORKAROUND · ❌ OPEN · 🧹 CLEANUP

---

## Production Bugs — affect the live platform

### P-1 · Storage silent fallback ✅ FIXED
**Where:** `api/_lib/storage.js` — every read/write helper
**Severity:** Critical
**Symptom:** When Redis errored (rate limit, network blip, timeout), every helper silently swallowed the error and fell through to an empty in-memory `_mem` Map. In production `_mem` is always empty. Result: `kvGet` returned `null`, `zrange` returned `[]`, `kvKeys` returned `[]`. Marketplace flickered between `311 live` and `0 live` on identical concurrent requests.
**Root cause:** Pre-existing pattern `if (r) { try { ... } catch { /* fall through */ } }` masked all Redis errors instead of throwing.
**Fix:** Commits `99a5b79`, `e088972`, `c250337`. New `withRedis(op, fallback)` wrapper. If Redis IS configured, errors throw to caller (with 2 retries on transient blips, NO retry on quota errors). In-memory fallback only when Redis isn't configured (local dev).
**Production impact if not fixed:** Real users would have seen ghost behavior — IOIs disappearing, deals returning 404 randomly, lost writes — under any decent load. Worst pre-existing bug we found.

### P-2 · `getAnyAuth` admin-cookie bleed ✅ FIXED
**Where:** `api/v2.js` line 134 (`getAnyAuth()`)
**Severity:** High
**Symptom:** When admin cookie + investor cookie both present, admin always won. IOIs submitted by InvestorBot were created with `investor_id: 'tkj@theaurumcc.com'` (admin's email fallback) instead of `bot-inv`. Audit reported them as orphan IOIs.
**Root cause:** `return await getAdmin() || await getAdvisor() || await getInst();` — admin priority is always first.
**Fix:** Commit `ee22fef`. `getAnyAuth()` now reads optional `x-bot-as` header to pin which role's cookie to honor. Header-absent path unchanged for production safety.
**Production impact:** Real-world risk was lower (real users wouldn't normally have both admin + investor cookies set in the same browser), but the bug exists in the auth resolution path. Fix is backwards-compatible.

### P-3 · `listDeals` / `deals?op=marketplace` fan-out ✅ FIXED
**Where:** `api/v2.js` lines 859–880 (marketplace endpoint), `api/_lib/deal-storage.js` `listDeals()`
**Severity:** High
**Symptom:** Marketplace endpoint did 1 sorted-set read + ~500 individual `kvGet` calls per request. At any decent volume this saturates Redis and burns command quota.
**Fix:** Commit `eac0995`. 5-second Redis cache keyed by admin/non-admin view (`cache:marketplace:admin` / `cache:marketplace:public`). First call computes, subsequent calls within 5s cost 1 op.
**Production impact if not fixed:** Real users browsing the marketplace would burn quota and hit rate limits at low traffic levels.

### P-4 · `getAllIois` fan-out ✅ FIXED
**Where:** `api/v2.js` lines 152–157 (helper used by 15+ endpoints)
**Severity:** High
**Symptom:** Every call read the full `ioi_index` sorted set + `Promise.all` over up to 1500 IOI records. Used by `marketplace/my-iois`, `inst/performance`, `marketplace/approve-ioi`, `admin/deal-iois`, NAV updates, distributions, statements, compliance cron, etc. Same call pattern repeated dozens of times per minute.
**Fix:** Commit `eac0995`. 5-second Redis cache (`cache:iois:all`). All 15+ callers transparently benefit.
**Production impact if not fixed:** Same as P-3 — quota burn at low traffic.

### P-5 · Storage retries on quota / 429 errors ✅ FIXED
**Where:** `api/_lib/storage.js` `withRedis()`
**Severity:** Medium
**Symptom:** Initial retry implementation retried 3 times on every error including `max requests limit exceeded` (Upstash quota). Each retry burned another billable command against an already-exhausted quota and never recovered. Multiplied damage 4×.
**Fix:** Commit `c250337`. `isQuotaError(err)` short-circuits retries on quota / 429 / max-requests errors. Other transient errors still get 2 retries with 100/400ms backoff.
**Production impact:** Without fix, a single quota-exceeded condition would multiply into 4× billable commands.

### P-6 · `recalcIoiCounters` race condition ❌ OPEN
**Where:** `api/_lib/deal-storage.js` lines 16–27
**Severity:** High
**Symptom:** When two IOIs are submitted concurrently to the same deal, `deal.ioi_count` and `deal.ioi_agg_usd` drift. Last-write-wins corrupts the counter. Audit reported deals with `declared_count = N+1` while `actual_count = N` after a high-concurrency bot run.
**Root cause:** Read-modify-write pattern:
```
read deal -> read all IOIs -> compute count -> write deal
```
Tick A reads deal at v0, tick B reads deal at v0, both compute their version of the truth, last write wins.
**Status:** NOT FIXED in production code. Commit `2cfd326` made the audit auto-heal mismatches by re-running recalc — that's debug-tool sugar, not a production fix. The race is still live.
**Real fix options:**
- (a) **Atomic INCR/DECR**: store `deal:{id}:ioi_count` and `deal:{id}:ioi_agg_usd` as separate keys, use `INCRBY` on create/approve, `DECRBY` on rejection/deletion. Read both keys when serving the deal, merge into response. Race-free because Redis INCRBY is atomic.
- (b) **Per-deal write lock**: `kvSetnx('lock:recalc:{dealId}', 1, ex:5)` before recalc, `kvDel` after. Concurrent IOIs serialize through the lock. Slower, no data-shape change.
- (c) **Optimistic concurrency**: deal carries a `version` field; recalc reads, increments, CAS-writes; retries on version conflict. Bigger refactor.
**Recommended:** (a). ~30 lines in deal-storage.js + update IOI create/approve/reject paths in v2.js to call INCR/DECR instead of recalc.
**Production impact:** Real investors submitting IOIs to the same deal at the same time will corrupt the deal's IOI counter and aggregated commitment. Money-relevant — counter drives "fundraising progress" displays.

---

## Cleanup / Brand / Copy ✅ FIXED

### C-1 · Failed revert: Aurum Kilo content in production code ✅ FIXED
**Where:** `index.html`, `investor-portal.html`, `CLAUDE.md`, `.claude/agents/*.md`
**Severity:** High (brand)
**Symptom:** Aurum Kilo gold-fund rebrand was applied then `git revert`ed — but the revert missed `index.html` (entire landing page was gold-fund copy), the investor-portal title, the CLAUDE.md project description, and all agent files.
**Fix:** Commits `df2c98b`, `46accf5`, `0a25ef5`. Landing page restored from pre-rebrand snapshot. Wordmark/title cleanup. CLAUDE.md and 6 agent files rewritten for the actual platform (deal-flow, not gold fund) and the actual stack (vanilla JS + Vercel Functions, not Next.js + Postgres).

### C-2 · Access Tiers section: header said "Two ways" but only one card ✅ FIXED
**Where:** `index.html`
**Severity:** Medium
**Fix:** Commit `e2ef1b3`. Added second card (HNW & Private Capital). Required category selection on signup form. Backend `inst/register` now requires `category: 'institutional' | 'hnw'`.

### C-3 · `tkjintl@gmail.com` left in `ADMIN_USERS` env var 🧹 CLEANUP
**Where:** Vercel env var
**Status:** User-fixed during session by editing env var directly. Not in code.

---

## Bot Infrastructure — not production-relevant

These fixes apply to the bot test harness only. They surfaced during testing but live in code paths nobody else uses (`/bot-driver`, `/bot-viewer`, `sandbox-*` endpoints, `bot-seed.js`).

### B-1 · Sandbox endpoints in wrong resource block ✅ FIXED
**Where:** `api/v2.js`. Build agent placed `sandbox-reset/status/summary` inside `marketplace` block instead of `admin` block.
**Symptom:** Calls to `?resource=admin&op=sandbox-reset` returned 404 "Unknown resource or operation."
**Fix:** Commit `5fba3f5`. Moved handlers into admin block.

### B-2 · `wipeAll` WRONGTYPE on sorted-set keys ✅ FIXED
**Where:** `api/_lib/bot-seed.js` `wipeAll()`
**Symptom:** `kvGet('deals:index')` threw WRONGTYPE because `deals:index` is a sorted set, not a string.
**Fix:** Commit `fb48583`. Use `kvDel` directly (works on any type) instead of `kvGet` for existence check.

### B-3 · Counter shape mismatch in bot-driver ✅ FIXED
**Where:** `bot-driver.html`, `bot-viewer.html`
**Symptom:** UI read `c.deals_total / c.iois_total / c.advisors_total / c.investors_total / c.stages` — none of which the API returned. Counters showed `—` and `0`.
**Fix:** Commit `ee22fef`. UI now reads `c.deals / c.iois / c.advisors / c.investors / c.deals_by_stage`.

### B-4 · Audit `stuck_deals` false positive ✅ FIXED
**Where:** `api/v2.js` sandbox-summary
**Symptom:** Audit flagged 252 historical seeded deals as stuck because their backdated audit entries were >60s old.
**Fix:** Commit `1b49f79`. Stuck-detection now requires recent activity (last audit < 10 min ago) AND > 60s old. Idle deals no longer trip the rule.

### B-5 · `kvKeys('inst:*')` occasional miss → orphan_iois false positive ✅ FIXED
**Where:** `api/v2.js` sandbox-summary
**Symptom:** Audit flagged IOIs with `investor_id: 'bot-inv'` as orphan when `kvKeys('inst:*')` under load occasionally returned without the bot-inv key.
**Fix:** Commit `3103da5`. Defensive direct `kvGet(inst:{id})` confirmation before flagging orphan.
**Note:** Could indicate a real Upstash consistency issue under high load. Symptom is gone with defensive lookup; root cause not investigated.

### B-6 · Bot race condition log noise ✅ FIXED
**Where:** `bot-driver.html` AdminBot/InvestorBot
**Symptom:** Half the action log was "Deal not found" / "IOI not found" — bots racing each other (admin publishes a deal between investor's marketplace fetch and IOI submit).
**Fix:** Commit `3103da5`. Soft-skip on 404/409 with `(raced — target moved)` message. Real bugs (500, 401, etc.) still surface as red.

### B-7 · sandbox-status fan-out (~2000 ops/call) ✅ FIXED (bot-only)
**Where:** `api/v2.js` sandbox-status
**Fix:** Commit `c250337`. 5s Redis cache. Driver polling at 1.5s would have burned ~80K ops/min without it.

### B-8 · Bot-driver poll throttling ✅ FIXED (bot-only)
**Where:** `bot-driver.html`
**Fix:** Commit `c250337`. Counter polling 1.5s → 6s, paused entirely while bots idle. One-shot refresh on Reset / Start.

### B-9 · Bot MAX speed unbounded ✅ FIXED (bot-only)
**Where:** `bot-driver.html` `SPEED_MS`
**Fix:** Commit `eac0995`. MAX floored at 50ms (~20 ticks/sec/persona) instead of 0ms tight loop.

### B-10 · Audit auto-heal hiding production race ⚠️ NEEDS REVERT
**Where:** `api/v2.js` sandbox-summary, commit `2cfd326`
**Issue:** Made audit re-run `recalcIoiCounters` on mismatched deals before reporting. Hides P-6 (real production race) instead of fixing it. Should be reverted in favor of a proper P-6 fix.

---

## Infrastructure / Operational

### O-1 · Upstash free-tier quota exhausted (500K commands) ⚠️ WORKAROUND
**Symptom:** Old database hit 500K/500K monthly limit during bot testing. Every Redis call returned `ERR max requests limit exceeded`.
**Cause:** Combination of P-3, P-4, P-7, P-5, B-7, and high-velocity bot loops. ~5M ops in ~30 minutes of testing.
**Workaround:** Created new free Upstash database `crisp-kite-113455`. Updated Vercel env vars `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
**Permanent prevention:** All P-3/P-4/P-5/P-7/B-7/B-8/B-9 fixes shipped. Burn rate now ~10–20K ops per hour-long bot run, comfortably inside 500K monthly free tier.

### O-2 · Generic "Internal server error" hid real bugs ✅ FIXED
**Where:** `api/v2.js` outer try/catch
**Fix:** Commit `5ab2dee`. When `BOT_MODE=1`, 500 responses include the actual error message prefixed with `[resource/op]`. Production behavior unchanged when `BOT_MODE` unset.

### O-3 · Seed volume reduced for debug efficiency ✅ DONE
**Original:** 30 advisors / 150 investors / 400 deals / ~1500 IOIs.
**Current (commit `d99b739`):** 2 advisors / 4 investors / 10 deals / ~12 IOIs.
**Reset cost:** ~3,500 Redis ops → ~90 Redis ops.

---

## Open Questions / Things Not Yet Tested

- **OQ-1 — `recalcIoiCounters` race (P-6):** confirmed by audit. Production fix not yet applied. Bots intentionally still trip this on every high-concurrency run as the canonical reproduction case.
- **OQ-2 — `kvKeys` consistency under load (B-5 root cause):** unclear if Upstash REST genuinely sometimes misses keys, or if there's a write/read race on our side. Defensive lookup works around it for the audit; impact on production endpoints (e.g., admin/list-investors) unknown.
- **OQ-3 — Deal stage transitions past `dd`:** AdminBot only advances deals via `publish-deal` (review→live) and `push-package` (live/ioi→dd). No bot path drives deals to `terms / close / realized`. Those code paths in production aren't being exercised by the test.
- **OQ-4 — Email triggers under bot load:** `BOT_MODE=1` suppresses every email. The triggers themselves are not being exercised. Real email delivery at volume not tested.
- **OQ-5 — AI scoring under bot load:** `BOT_MODE=1` returns synthetic scores. Real Anthropic call path not exercised by the test.
- **OQ-6 — Cron jobs:** `qa-cron`, `compliance-cron`, `welcome-cron`, `generate-statements-cron` aren't being invoked by bots. Should verify they handle the lean seed correctly.

---

## Production Fix Queue (priority order)

When bot testing completes, the production-code fixes to merge in priority order:

1. **P-6 — `recalcIoiCounters` race** (option a: atomic INCR/DECR). High severity, money-relevant.
2. **B-10 revert** — remove the audit auto-heal once P-6 is properly fixed.
3. **B-5 root-cause investigation** — confirm whether `kvKeys` consistency is real before relying on the defensive lookup elsewhere.
4. **OQ-3 / OQ-4 / OQ-5** — extend bot coverage to exercise the missing code paths.

All other P-* fixes are already merged.

---

*Last updated: 2026-05-02. Append entries to top of relevant section as new bugs surface.*
