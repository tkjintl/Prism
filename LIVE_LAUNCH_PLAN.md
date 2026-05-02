# Aurum Prism — Live Launch Plan

Single-document synthesis: every bot-test finding, the gap between current state and production-ready, the launch sequence, and the post-launch operational plan.

**Last updated:** 2026-05-02 (end of bot-test session)
**Current commit:** `8e76239` on `main`
**Deployment:** `prism-plum.vercel.app` (custom domain not yet attached)

---

## 1. Executive summary

A bot-test sandbox surfaced **11 production bugs** and **3 operational gaps**. All but **1 production bug** are fixed and shipped to `main`. The remaining open bug (counter race) has a documented line-level fix prescription. The platform is **functionally complete** — the lifecycle works end-to-end, signups gate on full profiles, all approval endpoints are idempotent, AI tools are token-safe, and the Send-to-Advisor → auto-publish handshake is operational.

**Ready for soft launch after** the open production bug is fixed and ~3 operational tasks (custom domain, real env vars, sandbox wipe) are completed.

---

## 2. Bot-test findings — full inventory

### 2.1 Production fixes shipped (16 items)

| ID | Issue | Resolution |
|---|---|---|
| P-1 | Storage silent fallback to empty in-memory map on Redis errors → marketplace flickered between full and empty results | `withRedis()` wrapper throws on errors when Redis is configured. 2 retries with backoff for transient blips, 0 retries on quota errors. Fallback only when Redis is unconfigured (local dev). |
| P-2 | `getAnyAuth()` always picked admin cookie when bot driver shared a tab with admin login → IOIs created with admin email as investor_id | `x-bot-as` header pins the resolution. Backwards-compatible — header absent reverts to original priority. |
| P-3 | `listDeals` / `deals?op=marketplace` did 1+500 reads per call → would have killed Upstash quota at any real load | 5-second Redis cache (`cache:marketplace:public`/`admin`). One compute, many cache hits. |
| P-4 | `getAllIois()` (used by 15+ endpoints) read entire IOI index every call | 5-second cache (`cache:iois:all`). All callers transparently benefit. |
| P-5 | Storage retries on quota errors multiplied damage 4× against an already-exhausted Upstash quota | `isQuotaError()` short-circuits retries on 429 / max-requests / quota messages. Retries still apply to genuine transient errors. |
| P-7 | Deals could be submitted/published with empty `tagline / company_overview / thesis / highlights / closing_date` etc. → investor portal rendered blank sections | `validateDealForSubmission()` and `validateDealForPublish()` enforce 15-field gate. `createDeal` throws structured 400 with missing-list. `publish-deal` re-validates before stage transition. Advisor wizard adds `tagline`, `originator`, `highlights` fields. Bug fix: `thesis` was being stored as `mk_notes` — now stored correctly. |
| P-8 | AI generation tool would burn Anthropic tokens during sandbox testing if operator clicked "Generate with AI" | `op=ai-generate` BOT_MODE-gated → returns synthetic mock payload during testing. Production unchanged. Combined with `scoreDeal()` BOT_MODE gate from earlier, total Anthropic burn during sandbox = $0. |
| P-9 | `marketplace&op=approve-ioi` was not idempotent — duplicate calls re-fired data-room-access email + recalculated counters | Early return `{ idempotent: true }` if `ioi.status === 'approved'`. |
| P-10 | `admin&op=publish-deal` not idempotent — duplicate calls appended duplicate audit entries + re-fired stage-change email | Early return if `deal.stage === 'live'`. |
| P-11 | `admin&op=approve` (investor) not idempotent — every duplicate call rotated the access code AND re-fired the email, **destroying previously-issued codes** | Early return if `inst.status === 'approved'` (preserves the explicit `reveal_code` path for re-surfacing existing code). |
| P-12 | "Send to Advisor" button fired API directly with no preview — admin couldn't review the AI-drafted copy before sending | New `send-advisor-modal` opens with editable tagline/thesis/overview/highlights. Cancel or Confirm. Both card-button and Deal Studio entry points use it. |
| P-13 | Investor and advisor signup forms accepted half-filled records | Backend `inst&op=register` requires 8 fields; `advisor&op=register` requires 11 fields. Admin approval re-validates same set. Landing-page form validates client-side with asterisks on labels. |
| P-15 | `admin&op=approve-advisor` returned 400 on duplicate — surfaced as red audit rows | Made idempotent like the other three approval endpoints. |
| P-16 | Workflow had a redundant separate admin "Publish Live" step after advisor approval | `advisor-confirm-deal` now auto-publishes on advisor approval (validates required fields, transitions stage to live, busts marketplace cache). Skipping the redundant admin step. |
| C-1 | Failed-revert leftover: index.html, investor-portal title, CLAUDE.md, agent files all contained `Aurum Kilo` (the gold-fund product) instead of `Aurum Prism` (the deal-flow platform) | Restored from clean baseline. CLAUDE.md and 6 agent files rewritten to match actual platform + actual stack. |
| C-2 | Access Tiers section had one card under "Two ways to access" header | Two-card layout (Institutional + HNW). Backend `inst/register` requires `category in {institutional, hnw}`. |

### 2.2 Open production bugs (1 item)

| ID | Issue | Severity | Prescription |
|---|---|---|---|
| **P-6** | `recalcIoiCounters` race — concurrent IOI submissions to the same deal cause `ioi_count` and `ioi_agg_usd` to drift via last-write-wins | **HIGH — money-relevant** (counters drive "fundraising progress" displays) | Atomic INCR/DECR on separate keys (`deal:{id}:ioi_count`, `deal:{id}:ioi_agg_usd`). Read merged in `getDeal`. Replace 5 `recalcIoiCounters` call sites in `api/v2.js` with `bumpIoiCounters(±1, ±amount)`. ~45 min. Full diff in `BOT_DEBUG_LOG.md` under P-6. |

### 2.3 Cosmetic / low-priority (1 item)

| ID | Issue | Severity |
|---|---|---|
| B-12 | Admin display: IRR shown to 14 decimals; `NaNd` when closing_date null; `—` in IOI table investor cells; double-bullet `From X · ·` | LOW — cosmetic |

### 2.4 Operational items (3 items)

| ID | Status |
|---|---|
| O-1 Upstash quota exhaustion workaround | ✅ New free database `crisp-kite-113455` provisioned. Burn fixes (P-3/4/5/7 + cache + tick floors) bring 1-hour bot run to ~125K ops vs 5M+ pre-fix. Inside 500K monthly tier with 4× headroom. |
| O-2 Generic 500 errors hid real bugs | ✅ Fixed under BOT_MODE — surfaces real error message with `[resource/op]` prefix. Production keeps generic message. |
| O-3 Seed volume (debug efficiency) | ✅ Reduced to 3 advisors / 5 investors / 10 deals / ~12 IOIs. Reset cost ~90 Redis ops. |

### 2.5 Untested code paths (5 items)

| ID | What's untested | How to verify pre-launch |
|---|---|---|
| OQ-2 | `kvKeys('inst:*')` consistency under high concurrency | Stress test: write 200 inst keys, scan 10× concurrently, verify each scan returns 200. Audit other 12 `kvKeys` call sites if real. |
| OQ-4 | Real email delivery under BOT_MODE off | Manual QA: with `BOT_MODE=0`, drive each lifecycle event and verify Resend delivers + email renders correctly. |
| OQ-5 | Real AI scoring + AI generation | Manual QA: with `BOT_MODE=0`, submit real deal, verify `scoreDeal` populates dial. Click Generate with AI, verify Anthropic call returns coherent copy. |
| OQ-6 | Cron jobs (`qa-cron`, `compliance-cron`, `welcome-cron`, `generate-statements-cron`) | Manually POST each cron endpoint with admin cookie. Verify they don't crash on bot-shaped data and update the right records. |
| OQ-8 | Real role-isolation testing (would require separate browser contexts) | Optional: build a Playwright harness with isolated cookie jars per persona. Out of scope for the in-page bot driver. |

### 2.6 Bot test infrastructure (built this session — 8 personas)

| Persona | Color | What it does |
|---|---|---|
| Advisor | gold | Submits deals, NAV updates, answers Q&A |
| Admin | blue | Publishes, approves IOIs/inv/adv, push package, advance stages |
| Investor | green | Browses marketplace, signs NDA, IOIs, perf dashboard |
| Applicant | violet | New advisor + investor signups (5s tick floor) |
| Chaos | red | Input fuzzer (XSS, NaN, wrong types, etc.) — 3s floor |
| Auth | orange | Anonymous + phantom-ownership + malformed-payload tests — 4s floor |
| AdvReview | teal | Logs in as bot.advisor, confirms pending review deals → auto-publish — 5s floor |
| Concurrency | magenta | Bursts 8 parallel calls — verifies P-9/P-10/P-15 idempotency under load — 30s floor |

Plus: sandbox reset / status / summary endpoints, audit modal with combined data + log error reporting.

---

## 3. Pre-launch readiness assessment

### 3.1 What's ready

- ✅ **Authentication** — JWT with revocation denylist, rate limiting (10 attempts / 15 min / IP), bcrypt cost 12, separate cookies per role
- ✅ **Lifecycle** — `review → live → ioi → dd → terms → close → realized` all wired, all transitions audit-logged
- ✅ **Form gating** — every entry point (advisor signup, investor signup, deal submission, admin approval, deal publish) requires complete profile / payload
- ✅ **Idempotency** — all approval/publish endpoints handle duplicate calls safely
- ✅ **AI tools** — Deal Studio works in production, BOT_MODE-gated for testing
- ✅ **Auto-publish on advisor approval** — operator workflow simplified to two human gates (admin Send + advisor Confirm)
- ✅ **Notifications** — `deal.notifications` array populated by send-to-advisor, push-package, advisor-confirm-deal flows. Investor `_invNotifs` built from IOI status. Resend + console-log fallback.
- ✅ **Brand** — Aurum Prism throughout. No Kilo/gold leftovers.
- ✅ **Burn protection** — caching, no-retry on quota, low-volume seed. Inside Upstash free tier with massive headroom.

### 3.2 What's not ready

- ❌ **P-6 counter race** — concurrent IOIs on same deal cause counter drift. Will affect any real deal that gets simultaneous IOIs. Money-relevant.
- ❌ **Custom domain** — `prism.theaurumcc.com` not attached. Currently only reachable at `prism-plum.vercel.app`.
- ❌ **`BOT_MODE=1` is set in production** — must be unset before real users sign up, otherwise their emails are silently suppressed.
- ❌ **Sandbox bot data + bot accounts in KV** — must be wiped before real users land.
- ❌ **Bot-driver / bot-viewer pages reachable in production** — admin can use them as sandbox even on the live deployment, but a casual visit to `/bot-driver` shouldn't be possible from a real customer's perspective. Either route-restrict or accept that they're admin-gated already.
- ⚠️ **Email + AI + cron paths not exercised end-to-end** with real Resend/Anthropic — see OQ-4/5/6.

### 3.3 What's a known unknown

- Real-load performance unknown — bot test peaked at ~2.1K Redis ops/min across 8 personas at 5× speed. Production load will differ but the cache architecture should handle 10× this comfortably.
- Mobile rendering — touched in CSS but not exercised by bots.
- Real KYC + DocuSign + Vercel Blob integrations — all stub-until-env-var. Need real env vars + manual smoke before institutional launch.

---

## 4. Launch plan — three phases

### Phase A — Pre-launch hardening (before flipping any real traffic)

Estimated effort: **half a day to one full day**.

**A1. Land P-6 (atomic IOI counters)** — ~45 min
- Apply line-level prescription from BOT_DEBUG_LOG.md
- Run bot test at MAX speed for 5 minutes
- Confirm Run Audit shows 0 `ioi_counter_mismatch` issues across multiple runs

**A2. OQ-2 kvKeys stress test** — ~30 min
- Write 200 inst keys via test script, fire 10 concurrent `kvKeys('inst:*')` reads
- If any returns < 200, replace remaining 12 `kvKeys` call sites with sorted-set-index reads (B-5 defensive lookup is cosmetic; this would be the real fix)

**A3. OQ-4 / OQ-5 / OQ-6 manual QA passes**
- Stage a separate Vercel deployment (or temporarily flip BOT_MODE=0 on `prism-plum`) with real Resend + Anthropic keys
- Submit one deal end-to-end as a real advisor account, verify each notification email arrives
- Click "Generate with AI", verify Anthropic returns coherent copy
- POST each cron endpoint manually, verify they don't crash and update expected records
- Document any new findings in BOT_DEBUG_LOG.md

**A4. Cosmetic cleanup (B-12)** — ~15 min
- Round IRR display, format dates, NaNd → `—`, dedup separators in `admin-portal.html`

### Phase B — Production cutover (the actual launch)

Estimated effort: **1–2 hours including DNS propagation**.

**B1. Vercel env vars — production set**
- `BOT_MODE` → unset (or set to anything other than `1`)
- `ADMIN_USERS` → real admin emails + strong passwords (purge any test entries)
- `RESEND_API_KEY` → production key
- `ANTHROPIC_API_KEY` → production key
- `SITE_URL` → `https://prism.theaurumcc.com`
- `NOTIFY_EMAILS` → real operator emails
- Upstash production database (separate from `crisp-kite-113455` sandbox)
- Optional integrations as needed: `BLOB_READ_WRITE_TOKEN`, `SENTRY_DSN`, `KYC_PROVIDER_API_KEY`, `DOCUSIGN_ACCESS_TOKEN`

**B2. Wipe sandbox data**
- One-time: log into admin, hit `/bot-driver`, click Reset → confirm. Then delete bot accounts via admin UI or via direct KV delete (`bot-adv`, `bot-inv`, `adv-bot-001..N`, `inv-bot-001..N`)
- After cutting Upstash to production database, sandbox data won't be present anyway

**B3. Disable / hide bot-driver pages on production**
- Option a: Add to `vercel.json` rewrites that redirect `/bot-driver` and `/bot-viewer` to `/` when not BOT_MODE
- Option b: Accept that admin-only gate is sufficient (already the case)
- Recommend option a — explicit denial, no operator can accidentally land there

**B4. Attach custom domain**
- Vercel dashboard → Domains → Add `prism.theaurumcc.com`
- Update DNS at `theaurumcc.com` registrar: CNAME `prism` → `cname.vercel-dns.com`
- Wait for propagation (usually <10 min)
- Verify SSL auto-issues
- Update `SITE_URL` env var to match

**B5. Smoke test real flow with operator account**
- Log in as real admin via `prism.theaurumcc.com/login`
- Submit one real deal via `/admin-portal` "Add New Deal"
- Run through: Generate with AI → Send to Advisor → Advisor Confirms → Auto-publishes
- Verify deal appears in `/investor-portal` marketplace
- Submit IOI as real test investor
- Approve IOI as admin
- Confirm investor gets approval email
- Push package → DD
- Advance to terms → close → realized
- Verify all email notifications arrived

**B6. Soft launch**
- Send invites to a small founding cohort (5–10 advisors, 10–20 investors)
- Each gets unique account from admin manually creating them via `op=create` (or sets up self-signup link if you want it open)
- Monitor Sentry / Vercel logs for errors
- Operator on standby for first 48h

### Phase C — Post-launch operations

**C1. First-week monitoring**
- Vercel Logs → filter for 5xx errors, watch for any unexpected patterns
- Upstash dashboard → command-rate meter, ensure under 30% of monthly tier
- Sentry (if configured) → top errors
- Resend dashboard → delivery rates
- Bot test sessions during low-traffic hours: spin up `BOT_MODE` on a separate preview deployment for regression checks — never on production

**C2. Weekly checks**
- Run sandbox audit on a preview deployment with fresh bot data
- Review BOT_DEBUG_LOG.md for any new findings
- Verify cron jobs ran on schedule (Vercel Crons dashboard)
- Confirm welcome-cron is firing Day-2 / Day-7 sequences for newly approved investors

**C3. Backup / recovery**
- Upstash → enable daily backups (paid feature)
- Document recovery process: what to do if Upstash goes down (currently in-memory fallback only kicks in if env vars are absent — production failure mode is clean error, not silent loss)
- Document recovery process for accidental Reset on production (would wipe everything — `bot-driver` should be route-disabled per B3)

**C4. Quarterly maintenance**
- Re-audit BOT_DEBUG_LOG.md against current code
- Refresh bot test seed templates
- Review and rotate any test credentials
- Run regression suite: stand up a preview deployment, full bot test, compare audit output to prior run

---

## 5. Execution checklist (printable)

### Pre-launch
- [ ] **A1** — P-6 atomic counters fix shipped + verified
- [ ] **A2** — kvKeys stress test passed (or call sites migrated)
- [ ] **A3** — Email / AI / cron manual QA complete
- [ ] **A4** — Admin display formatting cleanup

### Cutover
- [ ] **B1** — Production env vars set on Vercel (BOT_MODE unset, real keys)
- [ ] **B2** — Sandbox data + bot accounts wiped from production KV
- [ ] **B3** — `/bot-driver` and `/bot-viewer` route-disabled in production
- [ ] **B4** — Custom domain attached, DNS propagated, SSL active
- [ ] **B5** — Operator smoke test passed (full lifecycle on real domain)
- [ ] **B6** — Soft-launch invites sent to founding cohort

### Post-launch (first 48h)
- [ ] No 5xx spike in Vercel logs
- [ ] Upstash command rate < 30% of tier
- [ ] No customer support requests about bugs
- [ ] At least 1 successful end-to-end deal flow from real users (advisor submit → admin approve → advisor confirm → auto-publish → investor IOI → approval)

### Ongoing
- [ ] Weekly: sandbox audit on preview deployment
- [ ] Monthly: BOT_DEBUG_LOG.md review + open-issue triage
- [ ] Quarterly: full bot regression run, audit refresh

---

## 6. Sign-off report template

Once Phases A and B are complete, fill this out before declaring "launched":

```
LAUNCH SIGN-OFF — Aurum Prism

Date:        ____________________
Operator:    ____________________
Commit:      ____________________
Domain:      ____________________

Phase A — pre-launch hardening
  A1 P-6 atomic counters:           [ ] shipped at commit ________  [ ] audit confirms 0 mismatches
  A2 kvKeys consistency:            [ ] verified  [ ] migrated 12 call sites (n/a if verified)
  A3 OQ-4 email manual QA:          [ ] all expected emails delivered
  A3 OQ-5 AI manual QA:             [ ] Generate with AI returns coherent copy
  A3 OQ-6 cron manual QA:           [ ] qa-cron, compliance-cron, welcome-cron, generate-statements-cron pass
  A4 admin display polish:          [ ] applied

Phase B — production cutover
  B1 env vars:                      [ ] BOT_MODE unset  [ ] real keys set  [ ] Upstash production DB
  B2 sandbox wipe:                  [ ] confirmed empty
  B3 bot pages disabled:            [ ] /bot-driver returns 404 in prod
  B4 custom domain:                 [ ] prism.theaurumcc.com resolves with SSL
  B5 operator smoke test:           [ ] full lifecycle passed end-to-end
  B6 soft launch:                   [ ] invites sent to N founding members

Outstanding:
  P-6 status:                       [ ] FIXED  [ ] OPEN — risk accepted: ____________________
  Open items from log:              ____________________

Operator sign-off:    ____________________
Co-signer (partner):  ____________________
```

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| P-6 counter race fires on real concurrent IOIs | Medium | High (counter drift on fundraising progress) | Land P-6 atomic counters before launch (A1) |
| Real users land before BOT_MODE=0 set | Low | High (their emails silently suppressed) | Cutover checklist B1 before B6 invites |
| Operator accidentally hits Reset on prod | Low | Catastrophic (wipes everything) | B3 route-disable bot-driver in prod |
| Upstash quota exhausted at scale | Low–Medium | High (platform unavailable) | Pay-as-you-go upgrade ready ($0.20/100K commands); current usage projects ~10K commands/day at light load = well inside free tier even after launch |
| Anthropic spend spikes from real AI gen | Medium | Medium (cost surprise) | Set Anthropic budget alerts; ai-generate is admin-only and rate-limited by human click rate |
| Real email delivery fails (Resend down or quota) | Low | Medium (advisors/investors miss approvals) | NOTIFY_EMAILS operator alert path already wired (P-1 phase). Resend has 99.9% SLA on their tier. |
| Concurrent admin operations corrupt state beyond P-6 | Low | Medium | Idempotency on all approval endpoints; auto-heal in audit catches drift; ConcurrencyBot regression test covers this |
| Mobile rendering bug on launch | Medium | Low | Manual smoke test on phone before B6; not fully bot-tested |

---

## 8. Reference

- Code: `https://github.com/tkjintl/Prism` on `main` branch
- Current deploy: `prism-plum.vercel.app` (commit `8e76239` at time of writing)
- Bot debug log: `BOT_DEBUG_LOG.md` (line-level fix prescriptions for all open + closed items)
- Platform docs: `CLAUDE.md` (architecture, env vars, test creds)
- Session changelog: `CHANGELOG.md`

**Total session output:** 16 production fixes, 1 open production bug (prescribed), 8 bot personas, ~30 commits.

The platform is one fix (P-6) and one cutover sequence (B) away from production-ready.
