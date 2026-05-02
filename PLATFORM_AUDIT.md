# Aurum Prism — Platform Audit (Stage 2.2)

Comprehensive cross-portal audit run after fixing the 5 dead-link issues. Categorized as **PASS**, **REAL FINDING** (action needed), or **NOTED** (intentional gap, no action).

**Run at commit:** `0ebcfd3` on `main`
**Date:** 2026-05-02

---

## ✅ PASS — verified clean

| Audit | Result |
|---|---|
| Internal HTML routes (hrefs) | All resolve to real files. `/login`, `/admin-portal`, `/advisor-portal`, `/investor-portal`, `/bot-driver`, `/bot-viewer`, `/forgot-password`, `/setup-password`, `/reset-password` all map to existing `.html` files at repo root. |
| Landing page anchor IDs | `#access`, `#platform`, `#request` all exist as `<section id="...">` in `index.html`. |
| Vercel rewrites → API destinations | Every rewrite in `vercel.json` resolves to an `op === '...'` handler in `v2.js`. Zero broken rewrites. |
| Cron contract | All 4 crons in `vercel.json` (`qa-cron`, `compliance-cron`, `generate-statements-cron`, `welcome-cron`) have matching `op === '...'` handlers in `v2.js`. |
| Admin auth boundaries | All admin-only endpoints (approve-advisor, pending-advisors, advance-stage, approve, reject-inst, deal-docs, ai-generate, sandbox-*) have proper `getAdmin()` + `unauth(res)` checks at the top. |
| Email senders | All 19 senders defined in `api/_lib/email.js` are imported and called from `v2.js`. `sendWelcomeDay2` and `sendWelcomeDay7` correctly fired by welcome-cron. No dead email functions. |
| Frontend → API endpoint coverage (post-fix) | All 4 previously-dead endpoints now wired (`nda-accept`, `notices`, `acknowledge-notice`, `earnings`). Every fetch URL in HTML has a matching handler. |

---

## 🔴 REAL FINDINGS (just fixed in this batch)

| ID | What was wrong | Fix shipped | Commit |
|---|---|---|---|
| L-1 | `inst&op=nda-accept` called by NDA modal but missing — formal acceptance with timestamp + document hash never persisted (silent compliance gap) | New handler enriches the existing `nda_signed:{instId}:{dealId}` record with `formally_accepted_at`, `timestamp`, `document_hash`, `investor_id_claimed`, `ip` | `cfba82f` |
| L-2 | `inst&op=notices` missing — investor Notices tab always empty even after admin fired capital-call-notify or distribution-notify | New handler reads `notice:{investorId}:*`. Plus extended `capital-call-notify` and `distribution-notify` to write per-investor notice records with proper amount, reference number, deal name, type | `cfba82f` |
| L-3 | `inst&op=acknowledge-notice` missing — investor "Acknowledge" button on a notice failed silently | New handler flips status to `acknowledged` + records `acknowledged_at`. Idempotent. | `cfba82f` |
| L-4 | `advisor&op=earnings` missing — Earnings tab showed graceful fallback but no real data | New handler computes `intro` (every deal × intro_fee_pct), `carry` (close/realized only × carry_pct), `payments` (read from `payment:{advisor_id}:*`, empty for now until real payment system) | `cfba82f` |
| L-5 | `CLAUDE.md` line 147 referenced `/control` page that doesn't exist | Updated to point at the real seed mechanism (`/bot-driver` Reset button) | `0ebcfd3` |
| L-6 | Admin portal had no nav links to `/bot-driver` or `/bot-viewer` (you wanted these for partner demos) | Added two `<a class="ntab">` entries after the existing System tab | `0ebcfd3` |

---

## 🟡 NOTED — intentional gaps, no immediate action

These are API endpoints that exist but have no UI button (yet). They're admin-only operations that can be invoked programmatically or will get UI later. **None are bugs.**

| Endpoint | Status | Rationale / when to add UI |
|---|---|---|
| `admin&op=create` (advisor) | No UI form to add advisors | Currently advisor onboarding is via self-signup (`advisor&op=register`) + admin approval. Manual admin-create is rarely needed. Add UI when you start onboarding non-self-signup advisors. |
| `admin&op=audit-log&dealId=X` | No UI to view per-deal audit trail | Current audit trail visible in deal-detail panel via `recent_audit`. Full chronological log endpoint exists for power-user / debugging. |
| `admin&op=capital-call-notify` | No UI button to trigger capital call | Operator must currently POST directly. Add button on close-stage deals when ready to issue capital calls. |
| `admin&op=distribution-notify` | No UI button | Same — currently the post-distribution flow auto-fires this internally. Standalone notify endpoint exists for ad-hoc notifications. |
| `admin&op=distributions` (read) | No UI page | Admin can read all distributions for a deal via API. UI not yet wired. |
| `admin&op=delete-investor` | No UI button | PDPA / right-to-be-forgotten flow. Sensitive — intentionally programmatic-only for now. |
| `admin&op=reject-inst` | No UI button | Investor rejection — operator typically just doesn't approve. Add button if/when needed. |
| `admin&op=revoke-inst` | No UI button | Revocation after approval. Same as above. |
| `admin&op=compliance-flags` (read) | No UI panel | Compliance cron writes flags; operator can read via API. UI panel for compliance overview is future scope. |
| `admin&op=kyc-status` | No UI panel | KYC integration stubbed until env var; status endpoint exists for when it's wired. |
| `admin&op=send-subscription-doc` | No UI button | DocuSign integration stubbed until env var. |
| `admin&op=check-subscription-status` | No UI button | Same. |
| `admin&op=check-nda` (read) | No UI button | Read endpoint to check whether an investor has signed NDA on a deal. UI uses inline NDA flag instead. |
| `admin&op=pending-advisors` | No UI page | AdminBot used this previously; refactored to read from sandbox-status. Still useful as a dedicated read endpoint for an admin queue UI. |
| `deals&op=tacc-feed` | External-only | HMAC-signed feed for TACC integration. Not called by our portals (intentional). |

---

## What this audit cost

Zero Anthropic tokens, zero Upstash ops (all grep / `node --check` / static analysis on local checkout). Audit ran in <2 minutes.

## Stage 2 status

| Task | Status |
|---|---|
| 2.1 — Wire 4 dead endpoints | ✅ shipped (`cfba82f`) |
| 2.1b — Cleanup CLAUDE.md + admin nav | ✅ shipped (`0ebcfd3`) |
| 2.2 — Cross-portal platform audit | ✅ this document |

## What's next

1. **Bot regression after L-1..L-6** — run `/bot-driver` Reset → Start → 2 min → Run Audit. With the new endpoints wired, the audit should still be all green (notice/earnings endpoints are GET-style and don't introduce write-side races).
2. **Phase A manual QA** (per `LIVE_LAUNCH_PLAN.md`) — emails / AI / crons end-to-end with real keys on a preview deployment. I'll provide the checklist when you're ready.
3. **Phase B cutover** — env vars (per `CUTOVER_ENV_VARS.md`), wipe sandbox, custom domain, soft-launch invites.

---

*Audit conducted by orchestrator in Stage 2.2. Methodology: grep-based static analysis across all 11 HTML/JS files in repo root + api/. Cross-referenced vercel.json rewrites, v2.js handlers, frontend fetch calls, and email.js exports. No runtime execution.*
