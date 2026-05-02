# Aurum Prism — Cutover Environment Variables

Single consolidated list of every Vercel env var the operator needs to set / swap before flipping to production. This document is the source of truth for **Phase B1** of `LIVE_LAUNCH_PLAN.md`.

**Where to set:** Vercel dashboard → Project → Settings → Environment Variables.

**When to set:** AFTER all Phase A code work is shipped (P-6, B-10, B-12 done — currently complete at commit `caa7921`), BEFORE inviting any real users.

---

## How to read this doc

| Column | Meaning |
|---|---|
| Var | Exact env var name |
| Status | **REQUIRED** = platform breaks without it · **REQUIRED for prod** = platform runs in degraded mode without it but you should set it · **OPTIONAL** = enables a feature, skip if not using |
| Action | **SWAP** = currently has sandbox value, replace with prod value · **SET** = needs to be set fresh · **REMOVE** = should not be set in prod · **KEEP** = leave as-is |
| Value source | Where the value comes from |

Set every variable for both **Production** and **Preview** environments unless noted otherwise. Vercel re-deploys on save automatically.

---

## 1. Critical — platform won't run without these (REQUIRED)

### `PRISM_SECRET`
- **Status:** REQUIRED
- **Action:** KEEP (already set, do not rotate during cutover unless intentionally invalidating all live sessions)
- **Value source:** existing — JWT signing key
- **Notes:** Must never be exposed. If you ever need to rotate, all signed cookies become invalid — every advisor + investor + admin will need to log in again.

### `KV_REST_API_URL`
- **Status:** REQUIRED
- **Action:** **SWAP** to production Upstash database URL (you said you'd provision separate prod DB — do that first, then update this)
- **Value source:** Upstash dashboard → your new prod database → REST API tab → URL field
- **Notes:** Currently points at sandbox `crisp-kite-113455`. Production needs its own database so sandbox testing never risks real data.

### `KV_REST_API_TOKEN`
- **Status:** REQUIRED
- **Action:** **SWAP** to match the new prod database
- **Value source:** Upstash dashboard → your new prod database → REST API tab → Token field
- **Notes:** Pair with the URL above — both must point to the same database.

### `ADMIN_USERS`
- **Status:** REQUIRED
- **Action:** **SWAP** — replace with real operator emails + strong passwords
- **Value source:** you decide
- **Format:** `email1:password1,email2:password2,...`
- **Recommended for launch:** `tkj@theaurumcc.com:<strong-pw>,jwc@theaurumcc.com:<strong-pw>`
- **Notes:** Generate passwords via `openssl rand -base64 18` per email. Never commit these. Send out-of-band to the people who need them. **DO NOT include any test/bot accounts.**

### `RESEND_API_KEY`
- **Status:** REQUIRED for prod (platform runs without — emails log to console)
- **Action:** **SWAP** to production Resend key
- **Value source:** resend.com → API Keys → create production key (or rotate existing)
- **Notes:** Verify the sender domain `theaurumcc.com` is configured in Resend before launch. Test by triggering a real signup → check Resend dashboard for delivery.

### `SITE_URL`
- **Status:** REQUIRED for emails (link generation)
- **Action:** **SWAP** to `https://prism.theaurumcc.com` (assumes you've attached the custom domain per Phase B4)
- **Value source:** your custom domain
- **Notes:** No trailing slash. Used in email templates and CSP headers.

### `NOTIFY_EMAILS`
- **Status:** REQUIRED for ops alerting
- **Action:** **SWAP** — list of operator emails that receive system alerts
- **Format:** comma-separated `email1@x.com,email2@y.com`
- **Recommended:** the same operator emails that are admins (you + JWC)
- **Notes:** Used for: (a) advisor signup notifications, (b) Resend delivery failures, (c) bot-mode email-suppression alerts in BOT_MODE deploys

---

## 2. Bot-test toggle (REMOVE for prod)

### `BOT_MODE`
- **Status:** Sandbox-only flag
- **Action:** **REMOVE** for production (or set to anything other than `1`)
- **Current value (sandbox):** `1`
- **Effect when unset:** real Resend emails fire, real Anthropic AI gen runs, rate limits apply normally to admin requests. **This is what you want for real users.**
- **Effect when `1`:** every email suppressed (logged only), AI gen returns synthetic mocks, admin can bypass rate limits with `x-bot-mode:1` header
- **Critical:** if you launch with this still set, real users' signup confirmations and IOI approvals will silently never arrive. **Triple-check this is unset before B6 (soft launch invites).**

---

## 3. AI / Anthropic (REQUIRED if using Deal Studio AI gen)

### `ANTHROPIC_API_KEY`
- **Status:** REQUIRED for AI gen feature
- **Action:** **SWAP** to production Anthropic key (or KEEP if already production-grade)
- **Value source:** console.anthropic.com → API Keys
- **Notes:** Set Anthropic spend alerts (e.g., $50/month) so a runaway Generate-with-AI loop doesn't surprise you. With BOT_MODE removed, every click on the Deal Studio AI button = real Anthropic call.

### `VERCEL_TEAM_ID`
- **Status:** OPTIONAL — routes AI calls through Vercel AI Gateway for observability
- **Action:** SET if you want gateway routing
- **Value source:** Vercel team settings
- **Notes:** Without it, AI calls go directly to api.anthropic.com. Both work. Gateway adds dashboarding + fallback.

---

## 4. Marketplace integrations — currently stub-until-env-var

These all default to safe stubs (`{ stubbed: true }`) when their env vars are absent. The platform runs fine without them, but features that depend on them will be disabled. Set them when ready to activate.

### `BLOB_READ_WRITE_TOKEN`
- **Status:** OPTIONAL — activates Vercel Blob document storage
- **Action:** Already SET per current Vercel dashboard (you have it)
- **Effect when set:** advisor/admin doc uploads (NDA, deck, financials, term sheet) go to Vercel Blob private store with signed-URL access
- **Effect when unset:** files stored as base64 in Redis (1MB hard limit per file)
- **Cost:** $0.023/GB stored + $0.04/GB transferred
- **Recommendation:** **KEEP enabled** — much better UX than the in-Redis fallback

### `KYC_PROVIDER` + `KYC_PROVIDER_API_KEY`
- **Status:** OPTIONAL — activates KYC/AML check on investor approval
- **Action:** SET when you have an Onfido or Persona account ready
- **Format:** `KYC_PROVIDER=onfido` (or `persona`) and the matching API key
- **Effect when unset:** investor approval skips KYC initiation, `inst.kycStatus` stays null
- **Cost:** ~$2–5 per check
- **Recommendation for soft launch:** SKIP. Add before institutional launch when you need a regulatory paper trail.

### `DOCUSIGN_ACCESS_TOKEN` + `DOCUSIGN_ACCOUNT_ID`
- **Status:** OPTIONAL — activates subscription document e-signature
- **Action:** SET when ready
- **Effect when unset:** subscription doc sending stubs out, `deal.subscriptionEnvelopeId` stays null
- **Cost:** ~$25/mo (DocuSign standard)
- **Recommendation for soft launch:** SKIP unless you have committed deals already

### `SENTRY_DSN`
- **Status:** OPTIONAL — activates error tracking
- **Action:** SET (highly recommended for launch)
- **Effect when unset:** errors only visible in Vercel logs (not aggregated, no alerting)
- **Cost:** free tier 5,000 errors/mo
- **Recommendation:** **SET before B6 soft launch** — you want to see crashes in real time, not when a customer reports them

---

## 5. Lower-priority / existing legacy

### `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- **Status:** Legacy aliases auto-set by Vercel's Upstash integration
- **Action:** **SWAP** to match the new prod DB (or LET Vercel re-create them when you swap KV_REST_API_*)
- **Notes:** `storage.js` reads from `KV_REST_API_*` first, falls back to `UPSTASH_REDIS_REST_*`. Keeping both in sync is harmless.

### `REDIS_URL`
- **Status:** Legacy alias from Upstash integration
- **Action:** Auto-managed — leave as-is, will swap when KV vars do
- **Notes:** Not read by current code. Safe to ignore.

### `PRISM_TACC_BRIDGE_SECRET`
- **Status:** OPTIONAL — only needed for the TACC integration feed (`/api/v2?resource=deals&op=tacc-feed`)
- **Action:** SKIP unless you're actively pulling deals from a TACC source
- **Notes:** Without this, the tacc-feed endpoint returns 503 — safe default.

### `CRON_SECRET`
- **Status:** OPTIONAL — Vercel auto-injects on cron invocations
- **Action:** Vercel handles this — you don't need to set anything
- **Notes:** Used to authenticate cron-triggered calls to `qa-cron`, `compliance-cron`, etc.

---

## Cutover checklist (env-var section)

Print this. Tick off each box as you set it in Vercel.

- [ ] `PRISM_SECRET` — verified present, not rotating
- [ ] `KV_REST_API_URL` — swapped to prod Upstash DB
- [ ] `KV_REST_API_TOKEN` — swapped to match
- [ ] `UPSTASH_REDIS_REST_URL` / `_TOKEN` — auto-updated by integration
- [ ] `REDIS_URL` — auto-updated
- [ ] `ADMIN_USERS` — real operator pairs only, no bot accounts
- [ ] `RESEND_API_KEY` — production key, sender domain verified
- [ ] `SITE_URL` — `https://prism.theaurumcc.com`
- [ ] `NOTIFY_EMAILS` — operator emails
- [ ] **`BOT_MODE` — REMOVED** (or anything ≠ `1`) — most critical
- [ ] `ANTHROPIC_API_KEY` — production key, spend alerts set on Anthropic dashboard
- [ ] `BLOB_READ_WRITE_TOKEN` — kept (already set)
- [ ] `SENTRY_DSN` — set (recommended)
- [ ] KYC / DocuSign / TACC bridge — skipped (defer)

After saving every var, **Vercel auto-redeploys**. Verify by:
1. Vercel dashboard → Deployments → confirm a new one appeared and reached Ready
2. Curl `https://prism.theaurumcc.com/api/health` → should return `{ ok: true, kv: "connected", blob: { connected: true } }`
3. Check Vercel logs for `[STORAGE]` warnings (none expected if KV vars match)

If any step shows red, **DO NOT proceed to B5 smoke test** — back up and fix.

---

## What NOT to set / change

- Do not commit any of these values to git
- Do not screenshot the Vercel env vars page with values revealed — the secrets show in the screenshot
- Do not reuse the sandbox Upstash database for prod — keep them separate so sandbox tests never touch real records
- Do not rotate `PRISM_SECRET` casually — it invalidates every active session

---

## Reference

- Source-of-truth code paths reading these:
  - `api/_lib/storage.js` — `KV_REST_API_*` / `UPSTASH_REDIS_REST_*`
  - `api/_lib/auth.js` — `PRISM_SECRET`
  - `api/_lib/email.js` — `RESEND_API_KEY`, `NOTIFY_EMAILS`, `BOT_MODE`
  - `api/_lib/ai.js` — `ANTHROPIC_API_KEY`, `BOT_MODE`, `VERCEL_TEAM_ID`
  - `api/_lib/blob-storage.js` — `BLOB_READ_WRITE_TOKEN`
  - `api/_lib/sentry.js` — `SENTRY_DSN`
  - `api/_lib/kyc.js` — `KYC_PROVIDER`, `KYC_PROVIDER_API_KEY`
  - `api/_lib/docusign.js` — `DOCUSIGN_ACCESS_TOKEN`, `DOCUSIGN_ACCOUNT_ID`
  - `api/v2.js` (rate-limit bypass) — `BOT_MODE`
  - `api/v2.js` (login admin auth) — `ADMIN_USERS`
  - `api/v2.js` (CORS + email links) — `SITE_URL`

- Related docs:
  - `LIVE_LAUNCH_PLAN.md` — the full 3-phase launch sequence
  - `BOT_DEBUG_LOG.md` — bug history with line-level fix prescriptions
  - `CHANGELOG.md` — what changed when

**Last updated:** 2026-05-02 — Stage 1 code work complete (commits `7de76b7` P-6, `b1edb58` B-10, `caa7921` B-12). Ready for Phase A QA + Phase B cutover.
