# Prism Platform — v1 to Current
**Session date:** 2026-05-02  
**Baseline:** Prism Platform v1.zip (snapshot taken at session start)  
**Current commit:** `42216c1` — Fix broken tab navigation

---

## Summary

Full platform hardening across 6 phases — security, infrastructure, core features, integrations, deal intelligence, post-close reporting, and UX polish. Platform went from demo-ready to production-ready. 15+ new API endpoints, 4 new backend lib files, 4 new cron jobs, major upgrades to all three portals.

---

## Phase 0 — Security Hardening

### `api/v2.js`

**Rate limiting on all auth endpoints**
- Added `checkRateLimit(ip)` and `getClientIp(req)` helpers. Writes `ratelimit:auth:{ip}` to Redis on first attempt with 900s TTL; uses `INCRBY` on subsequent attempts. Requests exceeding 10 attempts in 15 minutes return `429 Too many attempts. Try again later.`
- Applied to: advisor login, investor login, advisor forgot-password.

**TACC feed hard-fail**
- `op=tacc-feed` now checks `PRISM_TACC_BRIDGE_SECRET` before serving any data. If absent or empty, returns `503 { error: "Feed not configured" }`. Previously it served live deal data to anyone when the env var was unset.

**deal-docs and ai-generate admin role check**
- Both handlers now require `prism_admin` cookie. Replaced permissive JWT check with `getAdmin()` which asserts `payload.role === 'admin'`. Returns 403 for any non-admin caller (including advisors).

**advisor-confirm-deal ownership check**
- Added `if (deal.advisor_id !== adv.advisor_id) return 403` after deal fetch. Previously any authenticated advisor could modify any deal's financial terms.

**IOI dedup race condition fix**
- Replaced check-then-set pattern with atomic `kvSetnx(dedupKey, 'pending')`. If key already existed, second request returns `409 IOI already submitted`. Eliminates concurrent double-submit vulnerability.

**Auto-seed removed from production code paths**
- Removed 4 auto-seed call sites triggered by cold start / empty data conditions: `advisor/me`, `advisor/deals` GET, `deals/marketplace`, `deals` admin GET. Seed function still exists but only callable via explicit admin `op=seed` trigger.

**Password minimum length — 12 chars**
- `op=setup-password` and `op=reset-password` now enforce `password.length >= 12`. Returns `400 Password must be at least 12 characters.`

**CORS origin restriction**
- `Access-Control-Allow-Origin` now set to `process.env.SITE_URL`. Was absent from non-OPTIONS responses. Added `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`.

### `advisor-portal.html` + `investor-portal.html`

**Stored XSS remediation — Q&A thread and deal fields**
- Added `function esc(str)` sanitizer to both portals — uses the browser's own DOM encoder (`textContent` → `innerHTML` round-trip). Produces safe output for all HTML special characters.
- All Q&A fields wrapped in `esc()`: `q.message`, `q.question`, `q.askedBy`, `q.askedAt`, `q.answer`, `q.answeredBy`, `q.answeredAt`.
- `onclick="setQaReplyCtx('${q.id}','${q.askedBy}')"` string-injection vector closed — replaced with `data-qaid`/`data-askedby` attributes and `el.dataset` reads.
- Deal name, geography, structure, tagline, thesis, highlights, and activity log fields all wrapped in `esc()` across both portals.

### `vercel.json`

**Security response headers**
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — HSTS, 1-year TTL.
- `Content-Security-Policy` — `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, Google Fonts for style/font only, `frame-ancestors 'none'`, `connect-src 'self'`.
- `X-Frame-Options: DENY` — changed from `SAMEORIGIN`.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## Phase 1 — Infrastructure

### `api/_lib/auth.js`
- `signToken` now injects `jti: randomUUID()` into every JWT payload.

### `api/v2.js`

**Token revocation denylist**
- On advisor logout: `revoked:{jti}` written to Redis with 7-day TTL. On investor logout: same with 30-day TTL. All three auth helpers (`getAdmin`, `getAdvisor`, `getInst`) check the denylist after signature verification. Replayed stolen tokens return 401.

**PDPA investor deletion endpoint**
- New `resource=admin&op=delete-investor` (POST, admin only). Accepts `investorId`. Deletes: `inst:{id}`, `inst_email:{email}`, `inst_code:{code}`, matching `ioi:IOI-*` records, `ioi_exists:{dealId}:{investorId}` dedup keys, `nda_signed:{investorId}:*` records. Calls `recalcIoiCounters` on affected deals. Returns `{ deleted: true, keysRemoved: N }`.

**Append-only audit sorted set**
- New `appendAuditEntry(dealId, entry)` in `deal-storage.js` — writes to `audit:{dealId}` sorted set with `score = Date.now()`. Called from `createDeal`, `updateDeal`, `respond-package`, `capital-call-notify`, `distribution-notify`.
- New `resource=admin&op=audit-log&dealId=X` endpoint returns full chronological log.

**KV fallback alerting**
- Redis failure now logs `[STORAGE] KV unavailable — using in-memory fallback. DATA WILL BE LOST ON RESTART.` via `console.error`. `isKvUnavailable()` exported. Health check returns `kv: "unavailable"` when KV is absent.

### `api/_lib/email.js`

**Resend failure alerting**
- `send()` checks response status. On non-2xx, fires secondary alert to `NOTIFY_EMAILS` with subject `[Prism Alert] Email delivery failure` — includes recipient, template type, timestamp, error. Catch-safe, never throws.

### `api/health.js`
- Added Vercel Blob connectivity check. Calls `list({ token, limit: 1 })` against Blob store. Health endpoint now returns `{ ok, kv, blob: { connected, reason } }`.

---

## Phase 2 — Core Missing Features

### `api/v2.js` + `api/_lib/email.js`

**7 new email triggers**
- `sendIoiConfirmation` — investor receives confirmation after IOI submission.
- `sendIoiRejection` — investor notified when admin rejects their IOI.
- `sendDataRoomPackageResponse` — investors notified when advisor accepts pushed IOI package.
- `sendQaQuestionToAdvisor` — deal advisor receives email when investor submits Q&A question.
- `sendQaAnswerToInvestor` — investor notified when advisor answers their question.
- `sendCapitalCallNotice` + `resource=admin&op=capital-call-notify` — admin triggers capital call notification to all approved IOI holders (or specific `investorIds[]`).
- `sendDistributionNotice` + `resource=admin&op=distribution-notify` — same pattern for distribution notices.

**Q&A smart routing — 48h reminder, one reminder per question max**
- On question submission: `qa_pending:{dealId}:{qaId}` written to Redis with 48h TTL and `{ reminderSent: false }`.
- On answer: key deleted immediately.
- `resource=admin&op=qa-cron` scans pending keys ≥24h old, batches by deal, sends one reminder per deal (never sends more than one per question), then sets `reminderSent: true`.
- Cron: `0 9 * * *` (daily 9am UTC) in `vercel.json`. Accepts `CRON_SECRET` bearer token.

**IOI counter integrity fix**
- Removed `kvIncrby(deal_ioi_count:*)` and manual counter increments. Added `recalcIoiCounters(dealId)` which scans all IOIs for the deal, counts and sums only non-rejected records, writes back to deal object. Called after: IOI creation, approval, rejection, package response. Single source of truth — no divergence.

### `advisor-portal.html`

**Earnings tab**
- New fourth nav tab `view-earnings`. Summary hero card (total estimated earnings in gold mono). Intro fee table (Deal | Status | Fee % | Size | Est. Fee). Carry table. Payment history list (date, deal, type, amount, status badge). Fetches `GET /api/v2?resource=advisor&op=earnings`. Graceful fallback to local `DEALS` skeleton when API returns nothing.

### `investor-portal.html`

**NDA modal with scroll-gate**
- Replaced bare checkbox with "Review & Sign NDA" button that opens a full-screen modal. Scrollable NDA text container — Sign button locked until investor scrolls to within 40px of bottom. On sign: captures `{ timestamp, documentHash, investorId }`, posts to `POST /api/v2?resource=inst&op=nda-accept`. Shows "NDA Signed ✓" badge after.

**Notices tab**
- New third nav tab `view-notices`. Capital call cards (gold warning-triangle icon, amber border, PENDING badge). Distribution cards (green checkmark, green border). Expandable detail panel per notice (wire instructions, reference number, due date). Acknowledge button posts to `POST /api/v2?resource=inst&op=acknowledge-notice`. Pending count badge on nav tab.

---

## Paid Service Integrations — STUBBED (activate via env var)

Four new lib files created. All inert until the corresponding env var is set.

### `api/_lib/blob-storage.js`
- `uploadDocument()` / `getDocumentUrl()`. When `BLOB_READ_WRITE_TOKEN` absent: files stored as base64 in Redis (existing 1MB limit). When present: uploaded to Vercel Blob private store, URL stored. VDR upload/download endpoints wired to use these helpers automatically.
- **Activate:** `BLOB_READ_WRITE_TOKEN` in Vercel env vars. Cost: $0.023/GB stored.

### `api/_lib/sentry.js`
- `captureException()` / `captureMessage()` via Sentry HTTP envelope API (no npm install). When `SENTRY_DSN` absent: errors logged to console. `api/v2.js` top-level handler wrapped in try/catch. `captureMessage` fires at: deal published, IOI created, investor approved.
- **Activate:** `SENTRY_DSN` in Vercel env vars. Free tier: 5,000 errors/mo.

### `api/_lib/docusign.js`
- `sendSubscriptionDocument()` / `checkEnvelopeStatus()`. When `DOCUSIGN_ACCESS_TOKEN` + `DOCUSIGN_ACCOUNT_ID` absent: logs stub, returns `{ stubbed: true }`. Two new admin endpoints: `op=send-subscription-doc` and `op=check-subscription-status`. Stores `deal.subscriptionEnvelopeId` and `deal.subscriptionSigned`.
- **Activate:** DocuSign developer account → JWT Grant auth → set env vars. Cost: $25/mo.

### `api/_lib/kyc.js`
- `initiateKycCheck()` / `getKycStatus()`. Supports Onfido (default) and Persona via `KYC_PROVIDER`. When `KYC_PROVIDER_API_KEY` absent: returns `{ stubbed: true }`. `op=approve` (investor) now calls `initiateKycCheck` post-approval (non-fatal). Stores `inst.kycCheckId`, `inst.kycStatus`. New `resource=admin&op=kyc-status` endpoint.
- **Activate:** onfido.com or withpersona.com → set `KYC_PROVIDER_API_KEY` + `KYC_PROVIDER`. Cost: ~$2–5/check.

---

## AI Gateway + Deal Scoring

### `api/_lib/ai.js` — new file
- `callAI(messages, opts)` — single entry point for all Anthropic calls. Routes through `https://gateway.ai.vercel.app/v1/{teamId}/prism/anthropic/v1/messages` when `VERCEL_TEAM_ID` is set. Falls back to direct Anthropic URL locally. Auth via `ANTHROPIC_API_KEY` in all cases.
- `scoreDeal(deal)` — calls `claude-haiku-4-5-20251001` at 800 max tokens with structured deal scoring prompt. Returns: `completeness_score`, `completeness_flags`, `plausibility_score`, `plausibility_flags`, `operator_brief`, `recommended_action` (publish/review/reject), `risk_flags`. Returns null on any failure — never throws.

### `api/v2.js`
- `resource=admin&op=ai-generate` refactored to use `callAI()` — gateway-aware.
- After advisor deal submission: background `scoreDeal(deal).then(...)` fires. Submission response returns immediately — AI never blocks it. Result saved to `deal.aiScore` + `deal.aiScoredAt`.
- New `resource=admin&op=rescore-deal` (POST, admin only) — re-runs AI scoring on demand.

---

## Phase 3 — Deal Intelligence

### `api/v2.js`

**Investor matching engine**
- New `resource=admin&op=match-investors&dealId=X` (GET, admin only). Scores every investor against a deal on 5 factors (0–5): asset class match, geography match, capacity vs. minimum ticket, no prior rejection, no existing IOI. Returns ranked list with `{ investorId, name, email, score, matchReasons, alreadyHasIoi }`. Missing preference fields score 0 (no crash).

**Compliance monitoring cron**
- New `resource=admin&op=compliance-cron`. Scans all investors. Flags: `compliance_review_needed` (KYC pending/failed + >30 days old), `nda_missing` (active IOIs but no NDA), `access_expiring` (code expires within 7 days). Stores `compliance_flag:{investorId}` with 32-day TTL. New `resource=admin&op=compliance-flags` read endpoint. Cron: `0 2 1 * *` (monthly).

### `admin-portal.html`

**AI Analysis card in deal detail**
- SVG arc-ring dials for Completeness and Plausibility scores (Cormorant numeral, gold fill). Up to 3 flag bullets per score. Operator brief in italic Cormorant. Recommended action badge (green/amber/red). Re-score button. Shimmer + "Run Analysis" state when `aiScore` is null.

**Investor Matches panel in deal detail**
- Ranked list with score bar (gold, proportional to 5), investor name/email, match-reason pills, "Has IOI" badge. Checkboxes wired to `window._matchSelected` for future bulk-invite. Loading and empty states.

**Priority Approvals Queue**
- All four action-queue columns upgraded. Cards show: priority badge (HIGH red / MEDIUM amber), item-type icon, age label (`relAge()` helper), AI brief excerpt for deal submissions. HIGH cards get red left-border; MEDIUM get amber.

---

## Phase 4 — Post-Close & Reporting

### `api/v2.js` + `api/_lib/email.js`

**NAV update mechanism**
- New `resource=advisor&op=post-nav-update` (POST, advisor must own deal). Appends to `deal.navHistory`, updates `deal.currentNav` / `deal.totalNavUsd` / `deal.navAsOf`. Appends to audit log. Emails all approved IOI holders via `sendNavUpdate` template.

**Quarterly statement generation**
- New `resource=admin&op=generate-statements&dealId=X` (POST, admin only). Builds per-investor statement records stored as `statement:{dealId}:{investorId}:{period}`. Emails each investor via `sendStatementAvailable` template. `resource=inst&op=statements` (GET, investor) and `resource=admin&op=statements&dealId=X` (GET, admin) read endpoints. Quarterly cron `resource=admin&op=generate-statements-cron` runs across all active deals — skips already-generated periods. Cron: `0 6 1 1,4,7,10 *`.

**Distribution workflow**
- New `resource=advisor&op=post-distribution` (POST, advisor must own deal). Types: `income`, `capital`, `return_of_capital`. Calculates per-investor proportional share. Stores `distribution:{dealId}:{distributionId}`. Appends to `deal.distributionHistory` and audit log. Emails each investor their individual amount via `sendDistributionNoticeWithAmount`. `resource=inst&op=distributions` (GET, investor) returns all distributions across all the investor's approved IOI deals.

**Performance metrics per investor**
- New `resource=inst&op=performance` (GET, investor only). Per deal: `DPI` (totalDistributed / committed), `RVPI` (currentValue / committed), `TVPI` (DPI + RVPI), `moic` (= TVPI), `irr` (stubbed null). Returns `{ positions, totalCommitted, totalCurrentValue, totalTvpi }`.

**Investor welcome sequence (Day 0 / Day 2 / Day 7)**
- On investor approval: writes `welcome_seq:{investorId}` JSON `{ approvedAt, day2Sent: false, day7Sent: false }`. `resource=admin&op=welcome-cron` checks elapsed time, sends Day 2 onboarding email and Day 7 check-in email exactly once each (idempotent). Cron: `0 8 * * *` (daily 8am UTC). Templates: `sendWelcomeDay2`, `sendWelcomeDay7`.

### `advisor-portal.html`
- **NAV Update section** in deal Overview tab: form (NAV per unit, Total NAV, as-of date, notes), "Post Update" button. NAV History table (Date | NAV/unit | Total NAV | Notes), newest first. Instant local update on success — no page reload.

### `investor-portal.html`
- **Performance Dashboard** sub-tab in portfolio view: 4 summary stat cards (Total Committed, Current Value, TVPI, Total Distributions). Per-deal table (Committed / Current Value / DPI / RVPI / TVPI / MOIC in JetBrains Mono tabular-nums — TVPI ≥1.0x gold, <1.0x muted red). Distribution History accordion per deal.

### `admin-portal.html`
- **Post Distribution modal**: appears on `close`/`realized` stage deals. Per-investor preview table (fetches IOIs, calculates proportional shares client-side). Submit calls `POST /api/v2?resource=advisor&op=post-distribution`.

---

## Phase 5 — UX Polish & Performance

### `advisor-portal.html`
- JSZip `<script>` tag changed to `defer` — eliminates render-blocking load.
- `trapFocus(modalEl)` utility added — captures trigger element, intercepts Tab/Shift+Tab within modal, returns `releaseFocus()` cleanup.
- `role="dialog" aria-modal="true" aria-labelledby="..."` added to: review-notify-overlay, notifications panel.
- Advisor portal `load()`: initial data fetch changed from `op=me` to `op=dashboard` — collapses 3 sequential API calls into 1 parallel server-side fetch.

### `investor-portal.html`
- Google Fonts preconnect tags added (`fonts.googleapis.com` + `fonts.gstatic.com crossorigin`).
- `trapFocus` utility added. `role="dialog"` on NDA modal. `role="region"` on notifications panel.

### `index.html`
- Google Fonts: added missing `fonts.gstatic.com crossorigin` preconnect tag.
- Canvas particle count: 80 → 40 (halved GPU work per frame).
- `prefers-reduced-motion` support: animation loop gated behind `window.matchMedia`. Reduced-motion users get a single static draw. `change` event listener handles mid-session OS setting toggle.

### `login.html`, `forgot-password.html`, `setup-password.html`, `reset-password.html`
- Google Fonts preconnect tags added to all.
- Auth pages CSS consolidated to match portal token set — all hardcoded hex values replaced with CSS custom properties (`--gold`, `--text`, `--bg`, `--surface`, `--serif`, `--mono` etc). Identical token values to portal set.

### `admin-portal.html`
- `trapFocus` utility added. `role="dialog"` on: stage-modal, push-modal, push-preview-modal, close-raise-modal, delay-raise-modal, dist-modal. `role="region"` on notifications panel.

### `api/v2.js` + `api/_lib/storage.js`
- Added `kvZrem(key, member)` to storage layer.
- Added `getAllIois()` helper — reads `ioi_index` sorted set, fetches all records in parallel via `Promise.all`. Replaces all 15+ `kvKeys('ioi:IOI-*')` O(N) scans across: `post-nav-update`, `post-distribution`, `getApprovedIoi`, `inst/distributions`, `inst/performance`, `admin/ioi-by-deal`, `admin/deal-detail`, `admin/push-preview`, `admin/push-package`, `admin/capital-call-notify`, `admin/distribution-notify`, `admin/match-investors`, `admin/compliance-cron`, `admin/generate-statements`, `admin/generate-statements-cron`, `marketplace/my-iois`, `marketplace/deal-iois`, `admin/delete-investor`.
- `admin/publish-deal`: replaced `kvKeys('deal:*')` scan with `listDeals()` (uses existing `deals:index` sorted set).
- New `resource=advisor&op=dashboard` (GET): returns `{ advisor, deals, stats }` in one response. `advisor` and `deals` fetched in parallel server-side via `Promise.all`. Eliminates advisor portal load waterfall.

### `vercel.json`
- Q&A reminder cron: `0 9 * * *` (daily 9am UTC).
- Compliance cron: `0 2 1 * *` (monthly, 1st of month).
- Quarterly statements cron: `0 6 1 1,4,7,10 *` (Jan/Apr/Jul/Oct 1st).
- Welcome sequence cron: `0 8 * * *` (daily 8am UTC).

---

## Bug Fixes

**Broken tab navigation — advisor and investor portals**
- Root cause: Earnings tab (advisor) and Notices tab (investor) each redefined `showView` by declaring a new `function showView()` after the original. Due to JavaScript function hoisting, the new declaration hoisted above the original — `_origShowView` captured the new version instead of the original, creating infinite recursion. Every tab click caused a silent stack overflow.
- Fix: Removed both overrides. Added `if(name==='earnings') loadEarnings()` and `if(name==='notices') loadNotices()` directly into the original `showView` function in each portal.

**Rebrand revert**
- Aurum Kilo copy overhaul (landing page, investor portal, email templates) applied then reverted. Copy changes rolled back via `git revert` — all three files restored to pre-rebrand state.

---

## New Files Created

| File | Purpose |
|---|---|
| `api/_lib/ai.js` | AI Gateway routing + deal scoring helper |
| `api/_lib/blob-storage.js` | Vercel Blob stub (activate via `BLOB_READ_WRITE_TOKEN`) |
| `api/_lib/sentry.js` | Sentry error tracking stub (activate via `SENTRY_DSN`) |
| `api/_lib/docusign.js` | DocuSign e-signature stub (activate via `DOCUSIGN_ACCESS_TOKEN`) |
| `api/_lib/kyc.js` | KYC/AML stub — Onfido or Persona (activate via `KYC_PROVIDER_API_KEY`) |

## New Environment Variables (required or optional)

| Variable | Required | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Optional | Activates Vercel Blob document storage |
| `SENTRY_DSN` | Optional | Activates Sentry error tracking |
| `DOCUSIGN_ACCESS_TOKEN` + `DOCUSIGN_ACCOUNT_ID` | Optional | Activates DocuSign e-signature |
| `KYC_PROVIDER_API_KEY` + `KYC_PROVIDER` | Optional | Activates KYC/AML screening |
| `VERCEL_TEAM_ID` | Optional | Routes AI calls through Vercel AI Gateway |
| `CRON_SECRET` | Optional | Vercel-injected secret for cron endpoint auth |

## Paid Services — Not Yet Active

| Service | Env var to set | Est. cost |
|---|---|---|
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` | $0.023/GB stored + $0.04/GB transferred |
| Sentry | `SENTRY_DSN` | Free tier: 5,000 errors/mo. Pro: $26/mo |
| DocuSign | `DOCUSIGN_ACCESS_TOKEN` + `DOCUSIGN_ACCOUNT_ID` | $25/mo (100 envelopes) |
| KYC/AML (Onfido) | `KYC_PROVIDER_API_KEY` + `KYC_PROVIDER=onfido` | ~$2–5/check |
