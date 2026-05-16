# Changelog

All website and platform changes are logged here in reverse-chronological order.

---

## [2026-05-16] — Pre-launch hardening: bot pages gated, Blob installed, gitignore tightened

### vercel.json
- Added redirects: `/bot-driver` and `/bot-viewer` → `/` (302). Direct paths no longer publicly accessible.
- Rewrote `/ops/bd7x3k` and `/ops/bv7x3k` destinations from `/bot-driver`/`/bot-viewer` to `/bot-driver.html`/`/bot-viewer.html` so the unlisted operator paths bypass the new redirects.

### package.json
- Installed `@vercel/blob@^2.3.3`. Health check `blob.connected` was failing with `Cannot find package '@vercel/blob'`; now resolves. Unblocks VDR uploads >1MB which were silently truncating in Redis.

### .gitignore
- Added `node_modules/`, `.claude/worktrees/`, `.claude/scheduled_tasks.lock`.

---

## [2026-05-08] — Final tap-target sweep: forgot-password + index (331355d)

### forgot-password.html
- `.btn` → `min-height:44px` (was rendering at ~41px, 3px short of Apple HIG)
- `.back` → `padding:18px 12px; display:inline-flex; align-items:center; width:100%` (was rendering at ~9px — link was essentially untappable on mobile)

### index.html
- `.btn-nav.ghost` height fixed at both override sites: 38px → 44px (lines 606+618 — two `!important` sites, both updated)
- `.tier-cta` selector broadened from `a.tier-cta` to `.tier-cta` — covers `<button>` elements in tier carousel (were measuring 43px)
- `.foot-link` mobile override: `padding:4px 0` → `padding:14px 0; display:flex; align-items:center` (was rendering ~22px, now ≥44px)

---

## [2026-05-08] — Comprehensive mobile + desktop card alignment overhaul

### mobile.css (universal — all portals)
- Section 10: Universal card flex-column layout — `.deal-card`, `.dash-deal-card`, `.kpi-card`, `.earn-stat-card`, `[class*="-card"]` — applies desktop + mobile; fixes ragged card rows
- Section 10: `.dc-body`, `[class*="-body"]` → `flex:1` (fills available height, pushes footer to bottom)
- Section 10: `.dc-footer`, `[class*="-footer"]` → `margin-top:auto` (pins footer to card bottom on both desktop and mobile)
- Section 11: KPI grid equal height — `align-items:stretch` on grid containers, `flex-direction:column; justify-content:space-between` on cells
- Section 12: Safe-area-inset — `body` bottom padding + `.nav` top padding for notched iPhones
- Section 13: Field label alignment on mobile — flex-column + full-width labels in card forms
- Section 14: Section headers wrap on mobile with 8px gap
- Section 15: Safe-area-aware inner padding at ≤480px for `.view-inner` and `[class*="-inner"]`
- Section 16: `table:not([class])` horizontal scroll block
- Section 17: Notification/overlay panel viewport constraint — prevents 300–340px panels clipping narrow phones
- FIX: Removed `--nav-h: calc(56px + ...)` override from Section 12 that was overwriting the two-row nav 88px value — caused content overlap on all mobile devices

### investor-portal.html
- Nav horizontal overflow guard (`max(16px, env(...))` padding, `width:100%`) in `@media(max-width:768px)` without touch gate
- `.deal-card` → `display:flex;flex-direction:column` (universal desktop+mobile)
- `.dc-body` → `flex:1` (footer push-to-bottom)
- Hero dots tap target expanded via `padding:20px 10px; margin:-20px -10px` (hit area ≥44px without visual change)
- Safe-area-inset added to `.nav` and `body` left/right
- Asset class badge contrast fix in dark mode: `.dc-class-tag`, `[class*="dct-"]` → `background:var(--bg-2)` to break color=bg contrast failure
- Timeline `min-width:0 !important; overflow-x:auto` at ≤480px
- FIX: Removed `--nav-h: calc(56px + ...)` that was overwriting the 88px two-row nav value

### advisor-portal.html
- `.dash-pipe-node` → `44×44px` at ≤768px (was 42×42, below Apple HIG minimum)
- `.dash-pipe-stage` → `min-height:44px` at ≤768px
- `.dash-deal-card` → `display:flex;flex-direction:column` (universal)
- `.ddc-body` → `flex:1` (footer push-to-bottom)
- Safe-area-inset added to `.nav` and `body` left/right at ≤768px
- Category badge contrast fix: `[class*="-badge"]`, `.ds-ioi-banner` → `background:var(--bg-3)` in dark theme
- `.ddc-name` → `color:var(--text)` in dark theme (was ratio 1.91)
- FIX: Removed `--nav-h: calc(56px + ...)` that was overwriting the 96px deal-switcher nav value

### admin-portal.html
- `@media(max-width:380px)` → kpi-strip stays 2-col at very small screens
- Table wrap horizontal overflow block at ≤768px
- `.view-inner` → `padding:16px 12px` at ≤480px
- Safe-area-inset left/right/bottom on body at ≤768px

## [2026-05-08] — Mobile UX quality scrub: touch targets, autocomplete, mobile.css link, polish

### login.html
- FIX C4: Added `@media(max-width:768px)` rule giving `.ts-back`, `.l-forgot`, `.l-link` `min-height:44px` with `14px` top/bottom padding (Apple HIG touch target compliance)
- FIX E3: Added `autocomplete="one-time-code"` to `#inv-code` input (was missing)
- FIX E3: Added `autocomplete="current-password"` to `#op-password` input (was missing)

### index.html
- FIX B2/C1: Added `<link rel="stylesheet" href="/mobile.css">` to `<head>` — index.html was the only portal not loading the universal mobile foundation (16px input rule, 44px touch targets)

### mobile.css
- Section 15: Added safe-area-aware inner padding rule for `.view-inner` / `[class*="-inner"]` at ≤480px
- Section 16: Added `table:not([class])` horizontal scroll rule for unclassed tables at ≤768px
- Section 17: Added notification/overlay panel width constraint rule (`.notif-panel`, `[class*="-panel"]:not([class*="nav"])`) at ≤768px — prevents 300–340px fixed panels from clipping on narrow phones

---

## [2026-05-08] — Add Deal: AI doc-upload flow replaces manual entry

### Admin portal ([aurumprism.com/admin-portal](https://www.aurumprism.com/admin-portal))
- Replaced manual "+ Add Deal" form with a 2-phase AI-powered flow
- Phase 1: operator uploads up to 4 documents (NDA, Management Presentation, Financials, Term Sheet) — each stored to a temp KV key (`pdoc_admin:{tempId}:{slot}`) with 1hr TTL
- Phase 2: Claude reads uploaded docs via `admin-create-from-docs` and pre-fills the full deal form; operator reviews/edits then confirms
- `submitAdminDeal()` now POSTs to `admin-confirm-new-deal` which calls `createDeal()` and moves temp doc keys to permanent `deal_doc:{dealId}:{slot}` keys
- Advisors retain manual entry in their portal — AI flow is admin-only

### Backend ([api/v2.js](file:///C:/Users/thoma/prism/api/v2.js))
- `admin-create-from-docs` op: reads staged docs, calls Claude with PDF extraction prompt, returns structured deal JSON
- `admin-confirm-new-deal` op: creates deal via `createDeal()`, migrates temp doc KV keys to permanent, deletes temp keys

---

## [2026-05-08] — Consolidate Investors + Advisors into Members tab

### Admin portal ([aurumprism.com/admin-portal](https://www.aurumprism.com/admin-portal))
- Removed separate "Investors" and "Advisors" top-nav tabs
- Added single "Members" tab with "Investors" / "Advisors" sub-tabs rendered beneath the heading
- Sub-tabs styled to match nav aesthetic (gold underline on active, hover state)
- `renderInvestors()` fires on Members tab open (default to Investors sub-tab); `renderAdvisors()` fires on switch
- Existing `investors-table-wrap` and `advisors-table-wrap` IDs unchanged

---

## [2026-05-08] — Fix action queue age display (relAge year-stripping bug)

### Admin portal ([admin-portal.html](file:///C:/Users/thoma/prism/admin-portal.html))
- `NEW_SUBMISSIONS` map now also sets `submitted_at` to the raw ISO `created_at` string
- Fixes action queue cards showing "9137d ago" — Chrome was parsing the short date string `"Apr 26"` (no year) as April 26, 2001, making every freshly seeded review deal appear 25 years old
- `relAge()` now receives a real ISO timestamp via `submitted_at` and renders correctly (e.g. "3d ago", "47d ago")

---

## [2026-05-08] — NAV & Reporting system — backend + admin + investor wired

### Backend (api/v2.js)
- `nav-summary` op: admin GET, returns all deals (all stages, never filtered) with navHistory, computed overdue flag, MOIC, holdDays
- `iois` op: admin GET, returns all IOI records for investor lens
- `nudge-nav` op: admin POST, emails advisor re: overdue quarterly NAV update
- `performance` op: now includes navHistory array per investor position
- `sendNavNudge()` email function added to email.js — operator-to-advisor nudge

### Admin portal — Reporting tab
- New "Reporting" tab in admin nav
- 5-cell KPI strip: Total Platform AUM, Active Mandates, Blended Unrealised Gain, Overdue Updates, Realized Deals
- Asset class switcher: All / Private Credit / Infrastructure / Growth Equity / Real Estate
- Live / Realized / All view toggle
- Deal table with expandable rows: sparkline + NAV history table (read-only)
- Amber overdue indicator + Nudge button fires email to advisor
- Investor lens: select investor → see all their positions + NAV history, printable

### Investor portal — Performance tab
- Fixed `loadPerfDashboard` data mapping bug (was checking `res.performance`, API returns `res` directly — always fell back to mock 1.12x hardcoded value)
- Portfolio summary strip now shows real committed/NAV/TVPI from API instead of hardcoded multiplier
- NAV History accordion per deal — shows advisor-posted quarterly marks, read-only

---

## [2026-05-06] — Two-dashboard flash fix + action card height cap

### Admin portal — data load
- Cleared hardcoded `DEALS` and `NEW_SUBMISSIONS` seed arrays (renamed to `_SEED_DEALS` / `_SEED_SUBMISSIONS`, not used) — eliminates the flash of fake data before real API data loads
- `renderOverview()` now shows a spinner ("Loading platform data…") on first render when arrays are empty, then real data paints once after `load()` completes — no more two-dashboard effect
- Action cards in scroll context capped at `max-height:220px; overflow-y:auto` — bot-seeded cards with long AI briefs no longer explode the card height and break horizontal scroll layout
- Added `@keyframes spin` for the loading spinner

---

## [2026-05-06] — Deal lifecycle rail + action queue scroll fix

### Admin portal — Deal Controls
- Added lifecycle progress rail above Current Stage chip in Deal Controls: 5 dots (Pending Confirmation → Live → Due Diligence → Terms & Conditions → Close), completed stages gold, current stage blue with glow, upcoming stages dim
- Killed/realized deals: rail stops at the last active stage

### Advisor portal — Deal detail
- Added simplified 5-step lifecycle rail above the Next Step guide in each deal's detail view, using the same visual language (gold = done, blue = current)
- IOI stage maps to "Live" step since it's still the live collection phase from the advisor's perspective

### Action Queue scroll fix
- `overflow-x:scroll` (was `auto`) so scrollbar always renders
- Styled scrollbar (4px height, subtle gold-border thumb)
- `cursor:grab` / `cursor:grabbing` visual affordance
- JS drag-to-scroll added — mouse click-drag now scrolls the queue left/right on desktop

---

## [2026-05-06] — Security hardening + sprint failure fixes + XSS sweep

### Security
- `api/login.js`: admin password comparison now uses `crypto.timingSafeEqual` — eliminates timing side-channel
- `api/login.js`: `op=check` now calls revocation denylist before returning role — revoked tokens no longer accepted
- `api/logout.js`: admin token jti now written to revocation denylist on logout — tokens irrevocable within 12h TTL fixed

### Sprint failures resolved
- `admin-portal.html`: STAGE_CHIP now includes `ioi` (gold), `terms` (amber), `realized` (green) — were falling back to wrong amber "Pending Confirmation" chip
- `admin-portal.html`: added standalone `.sc-terms` CSS class for pipeline chip rendering
- `admin-portal.html`: `renderUnassignedDealsList` — replaced undefined `esc()` calls with `_saEsc()` — was throwing ReferenceError on every open
- `advisor-portal.html`: added `ioi` key to `_stageGuides` — IOI-stage deals now show context banner
- `investor-portal.html`: `STAGE_LABELS.review` → `'Pending Confirmation'` (was still 'Review')

### Email reliability
- `api/v2.js`: `sendDealReceived` and `sendAdvisorWelcome` now have `.catch` — email failure no longer crashes the request
- `api/v2.js`: `sendIoiSubmittedToAdvisor` now called on every IOI submit — advisor notified when investor submits IOI

### XSS
- `admin-portal.html`: escaped deal name, advisor name, firm name, overview text in submissions panel
- `admin-portal.html`: escaped deal description/thesis in deal detail panel
- `admin-portal.html`: escaped IOI notes in IOI detail panel
- `admin-portal.html`: escaped deal name in pipeline rows and overview cards
- `advisor-portal.html`: escaped VDR folder and filename in data room
- `investor-portal.html`: escaped notification title and body
- `investor-portal.html`: escaped VDR folder and filename in data room

### Session handling
- `advisor-portal.html`, `investor-portal.html`: `fetchSilent` now redirects to `/login` on 401/403 instead of silently failing

---

## [2026-05-06] — Sprint 2C–4B: stage labels, DD signals, investor/advisor management, audit fixes

### Sprint 2C — "Pending Confirmation" label rollout (platform-wide)
- `advisor-portal.html`: renamed review stage to "Pending Confirmation" across STAGES, STAGE_IDX, STAGE_CHIP_CLS, STAGE_LABEL, DOT_CLS; added IOI, Terms, Realized stages which were missing entirely; added CSS chips (.sc-ioi, .sc-terms, .sc-realized, .dot-terms, .dot-realized); added _stageGuides entries for Terms and Realized; updated review guide title/body
- `admin-portal.html`: STAGE_LABELS.review → "Pending Confirmation"
- `api/_lib/email.js`: review stage email body updated to "Your deal has been published and is awaiting your confirmation. Log in to your advisor portal and confirm to make the deal visible to investors."

### Sprint 3 — DD signal on dashboard
- Blue ◆ DD badge on pipeline rows and dashboard deal cards when stage = dd
- Deal detail panel auto-opens to Dataroom tab when opened for a DD-stage deal

### Sprint 4A — Investor management screen
- New "Investors" nav tab in admin portal
- Table: firm, contact, type, geo, status chip, registered date
- Actions: Approve / Reject / Revoke (with confirmation) / View As (approved only)
- Wires to existing /api/admin/approve, /api/admin/reject-inst, /api/admin/revoke-inst

### Sprint 4B — Advisor management screen
- New "Advisors" nav tab in admin portal
- Table: name, email, firm, status chip, registered date
- View As button for active advisors

### Audit bug fixes (3 found, 3 patched)
- `admin-portal.html`: fixed display:flex on <td> elements in both management tables (wrapped in div)
- `api/v2.js`: wired sendStageChange('review') into send-to-advisor-review op — advisors now receive an email when admin clicks Send to Advisor (previously in-app notification only)
- `api/_lib/email.js`: added stageDisplayNames map — email subject/meta now shows "Pending Confirmation", "Due Diligence", etc. instead of raw stage ids

### Deferred (backlog)
- No "deal is now live" email sent to advisor on auto-publish (review→live triggered by advisor confirmation). Advisor gets in-app notification only. Pre-existing gap; low priority since advisor is the one who triggered it.

---

## [2026-05-05] — Nav avatar with initials; email fixes; magic link; admin dashboard fixes

**admin-portal.html** — Replaced `.role-badge` ("Operator" pill) in the nav with a gold-bordered circular avatar showing the operator's initials. Initials are derived from the admin email stored in localStorage on login (e.g. `admin@aurumprism.com` → "AD"). Falls back to "OP" if no email stored. CSS class `.nav-avatar` was added. Also fixed: TDZ crash on dashboard load (moved `REAL_INVESTORS`/`REAL_ADVISORS` declarations before first render call); replaced hardcoded dummy activity feed with live data; defaulted Action Queue and Team Access sections to open.

**login.html** — On successful operator login, stores email to `localStorage.prism_admin_email` before redirect so avatar initials are available without an extra API call. Also added magic link auto-login IIFE: if `?email=X&code=Y` params present on load, auto-fills the investor form and submits after 400 ms.

**api/_lib/email.js** — Full rewrite of all email template functions to use inline styles instead of CSS classes (classes are stripped by email clients). Added `kv()` / `kvTable()` helpers for key-value tables. Added magic link (`/login?email=X&code=Y`) to `sendAccessCode` so investors land on the platform without manually entering their code.

---

## [2026-05-05] — disclosures.html: fill placeholder strings with agreed values

**disclosures.html** — Replaced all `[PLACEHOLDER — ...]` strings with their confirmed values. No restructuring or restyling. Changes: UEN, registered address, compliance contact, MAS classification, MAS reference number, permitted activities, fund administrator, custodian, auditor, SG legal counsel, US legal counsel, KYC/AML vendor, platform access fee, management fee, performance fee, placement fee rate and charged-to, and effective date. Items still awaiting final confirmation are marked `[TBD — ...]`.

---

## [2026-05-05] — Production hardening: bot page redirect + notification dead-click fix

**vercel.json** — Added `redirects` block before `rewrites`. `/bot-driver` and `/bot-viewer` now redirect to `/` (302) in all deployments. Bot pages remain reachable by admin directly via Vercel preview URL or by temporarily removing the redirect — they are not permanently deleted.

**advisor-portal.html** — Added null guard in `notifClick()`. If `dealIdx < 0` (notification references a deal that no longer exists in the advisor's list — e.g. stale data after a sandbox reset or deal reassignment), the function now shows a brief "This deal is no longer available" toast and returns early instead of silently closing the panel and doing nothing.

---

## [2026-05-03] — Wave 3 frontend — gap registry UI (`advisor-portal.html`, `admin-portal.html`, `investor-portal.html`)

Wired the Wave 3 backend contract into the three portals.

**Portals modified.**
- `advisor-portal.html` — banking persistence, push-package list + accept/decline modal, real activity feed, doc slot label fix, seed data realigned.
- `admin-portal.html` — "Unassigned deals (N)" pill in the Pipeline header, modal listing orphaned deals with advisor `<select>` + Assign button, badge auto-refreshes after assign.
- `investor-portal.html` — doc-slot labels aligned to `NDA / Sponsor Memo / Financial Model / Term Sheet`. Added a slot→label mapping so API-supplied docs always render with the canonical label.

**JS functions added/rewritten.**
- `loadBankingIntoForm()` — `GET op=get-banking`, prefills the deal-materials banking form, shows masked account number and an Edit button to clear it; renders an "Updated Xd ago" pill in the section header.
- `saveBankingDetails()` — rewritten. Maps Section A → contract fields (`account_holder`, `bank_name`, `account_number`, `swift_code`, `address`, `notes`), validates required fields, POSTs `op=save-banking`, disables the button while in flight, drops a mono-italic `Updated · HH:mm SGT` confirmation under the button. Skips sending `account_number` if it's still the masked value (until the user clicks Edit). Section B (distribution account) still persists locally per-deal until the contract extends.
- `loadPushPackages()`, `renderPushPackagesInto()`, `openPkgRespModal()`, `closePkgRespModal()`, `submitPackageResponse()` — full lifecycle for the new "Pushed IOI Packages" dashboard section. Cards show `dealName · stage`, mono amount, relative timestamp; pending shows Accept/Decline; responded shows status + timestamp + note. Accept/Decline open the confirm modal (optional 1000-char note, `role="dialog" aria-modal="true"`). On `already_responded` shows a calm toast and refreshes.
- `loadAdvisorActivityFeed()`, `renderAdvisorActivityInto()`, `goToDealById()` — `GET op=activity`, last 50 entries, color-tinted by kind (deal_created / published / ioi_received / qa_question_submitted / stage_advanced), relative timestamps in mono, deal name in serif italic, summary in body sans, click jumps to the deal detail.
- `acceptAdminIOI()` / `declineAdminIOI()` — now send both `response` (new contract) and `decision` (legacy) on `respond-package` for backward compatibility.
- `_pkgRel()` / `_actRel()` / `_bkRel()` / `_udmRel()` — small relative-time helpers.
- (admin) `refreshUnassignedDealsBadge()`, `renderUnassignedDealsList()`, `openUnassignedDealsModal()`, `closeUnassignedDealsModal()`, `confirmAssignAdvisor()` — pill auto-hides at zero, modal uses the existing `trapFocus()` pattern, removes the row + decrements the count on success.

**Markup added.**
- Advisor: `#pkg-resp-overlay` confirm modal (gold-bordered, role=dialog), `#pkg-list-root` and `#pkg-list-count` on the dashboard, `#dash-activity-root` for the live feed.
- Admin: `#unassigned-deals-modal`, `#unassigned-deals-btn` pill in the Pipeline header.

**Doc slots normalised.**
- Advisor `DOC_DEFS` rewritten to canonical four: `nda` "NDA", `mgmt` "Sponsor Memo", `fin` "Financial Model", `term` "Term Sheet". The previous `nda/teaser/im/financials/model` scheme is gone (term sheet was missing entirely).
- Seed deals (`d1/d2/d3/d8`) rewritten to use the new keys.
- Investor portal label list aligned to the same canonical set; added `SLOT_LABEL` map so backend-supplied docs always render the right label regardless of historical naming drift.

**Operator-facing copy.**
- "Pushed IOI Packages" dashboard heading, "No pushed IOI packages yet — admin will forward investor indications here." empty state.
- "No recent activity. Submit a deal to see updates here." (italic, mute) for empty activity feed.
- "This package has already been responded to" non-alarming toast on `409 already_responded`.
- Banking save inline confirmation: `Updated · 16:42 SGT` (mono italic, gold).
- Admin pill: `Unassigned deals (N)` — only visible while N > 0.

No backend or contract deviations.

---

## [2026-05-03] — Wave 3 backend — gap registry fixes (`api/v2.js`)

Closed CRITICAL gaps #1, #2, #3 + SIGNIFICANT #6 from the platform gap registry. Verified gap #7 (doc slot labels) and gap #12 (IOI declined email) were already correct on the backend.

**Endpoints added.**
- `POST resource=advisor&op=save-banking` — persist banking details to `advisor_banking:{advisor_id}`. Required: `account_number`, `swift_code`. All fields ≤200 chars. Audit-only payload (no raw numbers).
- `GET resource=advisor&op=get-banking` — own record, account number masked to `XXXX••••XXXX`.
- `GET resource=admin&op=advisor-banking&advisorId=X` — full unmasked record. Logs `banking_viewed` to advisor audit trail.
- `GET resource=advisor&op=packages` — lists pushed packages across all of advisor's deals with response status.
- `GET resource=admin&op=unassigned-deals` — orphaned deals (null/non-`adv-` advisor_id) + active advisor list.
- `POST resource=admin&op=assign-advisor` — sets `deal.advisor_id`, audits `advisor_assigned`.
- `GET resource=advisor&op=activity` — last 50 audit entries across advisor's deals, with one-line human summaries.

**Endpoint extended.**
- `POST resource=advisor&op=respond-package` — now accepts `response` (Wave 3 contract) as an alias for `decision`. Optional `note` (≤1000 chars). Idempotent: returns `409 already_responded` if package was already accepted/declined. Triggers minimal operator alert email (Resend, no PII beyond firm + deal name).

**KV keys touched.**
- `advisor_banking:{advisor_id}` — JSON `{bank_name, account_holder, account_number, swift_code, iban, address, currency, notes, updated_at, updated_by}`.
- `audit:advisor:{advisor_id}` — sorted set of advisor-scoped audit entries (`banking_updated`, `banking_viewed`).
- `package:{packageId}` — added `advisor_decision_note` field on response.

**Audit events added.** `banking_updated`, `banking_viewed`, `advisor_assigned`, `package_accepted`/`package_declined` now carry `{advisor_id, note}` in meta.

**Email triggers wired.**
- IOI declined → already wired (`sendIoiRejection` in `op=reject-ioi` since pre-Wave 3) — no change needed.
- Package accept/decline → operator alert via direct Resend POST (NOTIFY_EMAILS), inline because no shared template existed and the spec said do not invent copy.

**Verified existing.**
- Gap #7 (doc slot labels): backend already uses `nda/mgmt/fin/term` consistently (`api/v2.js` lines 382, 1443, 2049, 2084, 2497, 2864). No backend change. Frontend agent owns the label fix.
- Gap #12 (IOI declined email): `op=reject-ioi` already calls `sendIoiRejection`. Mark `[DONE]`.

**Contract deviations.**
- `respond-package` op-name and `decision` field already existed pre-Wave 3. The new `response` alias is additive. Both shapes work; recommend frontend agent use `response` per spec.
- Operator alert on package response is sent directly via Resend rather than through `_lib/email.js` because the spec said "use existing operator-alert template if present, else add a thin one" and "DO NOT invent copy" was reserved for IOI declined. The thin inline alert is plain text, no marketing copy.

**Env vars required.** None new. Uses existing `RESEND_API_KEY`, `NOTIFY_EMAILS`, `SITE_URL`, `BOT_MODE`.

**What to test.**
- Advisor portal POSTs `op=save-banking` → KV `advisor_banking:{id}` populated, audit entry written, account number not in audit payload.
- Advisor `op=get-banking` returns masked account.
- Admin `op=advisor-banking` returns unmasked + writes `banking_viewed` audit.
- Advisor `op=packages` returns all packages for that advisor's deals; non-advisor deals not exposed.
- Advisor `op=respond-package` with `response: 'accepted'` → deal stage = `dd`, second call returns 409.
- Admin `op=unassigned-deals` returns deals with null/non-adv advisor_id.
- Admin `op=assign-advisor` sets advisor on orphaned deal + audits.
- Advisor `op=activity` returns last 50 audit entries from advisor's deals only, sorted desc.

---

## [2026-05-03] — DD Dataroom — frontend (`advisor-portal.html`, `investor-portal.html`)

Aligned the existing Dataroom tab UI on both advisor and investor portals to the new contract built by the backend agent. Tab name standardised to "Dataroom" (single word) on both sides.

**Advisor portal (`advisor-portal.html`).**
- Tab `#ctab-dataroom` already gated on `stage==='dd'`. Label changed `Dataroom / Q&A` → `Dataroom`.
- New helpers: `_humanSize()`, `_relTime()`, `_readBase64()`, `_postVdrBatch()`.
- `loadVdrAndQa()` rewritten to consume the contract: maps `{files:[{fileId,name,size,mimeType,uploadedAt,uploadedBy}], dd_deadline, dd_active}` from `op=vdr-files`, and `{threads:[{id,question,asked_by,asked_by_name,asked_at,answer,answered_at}], dd_deadline, dd_active}` from `op=qa-thread`. Threads sorted open-first then date-desc. Schedules a 60s self-refresh while the dataroom panel is active.
- `handleVdrUpload()` reworked: 4MB per-file guard, 8MB per-request guard, base64 read via FileReader, files batched into multiple POSTs against `op=vdr-upload` (backend's actual op-name) when total payload exceeds 8MB. ZIP path now uploads extracted entries through the same batched flow instead of the legacy local-only push.
- `viewVdrFile()`: was a toast stub — now fetches via `op=vdr-file&dealId=X&fileId=Y`, decodes contentBase64 to a Blob, opens PDFs/images/text inline in a new tab, downloads office formats (xlsx/docx/pptx). Object URL is revoked after 60s.
- `sendQaReply()` now sends `{dealId, threadId, answer}` per contract; broadcast / opening-statement path removed (no contract op for it). Replies trigger a re-fetch of the thread instead of mutating local state.
- DD banner: prefers API-supplied `dd_deadline`/`dd_active`. Falls back to `closing - 14d` for unconfigured deals. Renders `DD CLOSES IN N DAYS · <date>` when active, `DD PERIOD ENDED · <date>` when inactive, and `DD DEADLINE — Set closing_date in deal settings` when no deadline is set.
- File row Delete button removed (no contract op exposed for delete).

**Investor portal (`investor-portal.html`).**
- Dataroom tab now gated on BOTH `stage==='dd'` AND `PORTFOLIO.some(p=>p.deal_id===d.id && p.status==='approved')`. Hidden entirely for investors without an approved IOI on that deal. Label changed `Dataroom / Q&A` → `Dataroom`.
- New helpers: `_invHumanSize()`, `_invRelTime()`.
- `loadVdrFilesInvestor()` and `loadQaThread()` rewritten against the contract. 403 from `op=vdr-files` flips `d._ddTabBlocked` and clears the file list. `loadQaThread()` maps masked `asked_by_name` (backend already returns "Investor #N"), labels self-questions as "You", sorts open-first, schedules 60s self-refresh.
- `submitInvestorQuestion()` enforces 2000-char cap client-side, surfaces backend errors `dd_closed` ("DD period has ended — questions are no longer accepted") and `not_authorized` ("You need an approved IOI to submit questions"). On success, re-fetches the thread instead of optimistic local append.
- `viewVdrFileInvestor()` consumes `{file:{name,mimeType,contentBase64,size}, watermark:{investor_id,investor_name,viewed_at}}`. Office formats (xlsx/docx/pptx/doc/xls/ppt) route to a new `showVdrViewerUnsupported()` modal instead of attempting in-browser render.
- `showVdrViewer()` now: receives the watermark object from the API; image MIME types render through `<img>` instead of iframe; modal has `role="dialog"`, `aria-modal="true"`, `oncontextmenu` returning false; calls `trapFocus()` on open.
- Watermark CSS overhauled to brand spec: `Cormorant Garamond` italic, 22px (14px on mobile), `rgba(197,165,114,0.4)`, `rotate(-30deg)`, ~10 repeated rows.
- DD banner unified with the advisor portal logic.

**Contract deviations.**
- Spec listed `op=upload-vdr`; backend implements `op=vdr-upload` (per the backend changelog entry below). Frontend wired to `vdr-upload` to match the running API. A code comment flags this.
- Spec called for an "Opening Statement" / broadcast path on the advisor side. The contract has no broadcast op, so the button was removed. Advisor can still answer any specific thread.
- Spec called for canvas-based image watermarking; implemented as the same DOM overlay used for PDFs (functionally equivalent — overlay is `pointer-events:none` over an `<img>` that has `oncontextmenu` disabled). Cleaner than canvas re-encode.

**TODOs / operator notes.**
- xlsx/docx/pptx in the investor viewer: deferred. Watermarking those client-side requires a heavyweight library. For now the investor sees `View not supported in browser — contact the platform operator for a watermarked copy`. Operator should hand-deliver these formats out-of-band.
- Advisor cannot delete uploaded files from the UI — no `op=vdr-delete` in the contract. Operator must clear via admin tooling if needed.
- Auto-refresh interval is 60s; no manual refresh button.

**Manual QA — operator script.**
1. Log in as advisor. Open a deal at `stage==='dd'`. Confirm the new "Dataroom" tab is visible; tabs on non-DD deals stay hidden.
2. Click Dataroom. Confirm DD banner shows expected countdown. Drop 2–3 PDF files (<4MB each, total <8MB) on "Upload to Dataroom"; toast confirms upload count; file list re-renders with `name · size · time ago · View` rows.
3. Click View on the PDF — opens in a new tab inline.
4. Try uploading a >4MB file — frontend rejects with toast before any POST.
5. Log in as investor with an approved IOI on that deal. Open the deal — "Dataroom" tab appears (and is hidden on deals where you have no approved IOI).
6. Click Dataroom. Files list shows what the advisor uploaded.
7. Click View on a PDF — modal opens with watermark "AURUM PRISM · <your name> · <your email> · <iso timestamp> · CONFIDENTIAL" repeating diagonally in gold italic; right-click suppressed inside the modal.
8. View on an xlsx — "View not supported in browser" message instead of download.
9. Type a question (<2000 chars), Submit. Toast "Question submitted". Question appears top of thread.
10. Switch back to advisor. Dataroom shows the new question with "Unanswered — reply" affordance. Click it; type answer; Send. Toast "Reply sent".
11. Switch back to investor. Within 60s the thread auto-refreshes; question now shows the answer; other investors' questions masked to "Investor #N", own labelled "You".
12. After DD window expires, submit-qa returns `dd_closed` — toast surfaces it; compose box is replaced with "DD period has closed" message.

---

## [2026-05-03] — Brand polish: 404, 500, OG image, favicons, robots, sitemap

Production hygiene pass — branded error pages, full social-preview metadata, favicon set with PNG fallbacks, search-engine guidance. Visual treatment matches the landing page: near-black `#070706` ground, gold `#C5A572` accents, Cormorant italic display, JetBrains Mono eyebrows/labels, DM Sans body. No tracking, no cookie banner, no analytics.

**Files added.**
- `404.html` — branded "This room is not on the register." with watermark, two CTAs (return / member login), TACC footer. Self-contained inline CSS. Mobile-tested at 360px (links stack vertically).
- `500.html` — same template, "A momentary disturbance." Points to status.aurumprism.com.
- `og-image.png` — 1200×630 PNG, 182,595 bytes (~178 KB, under 200 KB target). Centered Cormorant italic headline ("The room you were never shown.") plus reused slide-1 prism SVG to the right, AURUM | PRISM watermark top-left, "Invitation only" tag top-right, footer line.
- `og-source.html` — render source for the OG image. Not deployed in any meaningful way (Vercel will serve it, but nothing links to it). Kept so the image can be regenerated on rebrand by running playwright against this file.
- `Au.svg` — file-based version of the existing inline data-URI Au monogram, for `/Au.svg` references.
- `apple-touch-icon.png` (180×180), `favicon-32.png` (32×32), `favicon-16.png` (16×16) — generated from the same Au monogram via headless Chromium.
- `site.webmanifest` — PWA manifest with theme/background `#070706`, standalone display.
- `robots.txt` — allows `/`, disallows portals + bot-driver/bot-viewer, points to sitemap.
- `sitemap.xml` — six public pages (`/`, `/login`, `/privacy`, `/terms`, `/risk`, `/disclosures`) with 2026-05-03 lastmod.

**Files modified.**
- `index.html` — added theme-color, canonical, file-based favicon link tags (32/16/apple-touch/manifest), full Open Graph set (title, description, url, type, image with dimensions, site_name), Twitter `summary_large_image` card. Did not touch existing inline data-URI SVG favicon (still primary).
- `admin-portal.html`, `advisor-portal.html`, `investor-portal.html`, `login.html` — added theme-color + file-based favicon link tags + manifest. Existing inline-SVG favicons preserved (loads first, the file-based PNGs are fallbacks for browsers that prefer external icons, especially iOS Safari which needs the apple-touch-icon).

**Open Graph image specs.**
- Dimensions: 1200×630 (Facebook + LinkedIn + Twitter `summary_large_image` baseline).
- File size: 178 KB.
- Format: PNG, 8-bit RGB, non-interlaced.
- Render path: `og-source.html` rendered via playwright `chromium.launch()` at 1200×630 viewport, deviceScaleFactor 1, networkidle wait + 800 ms webfont settle, fixed clip.

**vercel.json.** Not modified. Confirmed `cleanUrls: true` is set; no rewrite rules block the new static files (`/og-image.png`, `/site.webmanifest`, `/robots.txt`, `/sitemap.xml`, `/Au.svg`, the favicon PNGs); existing CSP allows `img-src 'self' data: blob:` so the OG image and favicons load fine.

**Verification.** Rendered `404.html` and `500.html` locally via playwright at 1280×800 and 360×720. 404: gold "Error 404" eyebrow, large italic Cormorant headline wraps to two lines on desktop and three on mobile, two CTAs side-by-side desktop / stacked mobile, footer pinned bottom. 500: same structure, "A momentary disturbance." headline holds on one line desktop and wraps cleanly mobile.

**TODOs / notes.**
- Apple touch icon, favicon-16, favicon-32 generated fresh from the Au mark; existing inline data-URI SVG favicons across all portals untouched (per directive: don't break existing).
- `og-source.html` is a render artifact, not a deployed page — no nav links to it but it will be served if anyone hits the URL directly. Acceptable.
- No analytics, no cookie banner — separate task with legal review.
- No deploy run; operator to push when ready.

---

## [2026-05-03] — DD Dataroom — backend (`api/v2.js`)

DD Dataroom + Q&A backend wired to the contract shared with the frontend agent. Existing partial implementation extended; legacy field aliases preserved so older portal calls keep working.

**Endpoints (all under `/api/v2`)**
- `POST resource=advisor&op=vdr-upload` — advisor only, must own deal, stage must be `dd` or `terms`. Body `{ dealId, files: [{name, size, contentBase64, mimeType}] }`. Per-file cap 4MB → `{error:'file_too_large', maxBytes:4194304}` (413). Total cap 8MB → `{error:'payload_too_large'}` (413). Returns `{ files: [{fileId, name, size, mimeType, uploadedAt}] }`.
- `GET resource=advisor&op=vdr-files&dealId=X` — advisor (own deal) or admin. Returns `{ files, dd_deadline, dd_active }`.
- `GET resource=advisor&op=vdr-file&dealId=X&fileId=Y` — advisor own deal. Returns `{ file: {name, mimeType, contentBase64, size} }`.
- `GET resource=inst&op=vdr-files&dealId=X` — investor with approved IOI. Returns `{ files, dd_deadline, dd_active }`. Otherwise 403 `{error:'not_authorized'}`.
- `GET resource=inst&op=vdr-file&dealId=X&fileId=Y` — investor with approved IOI. Returns `{ file, watermark: {investor_id, investor_name, viewed_at} }`. Audits `vdr_view`.
- `POST resource=inst&op=submit-qa` — investor with approved IOI. Body `{ dealId, question }`. Sanitised + capped at 2000 chars. Returns `{ threadId }`. Rejects with `{error:'dd_closed'}` (403) when DD window has expired. Audits `qa_question_submitted`. Triggers `sendQaQuestionToAdvisor(advisor, deal, question, threadId)`.
- `POST resource=advisor&op=answer-qa` — advisor own deal. Body `{ dealId, threadId, answer }` (`qaId` accepted as backward-compat alias). 2000-char cap. Rejects with `{error:'invalid_thread'}` if not found or already answered. Audits `qa_answered`. Triggers `sendQaAnswerToInvestor(investor, deal, threadId)`.
- `GET resource=advisor&op=qa-thread&dealId=X` — advisor own deal or admin. Returns `{ threads, qa, dd_deadline, dd_active }` with real investor identity. (Existing alias `qa-thread-advisor` still accepted.)
- `GET resource=inst&op=qa-thread&dealId=X` — investor with approved IOI. Returns `{ threads, qa, dd_deadline, dd_active }` with `asked_by_name` masked to `Investor #N` via `qa_anon_map:{dealId}`.

**KV keys**
- `vdr:{dealId}:files` — JSON array of `{fileId, name, size, mimeType, uploadedAt, uploadedBy, ...}` metadata only. Mirrored to legacy `vdr:{dealId}:index` for older readers.
- `vdr:{dealId}:file:{fileId}` — full record `{name, size, mimeType, contentBase64, uploadedAt, uploadedBy}`.
- `qa:{dealId}` — JSON array of Q&A entries. Carries both contract field names (`asked_by_name`, `asked_at`, `answered_at`) and legacy aliases (`askedBy`, `askedAt`, `answeredAt`).
- `qa_anon_map:{dealId}` — JSON object `investor_id → "Investor #N"`. Backfilled lazily on first investor `qa-thread` read.
- `qa_pending:{dealId}:{threadId}` — unchanged 48h reminder marker.

**Audit log events**
`vdr_upload`, `vdr_view`, `qa_question_submitted`, `qa_answered`. All written via `appendAuditEntry()` (immutable sorted set `audit:{dealId}`) and mirrored onto `deal.audit_log[]`.

**Email triggers wired**
- New question → `sendQaQuestionToAdvisor(advisor, deal, question, threadId)`.
- Advisor answer → `sendQaAnswerToInvestor(investor, deal, threadId)`.

**Deferred / TODOs**
- File content stays in Redis. `// TODO: route to blobStore.put() when BLOB_READ_WRITE_TOKEN is set` placed in `vdr-upload`. Vercel Blob NOT activated per scope.
- Watermark is data-only; frontend overlays at render time.

**Env vars**
None added. Existing `RESEND_API_KEY`, `KV_REST_API_*`, `PRISM_SECRET`, `SITE_URL`, `NOTIFY_EMAILS` cover the feature.

**Files changed**
- `api/v2.js` — new helpers `ddInfo()`, `sanitizeText()`, `assignAnonLabel()`, `maskQaThreadsForInvestor()`; rewrote `advisor:vdr-upload`, `advisor:vdr-files`; added `advisor:vdr-file`; extended `advisor:qa-thread(-advisor)`; rewrote `advisor:answer-qa` to accept `threadId`; rewrote `inst:vdr-files`, `inst:vdr-file`, `inst:submit-qa`, `inst:qa-thread` for the contract shape and anon masking. `nanoid` imported at top.

---

## [2026-05-03] — Transactional email templates audited and rewritten (`api/_lib/email.js`)

Brought every transactional email up to a single private-bank register voice. No call-site changes — function names and existing parameters preserved; new templates added with consistent naming so wiring can follow in the next pass.

**Voice principles applied across all templates.**
- Subject lines: `Aurum Prism — <noun phrase>: <deal/firm>` format. 6–9 words, em-dash separator. No emoji, no exclamation, no `[ACTION REQUIRED]` brackets.
- Greeting: `Dear <First name>,` for member-facing mail; bare body for operator alerts.
- Opening: states the fact in one sentence — not "We're writing to inform you…".
- Body: 2–4 short paragraphs, plain English. Numbers, dates, IDs in monospace.
- One CTA per email: "Open the data room", "Sign in", "View distribution". No stacked buttons.
- Sign-off: `— The Operator, Aurum Prism` on member mail.
- Forward-looking IRR figures explicitly framed as illustrative (welcome Day 7, deal-received operator alert).

**Templates rewritten (existing functions, signatures preserved).**
1. `sendAccessCode` — admission-confirmed register, KYC/NDA prompt added on first session.
2. `sendDealReceived` — both operator alert and advisor confirmation; advisor side now greets and closes properly, target IRR explicitly marked illustrative.
3. `sendStageChange` — added entries for `realized` and `killed` stages; reworded `live`, `ioi`, `dd`, `terms`, `close`, `review` to operator-voice.
4. `sendDataRoomAccess` — proper greeting, single CTA, watermark/confidentiality reminder retained.
5. `sendAccessApplication` — operator alert tightened.
6. `sendAdvisorApplication` — applicant ack rewritten in private-bank register.
7. `sendAdvisorWelcome` — "account active" tone, no "Welcome to Aurum Prism!" hype.
8. `sendPasswordReset` — six-digit / thirty-minute spelled out.
9. `sendIoiConfirmation` — now accepts optional `ioi` arg to surface IOI amount; sets explicit five-business-day SLA.
10. `sendIoiRejection` — gracious, brief, preserves register standing.
11. `sendDataRoomPackageResponse` — voice match.
12. `sendQaQuestionToAdvisor` — accepts optional `threadId` for deep link; investor identity explicitly noted as masked.
13. `sendQaAnswerToInvestor` — accepts optional `threadId` for deep link.
14. `sendCapitalCallNotice` — accepts new `data = { amount_usd, due_date, call_number }`; renders amount and settlement date in mono table; account numbers explicitly kept off email.
15. `sendDistributionNotice` — voice polish (legacy, no-amount path).
16. `sendDistributionNoticeWithAmount` — proper greeting, allocation type and amount in mono table, tax-form reference.
17. `sendQaReminder` — references advisor scorecard.
18. `sendNavUpdate` — proper greeting, mono table layout (replaced flexbox which Outlook ignores).
19. `sendStatementAvailable` — voice polish, tax-form reference.
20. `sendWelcomeDay2` — rewritten as orientation note (marketplace / IOI / Q&A); preferences link added.
21. `sendWelcomeDay7` — rewritten as marketplace snapshot; explicit "target IRR is illustrative" line.

**Templates added (new exports — no call sites yet, wiring is a separate task).**
- `sendAccessApplicationAck` — investor application receipt; sets five-business-day expectation, no "you're in" language.
- `sendAccessApplicationDeclined` — investor application declined; gracious, no reasoning, twelve-month re-apply window.
- `sendAdvisorApplicationDeclined` — advisor application declined; same posture.
- `sendIoiSubmittedToAdvisor` — advisor notification when an investor submits an IOI; investor identity noted as held by operator.
- `sendComplianceFlag` — KYC / NDA renewal due; sends to investor and to `NOTIFY_EMAILS`. Accepts `data = { type, daysRemaining, expiresOn }`.

**Templates flagged for operator copy approval before deploy.**
- `sendAccessApplicationDeclined` (rejection copy is sensitive — operator should sign off before any auto-trigger).
- `sendAdvisorApplicationDeclined` (same — sensitive).
- `sendComplianceFlag` (mentions possible suspension of new IOI submissions during renewal — operator should confirm this is the policy before sending).

No new dependencies. CSS remains inline. Email visual identity (gold `#C5A572`, ivory `#ece6da`, near-black `#0e0d0c`, mono eyebrows, italic serif headlines) preserved.

---

## [2026-05-03] — Legal & compliance pages added (new files: `privacy.html`, `terms.html`, `risk.html`, `disclosures.html`)

Four standalone legal/compliance pages required for production launch, styled to match the landing page (Cormorant Garamond italic headlines, JetBrains Mono eyebrows, DM Sans/Outfit body, Aurum gold on near-black). Each page opens with an "In short" plain-English summary followed by numbered legal sections.

- **`privacy.html`** — PDPA + GDPR privacy policy. Data categories, lawful bases (contract, legal obligation, legitimate interest, consent), retention windows (KYC 5y per MAS Notice SFA04-N02, deal records 7y post-close), sub-processor list (Vercel, Upstash, Resend, DocuSign, KYC vendor TBD), international transfers note, essential-cookies-only disclosure, full PDPA/GDPR rights enumeration, DPO contact `privacy@theaurumcc.com`.
- **`terms.html`** — Platform user agreement. Invitation-only / no public offer, eligibility (SG SFA accredited/institutional + US Reg D 506(c)), Member obligations (NDA, no-scrape, no-redistribute watermarked dataroom, no reverse-engineer), IP allocation (TACC retains platform IP / sponsor retains deal IP), suspension at operator discretion, no-advice disclaimer (Prism is not a broker-dealer), liability cap (greater of fees paid or SGD 10,000), Singapore law + SIAC arbitration, survival clauses.
- **`risk.html`** — Risk disclosure. Headline-risk total-loss warning, twelve specific risk categories (illiquidity, lock-up, no public market, sponsor concentration, FX, jurisdictional, valuation subjectivity, conflicts, leverage, operational, tax), illustrative-returns-not-promises language, suitability test, self-attestation block.
- **`disclosures.html`** — Regulatory + conflicts. Operating entity register, MAS regulatory status block, service-provider table (fund admin, custodian, auditor, counsel, KYC), fee schedule (platform / management / carry / placement / expenses), conflicts policy (TACC-sponsored deal flagging, affiliated advisors, carry-share disclosure, allocation methodology, personal-account dealing), marketing restrictions, complaints procedure.
- **Footer linked.** `index.html` footer grid updated from 4 columns (`2fr 1fr 1fr 1fr`) to 5 columns (`2fr 1fr 1fr 1fr 1fr`); new "Legal" column links to all four pages. `cleanUrls: true` in `vercel.json` means files at root resolve at `/privacy`, `/terms`, `/risk`, `/disclosures` — no rewrite rules required.

**Operator must fill before publishing.** All factual gaps are marked with `[PLACEHOLDER — ...]` styled with a dashed gold border so they're impossible to miss in review:
1. Effective date (appears on all four pages — set to publication date)
2. TACC Pte Ltd UEN (privacy + terms + disclosures)
3. TACC registered office address in Singapore (privacy + disclosures)
4. KYC/AML vendor name + data location (privacy + disclosures)
5. MAS regulatory classification (RFMC / LFMC / exemption claimed)
6. MAS licence or registration number
7. Description of permitted regulated activities
8. Fund administrator
9. Custodian
10. Auditor
11. Singapore legal counsel
12. US legal counsel
13. Compliance contact email (if different from `privacy@theaurumcc.com`)
14. Fee schedule rates: platform access fee, management fee %, carry % + hurdle + catch-up, placement fee structure

No regulator references, licence numbers, AUM figures, or fee percentages were invented. All forward-looking return language reads "illustrative" / "targeted" / "not a forecast" per house style.

---

## [2026-05-03] — Prism Colors exploration sheet (new file: `prism-colors-explore.html`)

Created a standalone exploration mockup at the repo root for operator review BEFORE any change to live portals. Renders two candidate palettes side-by-side (Option A: dark navy + royal purple + Aurum gold + electric cyan #5FD9E5; Option B: same trio + champagne ivory #F0E4C9) across two highest-impact screens: investor marketplace and admin deal detail. Includes a three-way comparison strip (current live theme vs A vs B), palette swatches with hex codes and CSS variable names, a recommendation block leading with Option A (cyan ties to prism/refraction narrative, stays distinct from gold), and a five-question operator decision block. NO live portal files modified — `index.html`, `admin-portal.html`, `advisor-portal.html`, `investor-portal.html` untouched. Not deployed. Awaiting operator review.

---

## [2026-05-03] — Hero side label — shortened (`index.html`)

`Capital flows / out of platform` → `Capital / flows out`. Matches the two-line rhythm of the left-side `Deals / flow in` label and reads cleaner.

---

## [2026-05-03] — Landing access tiers — CTA alignment fix (`index.html`)

Three CTAs sat at different vertical positions and widths across the row (card 1 wide gold-fill at top, card 2 narrow centered, card 3 narrow upper-right) because `.tier-cta` was `display:inline-block` and `.tier` was a block, so each button sized to its text and floated at the natural end of the content. Fixed by making `.tier` a flex column and `.tier-cta` a full-width block with `margin-top:auto`, so all three CTAs span their card width and snap to the bottom edge regardless of content length. Padding bumped 12px → 14px for a touch more presence; `cursor:pointer` added since `<button>` already had it but the rule now applies uniformly.

---

## [2026-05-03] — Landing access tiers — three distinct color schemes (`index.html`)

Operator flagged that on desktop the Institutional and HNW & Private cards looked identical (both used the gold `tier-cta-card` + `inst` styling). Reworked so each of the three cards has its own scheme, both desktop and mobile.

- **Card 1 — Institutional** → all gold. `.tier-badge.inst` color switched from `#5a98ec` (blue) to `var(--gold)` so badge, item dots, and the solid-gold CTA are unified. Card border/bg unchanged (`.tier-cta-card`).
- **Card 2 — HNW & Private Capital** → sapphire/violet. New CSS palette `--sapph #8da4d8` + `--sapphBd / --sapphBdS / --sapphW`. New card class `.tier.tier-hnw` (border, gradient bg, hover glow) and CTA variant `.tier-cta.hnw` (outline button, hover lift). Card 2 markup switched from `tier-cta-card` + `inst` classes → `tier-hnw` + `hnw`. Badge inherits the sapphire scope from `.tier.tier-hnw .tier-badge`.
- **Card 3 — Deal Advisors** → teal. Unchanged (already used `.tier-adv`).
- **Mobile carousel** — the existing `:nth-child(2)` mobile rule used `.tier-badge.inst` as a scoping selector, which no longer applies (card 2 dropped `inst`). Replaced with `.tier.tier-hnw:nth-child(2)` selectors so the sapphire tint and watermark color carry through cleanly. Card border on mobile now uses `var(--sapphBd)` for consistency.

Net effect: on desktop the three cards now read as gold / sapphire / teal at a glance; on mobile the swipeable carousel keeps the same three-tone treatment with matching badge/CTA colors per card.

---

## [2026-05-03] — Investor deck vF — domain switched to www.aurumprism.com

Updated `Aurum Prism Investor Deck vF.pdf.html`: slide 10 banner CTA `href` repointed from `theaurumcc.com/interest` → `www.aurumprism.com`. Visible domain line on the banner and the slide-10 footer ("TACC Pte Ltd · Singapore · …") both updated to `www.aurumprism.com`. PDF regenerated (363 KB).

---

## [2026-05-03] — Investor deck v1-classic — vF (final) (`prism-presentation/investor/v1-classic/index-vF.html`, `aurum-prism-investor-v1-classic-vF.pdf`)

Promoted v4 to vF. HTML copied verbatim to `index-vF.html`. PDF rendered via headless Chrome (`--print-to-pdf-no-header --no-margins`) using the deck's built-in `@page 16in 9in` print rules. Output: 363 KB, 10 slides, native 16:9 sizing. Banner CTA on slide 10 remains live and clickable in HTML viewer; in the PDF the link is preserved as a hyperlink to `theaurumcc.com/interest`.

---

## [2026-05-03] — Investor deck v1-classic — v4 review pass (`prism-presentation/investor/v1-classic/index-v4classic.html`)

Second-round operator review of v3. Saved as v4 for review (v3 preserved). HTML-only.

- **Slide 7** — Hex labels still bled at 11pt. Diagram scaled up further (`width 82% → 94%`, `max-height 66vh → 74vh`, stage gap 3vh → 2.4vh). All 6 outer hex labels dropped 11 → 10pt with letter-spacing 2 → 1.8 and tightened second-line offsets (KYC&/ACCREDITATION 34/50 → 34/48; SUBSCRIPTION/DOCS 30/46 → 30/44; CAPITAL/CALLS 26/42 → 26/40; STATEMENTS 32 → 30; TAX/REPORTING & AUDIT/TRAIL 26/42 → 26/40). Slide-3 boardroom labels left at 11 (operator only flagged hex bleed).
- **Slide 8** — Card grid shrunk: width 100% → 86% (centered), gap 2vh → 1.8vh, card padding 2.2vh/1.4vw → 1.9vh/1.2vw. Added `margin-bottom:5vh` between grid and disclaimer; disclaimer `bottom 2.85vh → 1.6vh` so footnote sits cleanly between cards and pagenum with proper breathing room.
- **Slide 10** — Reservation card and CTA button merged into a single sophisticated clickable banner (`<a class="seat-banner">`):
  - One bordered panel with subtle gold gradient top/bottom hairlines (linear-gradient with center brightness).
  - Eyebrow "By Invitation" → italic Cormorant headline "A seat on the register." → soft gold-divider hairline → "Request Introduction →" CTA → fine "theaurumcc.com / interest" domain line.
  - Hover: 2px lift, soft gold inner-glow + outer shadow, arrow translates right 0.6vw (350ms ease).
  - Whole banner is a single `<a href="https://www.theaurumcc.com/interest" target="_blank">` — clickable surface area is the entire panel, opens in new tab.
  - Slide section-level eyebrow/headline reworded ("The next step" / "Admission is by invitation.") to avoid duplicating the banner copy.
  - Removed the separate `.reservation`, `.res-name`, `.res-lbl`, and `.cta` styles; replaced with `.seat-banner`, `.seat-eyebrow`, `.seat-title`, `.seat-divider`, `.seat-cta`, `.seat-domain`. Prism SVG sized down 22vh → 20vh and now sits independently above the banner (no longer wrapped in the `<a>`).

Files: `index-v4classic.html` (~52 KB). PDF not regenerated. URL still points at `theaurumcc.com/interest` — confirm if it should switch to `aurumprism.com/...` sign-up.

---

## [2026-05-03] — Investor deck v1-classic — v3 review pass (`prism-presentation/investor/v1-classic/index-v3classic.html`)

Operator review of `index-v2classic.html`. Saved as v3 for review (v2 preserved). HTML-only fixes; no PDF regen yet.

- **Slide 4** — "ONE SUBSCRIPTION · MASTER FUND" was hanging across the drop-line below the master-fund circle. Moved label above the circle (y=26, font-size 9 → 13, letter-spacing 2.6 → 3.2). Circle shifted down to cy=78 so the drop-line connects cleanly into the deal rail at y=148.
- **Slide 7** — Honeycomb scaled up: `.s7 svg width 64% → 82%`, `max-height 54vh → 66vh`. Center hex Aurum/PRISM bumped (Cormorant 20 → 26, Mono 10 → 12). All 6 outer hex labels enlarged (Mono 8 → 11, letter-spacing 1.6 → 2) with second-line y-offsets widened by 2px on each pair so two-line labels (KYC & ACCREDITATION, SUBSCRIPTION DOCS, CAPITAL CALLS, TAX REPORTING, AUDIT TRAIL) don't run together. Note: the same font-size bump cascaded to Slide 3 boardroom seat labels (PENSION, SOVEREIGN, etc.) — reads cleaner there too.
- **Slide 9** — YOU and OTHER MEMBERS labels were below their circles at y=95, intersecting the connector lines down to the master-fund rectangle. Moved labels above each circle (y=22). Circles shifted down to cy=62. Connector lines re-anchored to circle bottoms (y=84 / y=80). YOU label bumped Mono 10 → 12.
- **Slide 10** — Replaced the small flat-triangle prism with the slide-1 prism SVG (full prism + inbound beam + 3 diverging gold rays + halo) for visual consistency with the cover. Container resized `8vw/8vw → 22vh/22vh`, opacity `.8 → .92`. New IDs (s10prismInner, s10faceL, s10faceR, s10ray, s10soft) to avoid collision with slide-1 defs.

Files: `index-v3classic.html` (~50 KB). PDF not regenerated — awaiting operator sign-off on HTML.

---

## [2026-05-02] — Investor deck v3-cinematic — formatting fix pass (`prism-presentation/investor/v3-cinematic/index-v2.html`)

Operator flagged v3-cinematic as "a mess." Audit found content invisible on most slides plus collision/overflow defects across all 10. Fixed in `index-v2.html` (original `index.html` preserved). New PDF: `aurum-prism-investor-v3-cinematic-v2.pdf` (1.96 MB). v2 HTML 45 KB.

Root cause of universal blank slides: the entry `fadeIn` animation used `animation-fill-mode:both`, which holds the `from{opacity:0}` state when the animation hasn't completed before render (PDF export, headless capture). Removed the entry-fade rule entirely — decorative looping animations (prismRotate, pulseSoft, lightDrift, shimmer) retained because they don't gate visibility.

Defects fixed per slide:
- **Global** — `.slide` padding bumped from `4.5vh 6vw` to `7vh 6vw 6vh` so wordmark (top) and pagenum (bottom) clear content. Wordmark moved up to `top:2.6vh`. Headline `clamp(56px,7.6vw,140px)` reduced to `clamp(48px,6vw,110px)` and `line-height:.98 → 1.02` to prevent oversized italics from breaking and clipping.
- **Slide I** — cover-prism shrunk (`38vw/680px → 28vw/480px`) and stage `gap:5vh → 2.5vh` so prism, headline, gold-rule and TACC footer all fit; pagenum no longer clipped.
- **Slide III** — boardroom SVG `max-height:62vh → 58vh` and `max-width:1100px;margin:0 auto`; YOU seat no longer overlaps the III/X pagenum.
- **Slide VI** — `.tick-day` got `white-space:nowrap`; "DAY 14" no longer wraps and overlaps the active gold tick.
- **Slide VII** — honeycomb sized `width:min(56vw,700px); height:min(70vh,640px)` with proper aspect; bottom hex (Statements) no longer overlaps the central pulsing pill, all 6 outer hexes clearly spaced. `.launch-pill` `bottom:5.5vh → 8vh` to clear pagenum below.
- **Slide VIII** — `.deal-pict` shrunk (`13vw/220px → 11vw/170px`) and moved inward (`right:-1vw → right:1vw`) so background pictograms no longer bleed past card borders. Added `pointer-events:none`. Illustrative-foot got `margin-bottom:2vh` to clear pagenum.
- **Slide IX** — struct SVG `viewBox` widened from `0 0 540 640` to `0 0 700 640` so the right-side mono labels ("ADMIN & COMPLIANCE") aren't truncated past the SVG canvas.
- **Slide X** — `.reservation` background opacity raised `rgba(10,9,8,.6) → .96` so the dark prism shape behind no longer bleeds through and reads as a smudge in the card.
- **QA tooling** — added `?only=N` query-param script that hides all but slide N; lets headless captures verify each slide individually without `vh` units exploding under tall full-page screenshots.

---

## [2026-05-02] — Investor deck v2-editorial — formatting fix pass (`prism-presentation/investor/v2-editorial/index-v2.html`)

Operator flagged v2-editorial as "a mess." Audit found visible layout defects across all 10 slides; fixed in `index-v2.html` (original `index.html` preserved for compare). New PDF: `aurum-prism-investor-v2-editorial-v2.pdf` (574 KB). v2 HTML 43 KB.

Defects fixed:
- **Global `.inner`** — added `padding-bottom:3vw` and `min-height:0` so SVG content cannot bleed under the absolutely-positioned foot rule (root cause of slide-7 badge collision and slide-10 pill collision).
- **Slide 2** — marg "The investor receives the press release..." was anchored at `top:30vh` and overflowed the right edge; repositioned to sit cleanly below the institution doc stack (`left:50%;margin-left:18vw;top:60%;max-width:14vw`).
- **Slide 3** — boardroom seat label "FUND OF FUNDS" was clipped to "ND OF FUNDS" because text-anchor=end at x=74 went off the SVG canvas. Widened viewBox from `0 0 900 420` to `-50 0 1000 420`; full label now visible.
- **Slide 4** — "ONE SUBSCRIPTION / MASTER FUND" text overflowed the master-fund circle (r=38 too small). Enlarged radius to 55 and re-centered text; vertical drop line shortened accordingly.
- **Slide 6** — italic "Hesitation is a pass" footline collided with the gold foot rule. Added `margin-bottom:3vw` to `.speed .footline`.
- **Slide 7** — honeycomb completely broken: side hexagons rendered as wedges/triangles because polygon coordinates were wrong (LEFT hex was a degenerate quad, neighbours misaligned). Rebuilt all 6 surrounding hexes with correct pointy-top geometry around center (450,200) r=70, neighbours at proper √3·r horizontal and 1.5·r vertical offsets. Connector dashed lines removed (the new tessellation makes them redundant). Badge `Deals Active · Platform Launching Soon` given `margin-bottom:3vw`.
- **Slide 8** — card `.countdown` ("IOI · 6 DAYS") was bottom-right absolute and overlapped the `CLOSE` stage label. Moved to top-right (`top:1.1vw;right:1.1vw`). Disclaimer `margin-bottom:2vw` so it clears foot rule.
- **Slide 9** — right-margin labels "ADMIN & COMPLIANCE" and "ASSET ISOLATION" were clipped to "ADMIN & COMP" / "ASSET ISOLAT" because text at x=812 + 2.5em letter-spacing overran the 900-wide viewBox. Moved gold rule to x=745, labels to x=755, reduced letter-spacing to 2 and font-size to 8. All three labels now render in full.
- **Slide 10** — CTA pill "REQUEST INTRODUCTION → theaurumcc.com/interest" bled into the gold foot rule because `.next .inner` had no padding-bottom. Added `padding-bottom:3vw` to `.next .inner` (in addition to global inner padding).

Verified with full-deck PDF re-render at 16in×9in print mode and 110-dpi page screenshots; all 10 slides clean. Original `index.html` and `aurum-prism-investor-v2-editorial.pdf` left intact for diff.

---

## [2026-05-02] — Investor deck v1-classic — formatting fix pass (`prism-presentation/investor/v1-classic/index-v2.html`)

Operator flagged v1-classic as "a mess." Audit found six visible defects across the 10 slides; fixed in `index-v2.html` (original `index.html` preserved for compare). New PDF: `aurum-prism-investor-v1-classic-v2.pdf`.

Defects fixed:
- **All slides 2-9** — `AURUM | PRISM` watermark (top:3.2vh) collided with the gold eyebrow (which started at slide padding 4.2vh). Increased slide top padding to 7vh; eyebrow now sits cleanly below the watermark.
- **Slide 2** — `you-card` used `margin:auto 0` which centered it vertically while the institution stack started at top, leaving them visually unrelated. Changed to `margin-top:1vh` so the card aligns with the top of the stack.
- **Slide 8** — `.disc` disclaimer ran the full slide width and overlapped the `08 / 10` page number on the right. Narrowed to `left:18vw / right:18vw` and lifted by ~0.25vh.
- **Slide 9** — three issues: (1) `YOU` connector started at x=395 but the YOU circle was at x=380, leaving a visible 15px detachment; realigned both YOU circle and connector to x=360. (2) `OTHER MEMBERS` text-anchor middle at x=450 overlapped the `YOU` label cluster; moved its circle/label to x=500 and its dashed connector to match. (3) Right-margin gold rule + labels at x=820/836 with text "ADMIN & COMPLIANCE" / "ASSET ISOLATION" ran past the SVG viewBox edge, getting clipped at "ADMIN & COMP" / "ASSET ISOLAT"; pulled rule to x=770 and labels to x=784, tightened letter-spacing to 2.

S1 padding override added (`padding-top:4.2vh`) so the cover hero spacing isn't disturbed by the new global top padding.



10-slide HNW investor presentation built in three parallel design treatments so the operator can pick. All three share locked copy (cover hook: *"The room you were never shown."*) and the same 10-slide content (cover · access gap · introducing · how it works · deal room · speed · institutional rails · 4 sample pre-IPO growth-equity cards · fund structure · CTA). Slide 8 features 4 illustrative deal cards inspired by Figure AI / SpaceX / Anthropic / Shield AI (Helios / Aurora / Lighthouse / Sentinel) — categorical fields only, no $/IRR/MOIC. Slide 7 carries pre-launch posture ("DEALS ACTIVE · PLATFORM LAUNCHING SOON"). Slide 10 CTA links to `theaurumcc.com/interest`.

- `v1-classic/` — black + gold, boardroom restraint, crisp diagrams. (47 KB HTML, 526 KB PDF)
- `v2-editorial/` — parchment + ink, FT weekend / Coutts memorandum feel, prospectus-style typesetting. (44 KB HTML, 582 KB PDF)
- `v3-cinematic/` — luxury brand film, oversized italic Cormorant, single-image storytelling, subtle web animations killed in print. (46 KB HTML, 2.4 MB PDF)

PDFs generated via headless Chrome at native 16×9 (`@page size: 16in 9in`). All HTMLs are self-contained — single file, inline SVG, only Google Fonts external.

---

## [2026-05-02] — Favicon on portal pages (`investor-portal.html`, `admin-portal.html`, `advisor-portal.html`)

The three portal HTMLs were missing a `<link rel="icon">`, so browser tabs showed the default globe instead of the gold "Au" mark. Added the same inline-SVG favicon used by the TACC site (`aurum-website/index.html`) and the existing Prism `index.html`/`login.html` so every page in the platform has the consistent gold-on-black `Au` favicon.

---

## [2026-05-02] — Investor lobby mobile: prism-centered hero, deal grid below (`investor-portal.html`)

Reworked the mobile lobby to mirror the advisor portal's mobile dashboard hero: a centered prism with the personalized greeting underneath and clean empty space above and below — no featured deal card crammed into the same fold.

- `.lobby-hero` now uses `justify-content:center` and fills the full viewport-minus-nav, so the prism + greeting are vertically centered with breathing room above and below.
- `.hero-visual` no longer claims `46svh`; sized to its content so the flex centering distributes the empty space evenly.
- `.hero-content` (featured deal eyebrow / name / tagline / stats / CTAs) is hidden on mobile, along with the carousel `.hero-dots`, the thin `.hero-sub-bar-wrap`, and the `.urgency-badge` — all of which were what made the previous fold feel cramped.
- Scroll chevron repositioned inside the hero (bottom: 20px) so it sits above the fold rather than below it.
- `initLobby()` now includes the featured deal in the `Other Opportunities` grid on mobile (`window.matchMedia('(max-width:768px)')`) and renames the section to `Opportunities` so the featured deal remains reachable from the deal grid below the fold. Desktop behavior is unchanged.

---

## [2026-05-02] — Advisor application backend (`api/v2.js`, `api/_lib/email.js`)

Companion to the @ui advisor tier on the landing page. The shared `?resource=inst&op=register` endpoint now accepts `category: 'advisor'` and routes those submissions to a dedicated KV bucket so the operator can review them as a distinct queue without polluting the institutional investor pipeline.

- **`api/v2.js`** — `inst&op=register` branches on `category`. Advisor branch validates `name, email, firm, jurisdiction, deal_types` (accepts the shared landing-form names `contact_name`/`firm_name` as fallbacks for `name`/`firm`; accepts `firm_url` as fallback for `website`), email-format checks, writes to `advisor_application:{id}` and indexes into the `advisor_applications:index` sorted set scored by epoch ms. Existing institutional/HNW path untouched. Same per-IP rate limit (10 / 15 min) applies.
- **`api/_lib/email.js`** — new `sendAdvisorApplication(application)` template. Two emails per submission: (1) operator alert to `NOTIFY_EMAILS` with subject `[Advisor application] {name} · {firm}` listing every advisor field plus the application ID; (2) applicant ack — brief private-bank-register confirmation noting operator review within five business days, referencing the application ID.
- **TODO (follow-up)** — admin portal review surface for `advisor_application:*` records (approve / reject / convert-to-advisor flow). For now the data lives in KV and the operator gets the email alert.

No new env vars. Reuses existing `NOTIFY_EMAILS` and `RESEND_API_KEY`.

---

## [2026-05-02] — Advisor tier + form de-duplication (`index.html`)

Approved mockup `mockup-tiers-form.html` ported into the live landing page. Adds a third advisor tier card and rebuilds the application form's left column as category-reactive copy.

- **Third tier card added** — sage/teal-tinted "DEAL ADVISORS" card alongside Institutional and HNW. New CSS hooks: `.tier.tier-adv`, `.tier-cta.adv`, plus `--teal`, `--tealBd`, `--tealBdS`, `--tealW` tokens added to `:root`. Desktop grid `.tiers-grid` switched from `1fr 1fr` to `1fr 1fr 1fr`. Mobile carousel extended with `.tiers-grid > .tier.tier-adv:nth-child(3)` tinting (sage gradient, teal border, sage watermark) — pagination dots auto-render from the new third button (existing JS already keyed off `dots.length`).
- **Section header updated** — "Two ways to access" → "Three ways to access". Sec-sub copy extended to mention "or as a deal advisor."
- **Duplicate qualification bullets stripped** — removed the four `.crit` rows in the form's left column that repeated tier-card copy. Replaced with reactive `<div class="next-list">` that swaps three short mono lines per category (Operator review · Mandate fit / Membership / Track record · NDA / Admission / Sourcing seat).
- **Reactive H2 + paragraph** — `#access-label`, `#access-h2`, `#access-p` now swap per category (institutional / private / advisor). The "existing members → /login" line moved to a discreet `.access-foot` row beneath the next-list.
- **Advisor radio + reactive form fields** — third pill "Advisor" added next to Institutional / HNW. New `#f-adv-block` with Jurisdiction, Firm Website / LinkedIn (single field), Deal Types Sourced, Recent Representative Deal (textarea). When advisor is selected, `#f-cap-block` (institution type / capacity / asset focus) is hidden. Body class `cat-advisor`/`cat-hnw`/`cat-institutional` toggled for any future CSS hooks.
- **`setApplyCategory()` extended** — now drives label/H2/paragraph/title/firm-label swaps, populates the next-list, and toggles the advisor field block. `APPLY_COPY` constant centralizes all per-category strings.
- **`submitForm()` extended** — when category is `'advisor'`, posts `category:'advisor'`, `firm_url`, `jurisdiction`, `deal_types`, `recent_deal` to the same `/api/v2?resource=inst&op=register` endpoint (backend extension routes advisor submissions). Validation gates on all advisor fields. Institutional / HNW flows unchanged.
- **Textarea styling** — extended the existing `input,select` rule to include `textarea` (with `resize:vertical`) so the new Recent Representative Deal field matches the rest of the form visually.

---

## [2026-05-02] — Mobile landing polish v5 — tier cards swipe carousel (`index.html`)

Two flat black tier cards stacked vertically read as dull and identical on mobile. Operator brief: convert to swipeable carousel with pagination dots, differentiate the two cards visually, restrained tone (private bank, not casino). Mobile only, desktop untouched.

- **Carousel via CSS scroll-snap** — inside `@media (max-width:768px)`, `.tiers-grid` switches to `display:flex` with `overflow-x:auto`, `scroll-snap-type:x mandatory`, `scroll-behavior:smooth`, hidden scrollbar. Cards become `flex:0 0 calc(100% - 40px)` with `scroll-snap-align:center`. Negative horizontal margin (`margin:48px -20px 0`) + matching `padding:8px 20px 4px` lets cards bleed to the edge while the section's 20px padding stays intact — no horizontal page overflow.
- **Pagination dots** — added `<div class="tiers-dots">` with two `<button class="tiers-dot">` elements after `.tiers-grid` inside `#access`. Gold (`var(--gold)` active, `rgba(197,165,114,.22)` inactive), 6×6px, scaled 1.4× when active. Hidden on desktop via `@media (min-width:769px){.tiers-dots{display:none}}`.
- **~15 lines of vanilla JS** at the end of the script tag — IIFE that watches `.tiers-grid` scroll position (debounced 40ms), computes active card index from `scrollLeft / clientWidth`, toggles `.on` on the matching dot. Dots are also click-targets (`scrollTo({left:k*clientWidth,behavior:'smooth'})`). No-op on desktop because the grid never gets `overflow-x:auto`.
- **Card differentiation (mobile only, via `:nth-child` inside the ≤768px block)**:
  - Card 1 (Institutional): `linear-gradient(180deg,rgba(212,175,99,.07),rgba(0,0,0,.42))`, gold border `rgba(197,165,114,.42)` — warmer, slightly more visible than baseline.
  - Card 2 (HNW & Private): `linear-gradient(180deg,rgba(120,140,200,.07),rgba(0,0,0,.42))`, blue-violet border `rgba(120,140,200,.32)`, badge recolored `#8da4d8` to match the tint. Pill stays subtle.
  - Watermark `§` recolored on each card to match its tint at 7% alpha. Subtle gradients only — no glow, no shadow burst.
- **Selectors used**: `.tiers-grid` (parent), `.tier` (cards), `.tier-cta-card`, `.tier-watermark`, `.tier-badge.inst`. New: `.tiers-dots`, `.tiers-dot`, `.tiers-dot.on`. No existing class names changed; desktop tier styling at lines 219–243 is fully preserved.
- Verified at 390×844: one card per viewport, ~20px gold/blue rim of next card peeks at the right edge as a swipe affordance, snap-to-center is solid, dots track scroll position, no horizontal overflow on `<html>`/`<body>`, CTAs inside cards remain tappable (44px min-height already enforced).

---

## [2026-05-02] — Mobile landing polish v4 — hero copy + prism position (`index.html`)

Two operator tweaks following v3, mobile-only.

- **Copy fix** — replaced "register" with "platform" in `.hero-sub-mobile`. New line: *"A private platform for institutional investors and the advisors bringing them deals — credit, equity, real estate, infrastructure."* "Register" was reading too transactional; "platform" matches how operator/advisors describe Prism in conversation.
- **Prism artwork anchored lower** — on ≤768px, added `align-items:flex-end!important` to `.hero-right` and `margin-top:48px` to `.hp-prism-wrap`. Previously the SVG sat high in its pane right under the hero text; now it pushes down toward the bottom of the hero-right pane, anchoring the second screen visually instead of floating mid-air. Existing `padding:24px 24px 56px` keeps a comfortable bottom gap so nothing overflows.
- Desktop layout untouched — both changes scoped inside `@media (max-width:768px)` blocks (and the copy edit lives only in `.hero-sub-mobile`, which is `display:none` on desktop).

---

## [2026-05-02] — Mobile landing polish v3 — hero copy (`index.html`)

Operator feedback after v2: the "NOW ACCEPTING APPLICATIONS · EARLY ACCESS OPEN" pill and the long descriptive sub paragraph were too startup-pitch for the first screen. Tightened to a private-bank statement; mobile-only, desktop untouched.

- **Eyebrow pill hidden on mobile** — `.hero-label{display:none!important}` inside the ≤768px media query. Desktop still shows the pulsing amber pill.
- **Hero sub paragraph rewritten for mobile** — added a parallel `<p class="hero-sub-mobile">` element. Desktop hides it (`display:none` baseline); mobile hides the original `.hero-sub` and shows the new one. Copy: *"A private register for institutional investors and the advisors bringing them deals — credit, equity, real estate, infrastructure."* No "Aurum Prism" repeat, no "platform", no geography. Statement form, not description.
- **Mobile sub styling** — Cormorant 18px, 300 weight, italic, `--sub` color, line-height 1.55, max-width 34ch so it wraps cleanly to two lines on 390px.
- **First-screen render verified on iPhone 14 (390×844)**: nav (Member Login only) → AURUM | PRISM wordmark eyebrow → headline → new italic statement, all above the fold; pill gone, no hero CTA; comfortable breathing room.

---

## [2026-05-02] — Mobile landing polish v2 (`index.html`)

Operator review on iPhone 14 (390×844) flagged Member Login pill too loud, nav touching the notch, redundant second nav row, and "AURUM | PRISM" wordmark clipped at left edge. All fixes scoped to mobile media queries; desktop untouched.

- **Member Login pill** shrunk from 11px / 44px-min to 10px / 38px height, padding 8px×12px, transparent background, muted gold (`--goldD`) — reads as a quiet utility link, no longer competes with content as a primary CTA.
- **Notched safe-area** fixed: `nav` `padding-top: calc(env(safe-area-inset-top) + 10px)` plus 8px bottom padding so the pill never kisses the viewport top, and the nav has visible breathing room on regular mobile too.
- **Second nav row removed** on ≤768px — `.n-links` (Platform / Access Tiers) hidden entirely. Single-row nav: wordmark + Member Login only.
- **Hero left padding** increased from 24px to 28px and top from 64px to 96px so the 32px italic-ish "AURUM | PRISM" wordmark has clear margin on both sides and sits below the nav with air before the eyebrow pill (compression below the wordmark preserved from v1).
- Added a guard rule in `(max-width:768px) and (hover:none) and (pointer:coarse)` so the global 44px tap-target floor on `.btn-nav` doesn't override the new 38px Member Login height.

## [2026-05-02] — Mobile landing page polish (`index.html`)

Tone target: private bank register, not SaaS funnel. All changes scoped to `@media (max-width:768px)` / `≤640px`. Desktop untouched.

**Top nav (mobile):**
- Removed the gold "Request Access →" pill on ≤640px (was the awful banner CTA).
- Re-surfaced "Member Login" (previously `display:none` at ≤640px) — bumped to 11px / .14em / 44px tap target, gold border, gold text.
- `padding-top:env(safe-area-inset-top)` on `<nav>` for notched iPhones.
- Row-2 nav links bumped from 8px / 40px → 9px / 44px height.

**Hero rhythm:**
- Compressed top space above the PRISM wordmark (88px → 64px top).
- Compressed bottom space below it more aggressively (48px → 28px bottom; eyebrow / label / h1 / sub / ctas margins all tightened).
- Killed the dead full-viewport second pane on mobile: `.hero-right` no longer claims `100svh`; prism scaled down to ~240px.

**CTA reduction (mobile body only):**
- Hidden: hero `Request Institutional Access →` button.
- Hidden: hero `Member Login →` button (already in top nav — no need to repeat).
- Hidden: hero-note tagline ("Returning investors log in directly · Institutions apply below").
- Kept: the two tier-card CTAs (institutional / private — these ARE the apply mechanism), and the final form `Submit Application →`.

**Quick wins:**
- Toast font 8px → 12px, padding 10/20 → 12/22.
- `.form-row` (1fr 1fr) → single column on mobile.
- `.foot-bottom` flex row → stacked column on mobile.
- `a.tier-cta` gets the 44px min-height tap-target treatment.

Files: `index.html` (added mobile-only block at end of `<style>`, no desktop rules touched).

---

## ★ [2026-05-02] — **PRISM PLATFORM v3 — Official Release** ★

Tagged `v3.0` (commit `22d1ddd`). Snapshot saved as `Prism Platform v3.zip`. Cumulative state on top of v2.0 baseline:

**Mobile-pass (Batches A+B+C, merged as v2.1-mobile):**
- 0 horizontal-overflow defects across 40 mobile audit captures (was 26 P0)
- All form inputs ≥16px on mobile (no iOS auto-zoom)
- Safe-area-inset for notched iPhones
- Demo badge translucent + pointer-events:none on all viewports

**Operator UX (v2.2-operator-ux):**
- Unified test credentials: `tkj@theaurumcc.com / 1234` (operator), `jwc@theaurumcc.com / 1234` (advisor + investor)
- Admin-supplied password / access-code overrides on `advisor:create` and `inst:approve`
- Admin View-As: one-click impersonation FAB on admin-portal

**v3 finishing touches (this session, after v2.2):**
- Desktop overflow fix on admin-portal `.ov-queue-grid` and `.ov-stage-lanes` (auto-fit minmax — pre-existing v2.0 bug now resolved)
- View Uploaded modal: shows 4 advisor-uploaded docs (NDA, Deck, Financials, Term Sheet) + structured fields
- Generate AI Profile button surfaced on 2 places (NEW DEALS card + Deal Studio card + inside View Uploaded modal footer)

**What v3 delivers vs v2:**
- Mobile parity: every portal renders cleanly on phone
- Operator can hop into advisor/investor views without logout/login
- Single set of test credentials across all roles (no more remembering Sarah)
- Desktop dashboard fits laptop viewports (1366-1920px) without bleeding
- View Uploaded gives operator clear visibility of what advisor submitted vs. AI-generated content

**Production:**
- Custom domain `www.aurumprism.com` live (HTTP 200)
- All 3 logins working, KV connected
- Rollback: `git checkout v2.0` reverts to pre-mobile baseline; `git checkout v2.2-operator-ux` to pre-v3-finish

Tag: `v3.0` @ commit `22d1ddd`. Snapshot: `Prism Platform v3.zip` (code only — excludes `.git`, `.claude`, `node_modules`, `.vercel`, prior zips, `mobile-audit/screenshots*`).

---

## [2026-05-02] — Admin overflow fix + View Uploaded / Generate AI Profile buttons

**Three changes to `admin-portal.html`:**

**1. Desktop overflow fix (pre-existing v2.0 bug, surfaced by operator).**
- `.ov-queue-grid` (NEW DEALS / READY TO PUBLISH / INBOUND IOI / OPERATIONS row) was hard-coded to `repeat(4, 1fr)` with the breakpoint to 2 cols only firing at ≤1100px. Effective rendered width was ~1806px regardless of viewport — caused 200-500px horizontal overflow on every laptop viewport between 1366-1880px. Replaced with `repeat(auto-fit, minmax(340px, 1fr))` so it auto-wraps to fit.
- Same fix on `.ov-stage-lanes` (Deal Pipeline 5-stage row): replaced `repeat(5, 1fr)` + 900px breakpoint with `repeat(auto-fit, minmax(200px, 1fr))`.
- **Important:** this overflow existed in v2.0 — not introduced by mobile-pass work. Mobile-pass rules are gated to `(max-width: 768px)` and were verified mathematically to not affect desktop CSS.

**2. "View Uploaded" button on NEW DEALS card and Deal Studio card.**
- New blue-bordered button next to the existing AI / Send-to-Advisor buttons.
- Opens a modal (`#vu-modal`) showing the original advisor submission: 4 document slots (NDA, Management Deck, Financials, Term Sheet) with view-doc buttons for each, plus structured fields (deal name, advisor, asset class, geography, target IRR, allocation, min ticket, submission date).
- Empty doc slots show as greyed "Not uploaded".

**3. "Generate AI Profile" button (rebranded existing `loadDocsAndGenerate`).**
- Gold-bordered button on NEW DEALS card. Same on Deal Studio card (rebranded from "Generate with AI →" to "Generate AI Profile →" for consistency).
- Also reachable from inside the View Uploaded modal as a footer CTA.

**Why:** operator wanted two surfaces to (a) see what the advisor actually uploaded vs. AI-generated content, and (b) trigger AI profile generation without bouncing through the AI tool view.

---

## [2026-05-02] — Admin View-As: operator can impersonate any advisor or investor

Operator-only QA tool. Floating "↪ View As" button (bottom-right of admin portal) opens a modal with two tabs (Advisors / Investors). Clicking any row sets a fresh session cookie for that user and opens their portal in a new tab. The operator's admin cookie stays intact in the original tab.

**Files modified:** `admin-portal.html` (added FAB + modal + JS at end of body), `api/v2.js` (two new admin ops).

**API:**
- `POST /api/v2?resource=admin&op=view-as-advisor` body `{advisor_id}` → sets `prism_advisor` cookie, returns advisor record
- `POST /api/v2?resource=admin&op=view-as-investor` body `{inst_id}` → sets `prism_inst` cookie, returns inst record (only works for `status:approved` investors)

Both ops are admin-gated (`getAdmin()` check). Tokens include `impersonated_by: <admin email>` claim for audit visibility.

**Why:** operator was bouncing between logout/login cycles to test advisor/investor views. With this, one click hops them into any user's session. Useful when running bot-driver to simulate multi-user flows.

---

## [2026-05-02] — Mobile-pass Batch C — investor-portal demo badge (desktop + mobile)

Operator-approved exception to the "no desktop changes" rule for one item: the `.demo-badge` "Investor Demo" pill on `investor-portal.html`. Was at full opacity on desktop and overlapping deal description text in narrower viewports.

**Change:** added `opacity:.55; pointer-events:none; backdrop-filter:blur(4px)` to the desktop base rule. The badge is now translucent with a soft blur behind it in all viewports — legible without obscuring scrolling content underneath. Mobile-only `@media(max-width:480px)` block already had these properties; this pulls them up to the desktop default for consistency.

**Files modified:** `investor-portal.html` (single line, base `.demo-badge` rule).

**Verification:** desktop visual hit at 1280/1440/1920 — badge still visible bottom-right but no longer dominant, deal text underneath remains readable through the blur.

---

## [2026-05-02] — Mobile-pass Batch B — overflow guards + missed pages

Continued on `mobile-pass` branch. After Batch A, re-audit revealed:
- **investor-portal**: residual 11-21px overflow caused by off-canvas `#view-deal` panel (positioned at left:100vw, scrollWidth picked it up)
- **forgot-password**: residual 5-20px overflow on `.box` element wider than viewport
- **reset-password.html / setup-password.html**: not touched in Batch A — same `.box` overflow pattern (24-30px)
- **login.html landscape**: paranoia gate `(hover: none) and (pointer: coarse)` not matching in some emulation paths, leaving 4 inputs <16px

**Files modified:** `investor-portal.html`, `forgot-password.html`, `reset-password.html` (new mobile block), `setup-password.html` (new mobile block), `login.html`.

**Approach:** split mobile rules into two gates:
- **Width-only `@media (max-width: 768px)`** for overflow guards, input font-size, and box constraints. Desktop is ≥1024px so width-only gate already excludes it; the paranoia gate was redundant for these rules and was preventing the rules from firing in landscape orientation.
- **Width + paranoia `@media (max-width: 768px) and (hover: none) and (pointer: coarse)`** kept only for safe-area-inset rules (genuinely touch-device-specific).

**Specific fixes:**
- Investor-portal: `#view-deal { max-width: 100vw }` + width-only overflow guards on html/body.
- Forgot-password / reset-password / setup-password: `.box { max-width: 100% !important; width: calc(100vw - 32px) !important; box-sizing: border-box; margin: auto }` so the centered card fits the viewport.
- Login: input font-size rule moved to width-only gate so landscape (667×375) gets it too.

**Verification:**
- Mobile audit re-run: 40/40 viewports show overflow=0 (was 26 P0 overflow defects pre-Batch-A).
- Desktop math at 1280/1440/1920: width gate `false`, paranoia gate `false`, computed input.fontSize unchanged (12px desktop / 16px mobile), html.overflowX unchanged from v2.0.

**Still remaining (deferred):**
- ~22 sub-44px tap targets on `index.html` (footer micro-copy at 9-11px — intentional v2 styling, would need careful selective bumps).
- 1 input <16px on login landscape (`#inv-code` has inline `style="font-size:13px"` that beats the stylesheet rule).
- Investor-portal "INVESTOR DEMO" badge overlap (RISKY, deferred).

---

## [2026-05-02] — Mobile-pass Batch A — surgical mobile fixes, desktop untouched

Branch: `mobile-pass` cut from `v2.0` tag (commit `a158aeb`). All changes are CSS-only additions, scoped behind `@media (max-width: 768px) and (hover: none) and (pointer: coarse)` — desktop CSS at ≥769px (and any non-touch device) is mathematically excluded.

**Files modified (5):** `index.html`, `login.html`, `forgot-password.html`, `investor-portal.html`, `advisor-portal.html`, `admin-portal.html`.

**Fixes shipped (Batch A, all SAFE):**
- **A1** Investor-portal horizontal overflow (22-25px on viewports 360-414) — added `overflow-x: hidden` on `html, body` + `max-width: 100vw` on `.nav` and `.dd-inner`.
- **A2** Tap targets bumped to ≥44px min-height on `.btn-nav, .n-link, .btn-primary, .btn-member` and inline IOI buttons in `index.html`.
- **A3** All form inputs `font-size: 16px` on mobile to kill iOS auto-zoom on focus (was 12px on index/forgot-password and 12-13px on login landscape).
- **A4** Safe-area-inset padding on body/nav for notched iPhones (iPhone 14, Pro Max).
- **A5** Forgot-password body width clamped to viewport (was rendering 400px on a 375 viewport).

**Skipped per operator decision:**
- Investor-portal "INVESTOR DEMO" badge overlap (RISKY — would touch desktop).
- Login secondary-button contrast (blue-on-black) — operator declined to touch dark/light theme.

**Verification (mathematically rigorous):**
- DOM-level test: at desktop widths (1280/1440/1920) `window.matchMedia('(max-width: 768px) and (hover: none) and (pointer: coarse)').matches === false` for every portal. Computed styles at desktop (input.fontSize, body.overflowX, body.padBottom) match v2.0 baseline byte-for-byte.
- DOM-level test at iPhone SE (375): MQ matches, inputs computed at 16px, overflow-x hidden, all gates fire correctly.
- Visual diff at 1280/1440/1920 against `v2.0`: byte-level PNG diffs are below the noise floor of Chromium animation re-rendering (verified by capturing the same v2.0 file twice).

**Files produced:**
- `MOBILE_AUDIT.md` (637 lines, full audit)
- `mobile-audit/screenshots/` (35 mobile captures)
- `mobile-audit/desktop-diff/` (desktop baseline + post-fix captures at 3 widths)
- `mobile-audit/run-audit.cjs`, `build-report.cjs`, `desktop-diff.cjs` (rerunnable harness)

---

## [2026-05-02] — Restored 4-concept hero graphic mockup file

- Restored 4-concept hero graphic mockup file (Liquid Mercury, Constellation, Monolith, Lifecycle Spectrum) at `prism-mockups.html` — previous Constellation Studies version replaced.
- Previous version was overwritten without backup, so this is a faithful rebuild from the original v3 concept descriptions: Liquid Mercury (feTurbulence + feDisplacementMap + goo filter, gold droplets into molten prism, wet jewel-tone spectrum exit), Constellation (vertex stars + shooting-star deals + drawn-by-light 7-ray jewel arc), Monolith (CSS preserve-3d rotating slab, white-gold front face / full jewel-spectrum back face, hover speeds rotation 16s→5s), Lifecycle Spectrum (seven sequentially-pulsing jewel slats labeled RAW→REALIZED with a luminous deal pip traversing via animateMotion).
- Constraints honored: pure black bg, gold #C5A572 / #E3C187 + jewel-tone spectrum, Cormorant Garamond italic + JetBrains Mono caps via Google Fonts, inline HTML/CSS/SVG only — no JS, no canvas, no WebGL, no external images. 2×2 grid desktop, stacked mobile, each panel ~620px tall with italic serif name + mono description + caption naming influence/technique.
- Not modified: `index.html`, `advisor-portal.html`, `investor-portal.html`.

---

## ★ [2026-05-02] — **PRISM PLATFORM v2 — Official Release** ★

Tagged `v2.0` (commit `54e9007`). Snapshot saved as `Prism Platform v2.zip`. Baseline state:

- **Bot Driver: 9 personas green** (Advisor, Admin, Investor, Applicant, Chaos, Auth, AdvReview, Concurrency, CapitalEvent) — all run clean against sandbox.
- **Sandbox audit: 0 issues** across 0 categories. No data anomalies, no log errors.
- **All 3 portals functional**: admin, advisor, investor — nav working, no JS errors in console.
- **Bug queue: empty.** Stage 1, 2, 3, 3.4b review fixes all shipped. P-1 through P-16 closed.
- **Launch documentation complete**: `LIVE_LAUNCH_PLAN.md`, `CUTOVER_ENV_VARS.md`, `PLATFORM_AUDIT.md`, `PLATFORM_RECOVERY.md`, `MANUAL_QA_CHECKLIST.md`, `BOT_DEBUG_LOG.md`, `verify-cutover.sh`.
- **What v2 delivers vs v1**: full Aurum Kilo scrub → Aurum Prism, two-tier signup gating (Institutional / HNW), atomic IOI counters, idempotent approve/publish, Redis cache layer + lean seed (token-safe), 9-persona bot harness, BOT_MODE for token-free QA, capital-call + distribution flows with per-investor notice records, Send-to-Advisor → advisor sign-off → auto-publish, comprehensive readiness checks on `/api/health`.

Next: Phase A3 manual QA on preview deployment with real keys, then Phase B cutover, then Phase C ops.

---

## [2026-05-02] — Critical: admin portal JS broken by duplicate `_distDealId`

`admin-portal.html`. Two distribution modals (admin "Issue Distribution" + advisor-style "Post Distribution") both declared `let _distDealId` at module top level → SyntaxError → all admin JS dead → `showView is not defined` cascade on every nav click. Renamed the second modal's vars and IDs to `_pd*` / `pd-*` so they no longer collide with the first. Verified zero remaining `_distDealId` duplicates and zero shared element IDs.

---

## [2026-05-02] — Stuck-deals false positive on seeded deals

`api/v2.js`. Sandbox audit's `stuck_deals` rule was flagging seed-only deals (DL-BOT0001/2/4/7) as abandoned because the only audit entries were from `system:bot-seed` with backdated timestamps > 30 days. Fix: ignore seed-actor entries when computing `lastTs`; require at least one non-seed audit entry before a deal can be flagged stuck. Now bot runs return zero findings on a fresh seed.

---

## [2026-05-02] — Platform audit + 4 dead endpoints wired (Stage 2)

`api/v2.js`, `api/_lib/bot-seed.js`, `admin-portal.html`, `CLAUDE.md`. Audit surfaced 4 frontend fetch URLs with no API handlers — every real user hitting them got 404s. Wired all four:
- `inst&op=nda-accept` — formal NDA acceptance with timestamp + document hash, enriches the existing `nda_signed:{instId}:{dealId}` record. Compliance audit trail now persists (was being silently dropped pre-fix).
- `inst&op=notices` — investor's own pending + acknowledged notices. Reads `notice:{investorId}:*`. Newest first.
- `inst&op=acknowledge-notice` — flips notice status to `acknowledged`. Idempotent.
- `advisor&op=earnings` — computes per-deal intro fees + projected carry from advisor's deals. Empty payments array until real disbursement system wired.

Capital-call-notify and distribution-notify extended to write per-investor notice records (with proper amount based on IOI / pro-rata share, reference number, deal name, type). Wipe patterns include `notice:*` and `payment:*`.

Cleanup: CLAUDE.md `/control` reference replaced with `/bot-driver` Reset (the actual seed mechanism). Admin portal nav got Bot Driver + Bot Viewer links for partner demos.

Full audit findings + 14 noted intentional gaps documented in `PLATFORM_AUDIT.md`. Commits: `cfba82f`, `0ebcfd3`, `a6e7508`.

---

## [2026-05-02] — Audit auto-heal reverted + read-side audit fix

`api/v2.js`. After P-6 atomic counters made counter drift impossible in normal operation, the audit's recalcIoiCounters self-heal became redundant — it would have hidden any future drift instead of surfacing it. Reverted to plain mismatch reporting. Removed the now-unused `recalcIoiCounters` import from v2.js (still exported as alias from deal-storage.js for any external caller).

Also fixed a read-side audit bug: sandbox-status and sandbox-summary were calling `kvGet('deal:{id}')` directly, returning the embedded `d.ioi_count` field. After P-6, embedded is fallback-only; atomic keys are source of truth. Audit was reading stale embedded field while atomic keys had real counts — declared lagged actual on every audit. Routed both audit dealId fetches through `getDeal()` so audit sees the same merged values that customer reads see.

Stuck-deals rule rewritten: previous 60s window flagged normal pipeline backpressure as "stuck." New 30-day threshold only flags truly abandoned deals. Severity dropped to 'low'. Commits: `b1edb58`, `713f336`.

---

## [2026-05-02] — B-12: Admin display polish

`admin-portal.html`. IRR rounding (`+irr.toFixed(1)+%`) so bot-randomized templates don't show 14 decimals. NaNd → `—` when closing_date null. Double-bullet `From X · ·` separator dedup. IOI row name fallback chain (`investor_firm || investor_email || investor_id || 'Investor'`). adaptDeal IOI rows now read `ioi.geo || ioi.geography` instead of hardcoded `—`, and date computation guards against null `submitted_at`. Render-only — no API or data-shape changes. Commit: `caa7921`.

---

## [2026-05-02] — P-6: atomic IOI counters (race fix)

`api/_lib/deal-storage.js`, `api/v2.js`, `api/_lib/bot-seed.js`. Replaced the read-modify-write `recalcIoiCounters(dealId)` on the IOI hot path with atomic INCRBY against dedicated keys `deal:{id}:ioi_count` and `deal:{id}:ioi_agg_usd` via new `bumpIoiCounters(dealId, dCount, dAggUsd)`. Two concurrent IOI submissions on the same deal can no longer drift the counter via last-write-wins (verified open by ConcurrencyBot stress tests). `getDeal` and `listDeals` now read the atomic keys and merge them into the returned object, falling back to the embedded `deal.ioi_count` for legacy records that haven't bumped yet. `recalcIoiCounters` kept as a back-compat alias delegating to a new `reconcileIoiCounters` (overwrites atomic keys from live IOIs) — only audit/heal endpoints still call it. Bot seed now writes atomic keys in addition to embedded fields, and `wipeAll` patterns updated to clear them. Five hot-path call sites migrated: ioi-create (+1 / +amt), reject-ioi (-1 / -amt if was non-rejected), delete-investor cleanup (-1 / -amt per non-rejected IOI), approve-ioi and respond-package (no counter change — call removed). Each bumped path also busts `cache:iois:all`.

---

## [2026-05-02] — Advisor deck: cover divider removed

Removed `.cover-divider` hairline from slide 1 — it was rendering across "SINGAPORE" in the cover-meta line because it overlapped with the absolute-positioned meta block. Cover-title margin restored to 64px to preserve spacing.

---

## [2026-05-02] — Advisor deck: slide 5 tile cleanup + cover dash fix

Slide 5 tightened: removed all geographic labels (Singapore/HK/Tokyo/Seoul/Taipei/Gulf), consolidated tiles to six distinct institutional categories (Family Offices, Fund-of-Funds, Sovereign & Quasi-Sovereign, Endowments & Foundations, Insurance & Pension, Corporate Treasuries) — no repeated category names, no marks. Lede shortened. Eyebrow simplified to "Institutional · mandate-driven." Headline tightened to "Built for a cohort we know."

Cover slide: removed the stray "entering light ray" SVG line on the left of the prism glyph (was reading as a floating dash near the eyebrow). Refracted exit rays kept inside the SVG bounds.

---

## [2026-05-02] — Advisor deck: slide 5 reframe (no track-record claim)

Slide 5 (Capital base) reworded. Removed "active investor directory" framing — platform is launching, no on-platform track record to claim. New headline: "Built for an institutional cohort we know." New lede positions the platform as extending the principals' prior private-market dealmaking history into a structured, attributable channel, calibrated for the LP profile transacted with across Asia-Pacific and the Gulf. Tile structure unchanged — they now read as category sketches of the cohort the platform is built for.

---

## [2026-05-02] — Advisor deck: cover slide rebuild

Slide 1 (Cover) rebuilt — previous lockup was rendering off-slide, leaving the cover blank. Replaced with: large 148px prism glyph (refraction-ray treatment), AURUM | PRISM wordmark at 64px with gold rule, "Private Deal Platform · By Introduction Only" tag, hairline divider, "Deal Advisor Briefing" italic subtitle, "TACC Pte Ltd · Singapore · 2026" pinned to bottom. Removed broken corner-bracket frame and the near-invisible background prism mark.

---

## [2026-05-02] — Advisor deck: cover lockup, Asia-weighted capital base, portal screenshot mocks

Revised `prism-presentation/advisor-deck.html`:
- Slide 1 (Cover): replaced thin wordmark with a framed Aurum|Prism logo lockup (hairline corner brackets, prism glyph, "A TACC Platform · Singapore" eyebrow, "Private Deal Platform · By Introduction Only" undertag) — now the dominant cover element.
- Slide 5 (Capital base): replaced Boston/New York/North America tiles with Asia-weighted set (Family Office Singapore + Hong Kong, Fund-of-Funds Tokyo, Sovereign GCC/Gulf, Endowment Seoul, Corporate Treasury Taipei). Eyebrow + lede reframed as "Asia-Pacific weighted · mandate-matched · on-platform" with selective Gulf and global allocator language.
- Slides 7 & 8: wrapped both in a browser-chrome frame (traffic-light dots, `prism.theaurumcc.com/advisor` URL bar, logged-in user chip) plus a portal nav bar (Aurum|Prism wordmark, Dashboard/My Deals/Submit/Investors tabs).
- Slide 7 expanded into a four-step wizard rail (Identity → Terms → Documents → Review), AI completeness chip, richer materials tray with file rows, save-draft + continue actions, AI operator note panel.
- Slide 8 substantially expanded: 4 deal-switcher pills, stage-journey ribbon (Submit→Close), content tabs row (Overview · IOIs · Data Room · Activity · Settings), 3 IOI cards (Singapore, Tokyo, Seoul) with mandate-match %, IOI count strip (3 IOIs · $18M · 7 matched), full activity feed, and a data-room access panel showing per-document access state.
- Updated slide 8 IOI #2 to read "Fund-of-Funds · Tokyo" (was New York) for capital-base consistency.

## [2026-05-02] — Deploy trigger: activate BOT_MODE env var

Empty-content commit to force a Vercel rebuild so the newly-added `BOT_MODE=1` and updated `ADMIN_USERS` environment variables take effect on the running deployment. No code change.

---

## [2026-05-02] — Bot-test sandbox frontend: bot-driver.html + bot-viewer.html

### `bot-driver.html` (new)
- Admin-gated SPA that drives three bot personas (AdvisorBot / AdminBot / InvestorBot) against the sandbox endpoints. Hero counters + stage breakdown auto-refresh every 1.5s from `admin/sandbox-status`. Control strip exposes Start/Pause/Reset/Run-Audit, a 1×/5×/25×/MAX speed toggle, and per-persona checkbox toggles. Live action log capped at 200 rows with red error rows, scroll-lock + jump-to-live pill. All bot fetches send `x-bot-mode:1`. Reset modal requires typing `WIPE ALL DATA` to enable the destructive button. Audit modal renders `sandbox-summary.issues` with severity chips and click-to-expand samples. Reuses the admin-portal focus-trap pattern with `role=dialog aria-modal=true`. Per-persona auto-pause after 50 consecutive errors.

### `bot-viewer.html` (new)
- Admin-gated read-only mirror. Same hero counters + stage bar component as the driver. Two-column Recent Deals (25) / Recent IOIs (25) panels and a 50-row audit log section. Top-right LIVE pill flips green/pulse on poll success and red on failure. Polls `admin/sandbox-status` every 1.5s.

---

## [2026-05-02] — Bot-test sandbox backend: BOT_MODE flag, high-volume seed, integrity audit

### `api/_lib/email.js`
- `send()` now short-circuits when `BOT_MODE === '1'`: logs `[BOT-MODE] email suppressed → {to} | {subject}` and returns `{ ok: true, suppressed: true }`. No Resend fetch. Production behavior with `BOT_MODE` unset is unchanged — full delivery + alert-on-failure path retained.

### `api/_lib/ai.js`
- `scoreDeal(deal)` returns a synthetic varied score when `BOT_MODE === '1'` — randomized completeness/plausibility scores, weighted recommended_action (60/30/10 publish/review/reject), 1-3 plausible flag strings. Skips the Anthropic call entirely. Off-state behavior unchanged.

### `api/_lib/storage.js` (new helper)
- `kvScanDel(pattern, batchSize)` — SCAN-based bulk delete that iterates with cursor until exhausted, batches DELs in groups of 50. Used by sandbox wipe; no KEYS in prod.

### `api/_lib/deal-templates.js` (new)
- 20 institutional deal shells across asset classes / geographies / structures. Names: Marquette Credit Fund III, Sterling Infrastructure Partners II, Whitmore Family Co-Invest IV, Ashford Real Estate Debt, Kingsbridge Capital Asia Pre-IPO, etc. `randomizeDeal(template, seed)` applies ±15% raise size, ±2pp IRR, varied min ticket, term ±12 months, vintage suffix. Field shape matches `createDeal`.

### `api/_lib/bot-seed.js` (new)
- `wipeAll()` — SCAN-deletes every key matching deal:*, ioi:*, ioi_exists:*, ioi_index, inst:*, inst_email:*, inst_code:*, advisor:*, advisor_email:*, audit:*, deals:index, nda_signed:*, statement:*, distribution:*, welcome_seq:*, compliance_flag:*, qa_pending:*, ratelimit:*, revoked:*, deal_doc:*, pdoc:*, pdoc_meta:*. Returns count removed. Idempotent.
- `seedBotAccounts()` — pinned bot users: advisor `bot-adv` / `bot.advisor@aurumprism.test` / `BotPass123!`; investor `bot-inv` / `bot.investor@aurumprism.test` / code `BOTCODE`. Admin login uses `ADMIN_USERS` env var.
- `seedHighVolume()` — 30 advisors with shared `TestPass123!`, 150 investors (100 institutional / 50 hnw, all approved with auto-generated codes), 400 deals (80 review, 100 live, 100 ioi, 60 dd, 30 terms, 20 close, 10 realized) randomized from templates, 2-8 IOIs per deal at live/ioi/dd/terms (mostly pending, ~30% approved, ~10% rejected). All deals indexed in `deals:index`, all IOIs in `ioi_index`, every state-changing action appended to `audit:{dealId}`. Promise.all batches of 25 to avoid Redis serial hammering.

### `api/v2.js`
- New helper `shouldBypassRateLimit(req)` — returns true ONLY when `BOT_MODE === '1'` AND request carries `x-bot-mode: 1` AND a valid `prism_admin` cookie verifies. Tightly scoped — production traffic without `BOT_MODE` set can never bypass.
- The three rate-limit gates (advisor login, advisor forgot-password, investor login) now defer to the bypass before incrementing.
- New admin ops in `resource=admin`:
  - `op=sandbox-reset` (POST, body `{ confirm: 'WIPE ALL DATA' }`) — wipeAll → seedBotAccounts → seedHighVolume. Returns counts.
  - `op=sandbox-status` (GET) — counts (deals/iois/advisors/investors with breakdowns), 25 most recent deals, 25 most recent IOIs, last 50 audit entries across recent deals.
  - `op=sandbox-summary` (GET) — integrity audit: orphan IOIs, IOIs without deal, stuck deals (no audit in 60s for live/ioi/dd), missing audit entries, ioi counter mismatches, approved-but-no-code investors. Returns `{ ok, issues: [...], summary }`.
- Existing `op=seed` left untouched.

### `CLAUDE.md`
- Added `BOT_MODE` to the env-var table.

---

## [2026-05-02] — Access Tiers: restore two-card layout, add HNW + Private category gating

### `index.html`
- Access Tiers section restored to two-card layout. `tiers-grid` style override that locked it to a single column removed (CSS default `1fr 1fr` now applies). Section header `Two ways · to access.` is no longer inconsistent with the body.
- **Card 1 — Institutional Investors** rewritten: dropped the legacy "& Private Clients" sub-line and refreshed body copy (family offices, fund of funds, PE secondaries, endowments, sovereign wealth, corporate treasuries — credit / pre-IPO equity / real estate / infrastructure across US and Asia). Bullet list unchanged.
- **Card 2 — HNW & Private Capital (new)**: HNW individuals and single-family principals; same deal flow, sized to private capacity; explicit "invitation-only and capped" exclusivity language. Bullets: $100K minimum (placeholder, confirm with operator), accredited investor, 5-business-day review, NDA on credentialing.
- Sub-line under the section heading rewritten — dropped "existing investors log in directly" line (login lives in the nav). Now reads as the access framing for new applicants only.
- **Apply form** got a required category selector at the top: pill-style `Institution` / `Private (HNW)` toggle. Card CTAs pre-select the matching pill via new `setApplyCategory(cat)` helper before scrolling. Form labels and the institution-type dropdown options swap based on category (institutional → fund / endowment / treasury types; HNW → SFO / MFO / trust / individual). For HNW applicants, firm name is optional and falls back to the contact name on submission.
- `submitForm()` blocks submission if no category is selected (toast + scroll back to the selector).

### `api/v2.js`
- `resource=inst&op=register` now requires `category` (`institutional` or `hnw`). Rejects with 400 if missing or invalid. Stored on the investor record as `inst.category`. Existing records without the field are left untouched and read as legacy (treat as `institutional` at display time if needed).

---

## [2026-05-02] — Aurum Prism rebrand cleanup: agents, CLAUDE.md, landing page perf

### `index.html`
- Restored from commit `5009ee2` (the last clean Aurum Prism · Private Deal Platform version). The Aurum Kilo / physical-gold-VCC copy that had been silently introduced by commit `9be214d` (whose message claimed only perf/a11y changes) is now gone. Title, meta description, hero, How It Works, footer, legal disclaimer all back to deal-platform copy.
- Re-applied the legitimate perf items from `9be214d`: added `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`; canvas particle count 80 → 40; `prefers-reduced-motion` gate on the canvas animation (single static draw for reduced-motion users; live `change` listener resumes animation if the OS setting is toggled mid-session).

### `CLAUDE.md`
- Platform 1 description rewritten — was "physical gold (1kg LBMA) + private credit, 100 founding members, Singapore VCC, Q3 2026 first close" (Aurum Kilo content under a Prism label); now reads as "invite-only deal-flow platform connecting deal advisors with institutional investors. Operated by TACC Pte Ltd, Singapore. Roles: operator (admin), advisor, investor. Lifecycle: review → live/ioi → dd → terms → close → realized/killed."

### `.claude/agents/*.md`
- All 6 agent definitions rewritten to fit the actual platform (Aurum Prism deal-flow, not the Aurum Kilo gold fund) and the actual stack (Vanilla JS HTML SPAs + Vercel Functions + Upstash Redis, not Next.js + Postgres + Prisma).
- `build.md` — stack corrected; routing pattern (single `api/v2.js` handler, `kv*` helpers, `appendAuditEntry`) called out so spawned agents extend rather than fork.
- `ui.md` — stack corrected; brand tokens corrected to actual values (`--gold:#C5A572`); cross-portal sync rule added.
- `connect.md` — Singapore Freeport / LBMA gold / bank credit-line integrations removed; replaced with the actual stub-until-env-var integrations (Resend, Upstash, Vercel Blob, DocuSign, Onfido, Sentry, Anthropic via AI Gateway).
- `review.md` — NAV/LTV critical-path replaced with auth, deal lifecycle, IOI integrity, cross-portal sync, email triggers.
- `strategy.md` — Aurum Century Club / The Kilo / gold-collateralized-credit context replaced with deal-flow platform context (US + Asia, family offices and sovereign funds).
- `write.md` — "Kilo deck" voice reference replaced with platform register guidance; explicit instruction to update both HTML and plaintext email templates.

---

## [2026-05-02] — Investor portal wordmark: failed-revert cleanup

### `investor-portal.html`
- Top-left brand block restored to match admin/advisor exactly. Eyebrow `TACC Pte Ltd · Singapore` → `A TACC Platform`. Brand name `Aurum | Kilo` → `Aurum | Prism`. Leftover from the reverted Aurum Kilo rebrand (`0d4c82b`). Wordmark CSS classes (`.nav-wordmark`, `.nav-wm-tacc`, `.nav-wm-name`, `.nav-wm-aurum`, `.nav-wm-rule`, `.nav-wm-prism`) are byte-identical across all three portals — no CSS change needed.
- Advisor portal wordmark already matched admin (no change).

---

## [2026-05-02] — Phase 5 frontend: performance, accessibility, and design token consolidation

### `advisor-portal.html`
- JSZip `<script>` tag changed to `defer` — eliminates blocking parse during page load; safe because JSZip is only invoked on user-triggered document download.

### `index.html`
- Added `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` to the existing googleapis preconnect pair.
- Canvas particle count halved from 80 to 40 — reduces GPU/CPU work per frame.
- Added `prefers-reduced-motion` support: animation loop is gated behind `window.matchMedia('(prefers-reduced-motion: reduce)')`. Reduced-motion users get a single static draw; full animation otherwise. A `change` event listener handles mid-session OS setting toggles.

### `login.html`
- Added both Google Fonts preconnect tags (`fonts.googleapis.com` + `fonts.gstatic.com crossorigin`) before the stylesheet link.

### `forgot-password.html`, `setup-password.html`, `reset-password.html`
- Added Google Fonts preconnect tags to each.
- Replaced all hardcoded colour and font literals with CSS custom properties (`--gold`, `--goldB`, `--goldD`, `--goldBd`, `--goldBdS`, `--goldW`, `--red`, `--redBd`, `--redW`, `--green`, `--greenBd`, `--greenW`, `--amber`, `--amberBd`, `--amberW`, `--wire`, `--muted`, `--text`, `--bg`, `--surface`, `--input-bg`, `--serif`, `--cond`, `--mono`). Token values match the `login.html` portal token set exactly. Layout unchanged.

### `admin-portal.html`, `advisor-portal.html`, `investor-portal.html`
- Added `role="dialog" aria-modal="true" aria-labelledby="..."` to every modal inner container: stage-modal, push-modal, push-preview-modal, close-raise-modal, delay-raise-modal, dist-modal (admin); review-notify-overlay (advisor); nda-modal (investor).
- Added `role="region" aria-labelledby="..."` and heading `id` attributes to notification panels in all three portals.
- Added a shared `trapFocus(modalEl)` utility function in each portal — captures the previously-focused element, intercepts Tab/Shift+Tab to cycle focus only within the modal's focusable elements, returns a `releaseFocus()` cleanup function.
- Each modal open function calls `trapFocus` and stores the releaser. Each modal close function calls the releaser and restores focus to the trigger element.
- Modals covered: all admin modals, advisor review-notify-overlay and notifications panel, investor NDA modal and notifications panel.

---

## [2026-05-02] — Phase 5 backend: API waterfall fix (advisor dashboard endpoint) + IOI index (eliminate Redis KEYS scans)

### `api/_lib/storage.js`
- Added `kvZrem(key, member)` — removes a member from a sorted set. Upstash `zrem` with in-memory fallback.

### `api/_lib/deal-storage.js`
- Imports `kvZrange`, `kvZrem` from storage.
- `recalcIoiCounters`: replaced `kvKeys('ioi:IOI-*')` O(N) scan with `kvZrange('ioi_index', 0, -1)` sorted-set read.
- `seedIois`: adds each seeded IOI to `ioi_index` via `kvZadd` so the index is populated from test data seed.

### `api/v2.js`
- Imports `kvZadd`, `kvZrem` from storage.
- Added `getAllIois()` inner helper — reads `ioi_index` sorted set, fetches all IOI records in parallel with `Promise.all`. Called by every operation that previously did `kvKeys('ioi:IOI-*')`.
- `marketplace/ioi` (IOI creation): calls `kvZadd('ioi_index', Date.now(), ioiId)` after `kvSet` to register each new IOI in the index.
- `admin/delete-investor`: calls `kvZrem('ioi_index', ioi.id)` alongside `kvDel` when deleting investor IOI records.
- **Replaced all 15+ `kvKeys('ioi:IOI-*')` call sites** with `getAllIois()`: `post-nav-update`, `post-distribution`, `getApprovedIoi`, `inst/distributions`, `inst/performance`, `admin/ioi-by-deal`, `admin/deal-detail`, `admin/push-preview`, `admin/push-package`, `admin/capital-call-notify`, `admin/distribution-notify`, `admin/match-investors`, `admin/compliance-cron`, `admin/generate-statements`, `admin/generate-statements-cron`, `marketplace/my-iois`, `marketplace/deal-iois`, `admin/delete-investor`.
- `admin/publish-deal`: replaced `kvKeys('deal:*')` scan (to clear featured flag) with `listDeals()` which already uses the `deals:index` sorted set. Uses `saveDeal` to persist changes so the index stays in sync.
- `admin/generate-statements-cron`: moved `getAllIois()` outside the per-deal loop — fetches once, filters per deal inside the loop.
- Added `advisor/dashboard` GET endpoint — returns `{ advisor, deals, stats }` in a single response. Fetches advisor profile and deal list in parallel via `Promise.all`. Computes `{ totalDeals, liveDeals, totalIois, totalAum }` server-side. Eliminates the need for separate sequential API calls on portal load.

### `advisor-portal.html`
- `load()`: changed initial data fetch from `op=me` to `op=dashboard`. Response shape is identical (`advisor`, `deals`) with the addition of `stats`. No changes to downstream rendering logic.

---

## [2026-05-02] — Phase 3 + Phase 4 frontend: AI score card, investor matching panel, priority approvals queue, NAV update UI, performance dashboard, distribution workflow

### Phase 3 Frontend — Admin Portal (`admin-portal.html`)

- **AI Analysis card** (`buildAIScoreCard`): added to deal detail right column. Shows Completeness and Plausibility scores as SVG arc-ring dials (Cormorant numeral, gold fill). Lists up to 3 flags per score in mono text. Renders operator brief in italic Cormorant. Recommended action shown as green/amber/red badge. "Re-score" button calls `POST /api/v2?resource=admin&op=rescore-deal`, shows spinner, refreshes panel on success. Shimmer + "Run Analysis" button when `aiScore` is null.
- **Investor Matches panel** (`loadInvestorMatches`): added below AI card in deal detail right column. Fetches `GET /api/v2?resource=admin&op=match-investors&dealId=X`. Displays ranked list with score bar (gold, proportional to 5), investor name/email, match-reason pills (green mono), amber "Has IOI" badge. Checkboxes wire to `window._matchSelected` object — logs to console on change (bulk-invite ready). Loading and empty states handled.
- **Priority Approvals Queue** (`renderOverview`): upgraded all four action-queue columns. Each card now shows: priority badge (HIGH/MEDIUM in red/amber with border), item-type icon, age label ("2h ago"), and AI brief excerpt for deal submissions. Deal submission cards get `pq-high-card` left-border accent (red). IOI decisions and push-ready cards get `pq-medium-card` (amber). Helper function `relAge()` derives human-readable age from timestamps.

### Phase 4 Frontend — Advisor Portal (`advisor-portal.html`)

- **NAV Update section**: injected at the bottom of the deal Overview tab (`renderOverview`). Form: NAV per unit, Total NAV (with comma-format helper `fmtNavInput`), as-of date (defaults today), optional notes. "Post Update" calls `POST /api/v2?resource=advisor&op=post-nav-update`. On success, pushes entry into `deal.navHistory` and re-renders tab immediately. NAV History table below the form (Date, NAV/unit, Total NAV, Notes) — sorted newest first. Loading, success, and error states handled.

### Phase 4 Frontend — Investor Portal (`investor-portal.html`)

- **Performance Dashboard**: added `ptab-positions-body` / `ptab-performance-body` sub-tab switcher to the portfolio view header. Performance tab fetches `GET /api/v2?resource=inst&op=performance`; falls back to mock data derived from `PORTFOLIO` + `DEALS`. Renders: 4 summary stat cards (Total Committed, Current Value, TVPI, Total Distributions). Per-deal table with Committed / Current Value / DPI / RVPI / TVPI / MOIC in JetBrains Mono tabular-nums — TVPI ≥ 1.0x in gold, < 1.0x in muted red. Distribution History accordion — expandable per deal, each row shows date, type badge (Income/Capital/Return of Capital), amount. Shimmer loading state and graceful empty state. Portfolio hero row updated: replaces "Confirmed Access" with Current Value + TVPI.

### Phase 4 Frontend — Admin Portal (`admin-portal.html`) — Distribution

- **Post Distribution modal** (`openDistModal`, `confirmPostDistribution`): "Post Distribution" button appears on deal detail for `close` / `realized` stage deals. Opens full distribution modal with: total amount, distribution type (Income/Capital/Return of Capital), date, notes. Per-investor preview table fetches IOIs via `GET /api/v2?resource=admin&op=deal-iois&dealId=X`, calculates proportional share client-side, shows each investor's amount in gold mono. Submit calls `POST /api/v2?resource=advisor&op=post-distribution`. Success shows confirmation toast and refreshes deal detail.

---

## [2026-05-02] — Phase 3 + Phase 4 backend: investor matching, compliance monitoring, NAV updates, quarterly statements, distribution workflow, performance metrics, welcome sequence

### Phase 3 — Intelligence + Compliance

- **Investor matching engine** (`api/v2.js`): New `resource=admin&op=match-investors&dealId=X` (GET, admin only). Fetches all investor records and scores each against a deal on five equal-weight factors: `asset_class` match against `preferred_asset_classes`, `geography` match against `preferred_geographies`, `investment_capacity >= min_ticket_usd`, no prior rejected IOI, and no existing IOI. Score is 0–5. Returns `{ dealId, matches: [{ investorId, name, email, score, matchReasons, alreadyHasIoi }] }` sorted descending. Missing investor preference fields score 0 for that factor — no crash.

- **Compliance monitoring cron** (`api/v2.js`, `vercel.json`): New `resource=admin&op=compliance-cron` endpoint (admin auth or `Authorization: Bearer {CRON_SECRET}`). Scans all `inst:inv-*` records; flags `compliance_review_needed` if KYC is pending/failed and `kycInitiatedAt` is >30 days ago; flags `nda_missing` if investor has active IOIs but `ndaSigned` is falsy; flags `access_expiring` if `accessCodeExpiry` is within 7 days. Writes each flag to `compliance_flag:{investorId}` with 32-day TTL. Returns `{ checked, flagged, flags }`. New read endpoint `resource=admin&op=compliance-flags` (GET) returns all current flag records. Cron scheduled monthly: `0 2 1 * *`.

### Phase 4 — Lifecycle + Reporting

- **NAV update mechanism** (`api/v2.js`, `api/_lib/email.js`): New `resource=advisor&op=post-nav-update` (POST, advisor must own deal). Body: `{ dealId, navPerUnit, totalNavUsd, asOfDate, notes }`. Appends to `deal.navHistory`, updates `deal.currentNav`, `deal.totalNavUsd`, `deal.navAsOf`. Appends to deal audit log (via `appendAuditEntry`). Emails all approved IOI holders with NAV details via new `sendNavUpdate` email template.

- **Quarterly statement generation** (`api/v2.js`, `api/_lib/email.js`): New `resource=admin&op=generate-statements&dealId=X` (POST, admin only). For each investor with approved IOI: builds statement record with period `Q[N] YEAR`, current NAV value (proportional to commitment / totalCommitment), all distributions, stores as `statement:{dealId}:{investorId}:{period}` in Redis, emails investor via new `sendStatementAvailable` template. New `resource=inst&op=statements` (GET, investor) returns all statements for the calling investor. New `resource=admin&op=statements&dealId=X` (GET, admin) returns all statements for a deal. New `resource=admin&op=generate-statements-cron` runs the same logic across all `live`, `dd`, `terms`, `close` stage deals (skips already-generated periods). Quarterly cron: `0 6 1 1,4,7,10 *`.

- **Distribution workflow** (`api/v2.js`, `api/_lib/email.js`): New `resource=advisor&op=post-distribution` (POST, advisor must own deal). Body: `{ dealId, totalDistributionUsd, distributionType, distributionDate, notes }`. Types: `income`, `capital`, `return_of_capital`. Calculates per-investor shares as `(ioi.amount / deal.totalCommitment) * totalDistributionUsd`. Stores `distribution:{dealId}:{distributionId}` with per-investor breakdown. Appends to `deal.distributionHistory` and audit log. Emails each investor their individual amount via new `sendDistributionNoticeWithAmount` template. New `resource=inst&op=distributions` (GET, investor) returns all distributions across all the investor's approved IOI deals with their individual amounts.

- **Performance metrics per investor** (`api/v2.js`): New `resource=inst&op=performance` (GET, investor only). For each approved IOI: calculates `DPI` (totalDistributed / committed), `RVPI` (currentValue / committed), `TVPI` (DPI + RVPI), `moic` (same as TVPI). `IRR` stubbed as `null`. Returns `{ positions: [{ dealId, dealName, committed, currentValue, dpi, rvpi, tvpi, moic, irr, distributions }], totalCommitted, totalCurrentValue, totalTvpi }`.

- **Investor welcome sequence** (`api/v2.js`, `api/_lib/email.js`): When `op=approve` sets an investor approved, writes `welcome_seq:{investorId}` JSON `{ approvedAt, day2Sent: false, day7Sent: false }` to Redis (no TTL). New `resource=admin&op=welcome-cron` (GET/POST, admin auth or CRON_SECRET) scans all `welcome_seq:*` keys; if `approvedAt` is >=2 days ago and `day2Sent` is false → sends Day 2 onboarding email; if >=7 days ago and `day7Sent` is false → sends Day 7 check-in email with current open deals. Day 7 is checked before Day 2 so both cannot fire on the same run. Updates sequence key after sending. New `sendWelcomeDay2` and `sendWelcomeDay7` email templates added to `api/_lib/email.js`. Daily cron: `0 8 * * *`.

- **Four new cron entries** (`vercel.json`): `compliance-cron` (monthly), `generate-statements-cron` (quarterly), `welcome-cron` (daily). All honour `Authorization: Bearer {CRON_SECRET}` as an alternative to admin cookie auth.

---

## [2026-05-02] — AI Gateway migration + deal scoring on submission

### AI Gateway (`api/_lib/ai.js` — new file)

- **Created `api/_lib/ai.js`** — centralised AI call helper. Exports `callAI(messages, opts)` and `scoreDeal(deal)`.
- **Gateway routing**: when `VERCEL_TEAM_ID` or `AI_GATEWAY_TEAM_ID` env var is present, all Anthropic calls are routed through `https://gateway.ai.vercel.app/v1/{teamId}/prism/anthropic/v1/messages`. Falls back to direct `https://api.anthropic.com/v1/messages` when no team ID is set, so local dev requires no extra config.
- Auth still uses `ANTHROPIC_API_KEY` in all cases — the gateway accepts the same key.

### AI generate refactor (`api/v2.js`)

- **`resource=admin&op=ai-generate`**: replaced the inline `fetch('https://api.anthropic.com/v1/messages', ...)` block with a call to `callAI(...)`. Behaviour unchanged; now routed through the gateway when configured. Added `extraHeaders` support so the `anthropic-beta: pdfs-2024-09-25` header is forwarded correctly.

### Deal scoring on submission (`api/v2.js`)

- After an advisor submits a new deal (`resource=advisor&op=deals` POST), a background AI scoring job fires via `scoreDeal(deal).then(...)`. The submission response is returned immediately — AI never blocks it.
- `scoreDeal` calls `claude-haiku-4-5-20251001` with a structured prompt covering: name, asset_class, geography, structure, deal_size, target_irr, target_multiple, hold_period, thesis, highlights, minimum_investment.
- AI returns: `completeness_score`, `completeness_flags`, `plausibility_score`, `plausibility_flags`, `operator_brief`, `recommended_action` (publish/review/reject), `risk_flags`.
- Result saved to `deal.aiScore` and `deal.aiScoredAt` on the deal record in Redis.
- On any AI failure, `deal.aiScore = null` and the error is logged to console — deal submission is never affected.

### Rescore endpoint (`api/v2.js`)

- **New `resource=admin&op=rescore-deal`** (POST, admin-only): re-runs AI scoring on demand for any deal. Accepts `{ dealId }`. Returns `{ ok, dealId, aiScore, aiScoredAt }`. Useful after a deal is edited or when the operator wants a fresh assessment.

---

## [2026-05-02] — Phase 1 + Phase 2 backend: token revocation, PDPA deletion, audit sorted set, KV alerting, email failure alerting, 7 new email triggers, Q&A routing, IOI counter integrity

### Phase 1 — Infrastructure

- **Token revocation denylist** (`api/_lib/auth.js`, `api/v2.js`): `signToken` now injects `jti: randomUUID()` into every JWT payload. On advisor logout (`op=logout`), the jti is written to `revoked:{jti}` with a 7-day TTL. On investor logout, same with 30-day TTL. All three `getAdmin`/`getAdvisor`/`getInst` auth helpers check `kvGet('revoked:' + payload.jti)` after signature verification — if the key exists, the request is treated as unauthenticated and the cookie is cleared. Replaying a stolen token after logout now returns 401.

- **PDPA investor deletion endpoint** (`api/v2.js`): New `resource=admin&op=delete-investor` (admin-only, POST). Accepts `investorId`. Deletes: `inst:{id}`, `inst_email:{email}`, `inst_code:{code}`, all `ioi:IOI-*` records where `investor_id` matches, all `ioi_exists:{dealId}:{investorId}` dedup keys, and all `nda_signed:{investorId}:*` records. Calls `recalcIoiCounters` on each affected deal. Returns `{ deleted: true, keysRemoved: N }`. Logs PDPA deletion to console for compliance trail.

- **Append-only audit sorted set** (`api/_lib/deal-storage.js`, `api/v2.js`): New `appendAuditEntry(dealId, entry)` helper writes each audit event to `audit:{dealId}` sorted set with `score = Date.now()`. Called from `createDeal`, `updateDeal`, `respond-package`, `capital-call-notify`, `distribution-notify`. New `resource=admin&op=audit-log&dealId=X` endpoint returns the full chronological log via `kvZrange`. Added `kvZadd` and `kvZrange` exports to `storage.js`.

- **KV fallback alerting** (`api/_lib/storage.js`): On first cold start without KV env vars, logs `[STORAGE] KV unavailable — using in-memory fallback. DATA WILL BE LOST ON RESTART.` via `console.error`. Module-level `kvUnavailable` flag exposed via `isKvUnavailable()`. Health check endpoint now returns `{ kv: "unavailable" }` instead of `"memory-fallback"` when KV is absent.

- **Resend failure alerting** (`api/_lib/email.js`): `send()` now checks response status. On non-2xx, fires a secondary alert to `NOTIFY_EMAILS` with subject `[Prism Alert] Email delivery failure` including recipient, template type, timestamp, and error message. Alert send is catch-safe — never throws. All existing `send()` calls updated to pass `templateType` as fourth argument for alert context.

### Phase 2 — Core Missing Features

- **7 new email triggers** (`api/_lib/email.js`, `api/v2.js`):
  - `sendIoiConfirmation` — sent to investor after IOI submission
  - `sendIoiRejection` — sent to investor when admin rejects IOI
  - `sendDataRoomPackageResponse` — sent to investors when advisor accepts pushed IOI package
  - `sendQaQuestionToAdvisor` — sent to deal advisor when investor submits Q&A question
  - `sendQaAnswerToInvestor` — sent to investor when advisor answers their question
  - `sendCapitalCallNotice` + `resource=admin&op=capital-call-notify` — admin triggers capital call email to all approved IOI holders for a deal (or specific `investorIds[]`)
  - `sendDistributionNotice` + `resource=admin&op=distribution-notify` — same pattern for distribution notices

- **Q&A 48h reminder system** (`api/v2.js`, `vercel.json`): On question submission, `qa_pending:{dealId}:{qaId}` is written to Redis with 48h TTL and `{ reminderSent: false }`. On answer, key is deleted immediately. New `resource=admin&op=qa-cron` handler scans pending keys >= 24h old, batches by deal, sends one `sendQaReminder` per deal (never more than one per question), then sets `reminderSent: true`. Wired to Vercel cron `0 9 * * *` (9am UTC daily) in `vercel.json`. Also callable directly by admin. Accepts `CRON_SECRET` bearer token for Vercel-initiated calls.

- **IOI counter integrity** (`api/_lib/deal-storage.js`, `api/v2.js`): Removed `kvIncrby(deal_ioi_count:*, 1)` and the manual deal object counter increments. Added `recalcIoiCounters(dealId)` which scans all `ioi:IOI-*` for the deal, counts and sums only non-rejected IOIs, and writes back to the deal object. Called after: IOI creation, IOI approval, IOI rejection, advisor package response. Single source of truth; no divergence possible.

---

## [2026-05-02] — External service integrations: four stubs (STUBBED — activate via env var)

### Changes

Four paid external service integrations wired in as env-var-gated stubs. All are inert
until the corresponding env var is set. No paid traffic, no npm installs required to run.

- **Vercel Blob (`api/_lib/blob-storage.js`)** — STUBBED  
  `uploadDocument()` and `getDocumentUrl()` added. When `BLOB_READ_WRITE_TOKEN` is absent,
  VDR file uploads continue to store base64 in Redis (existing behavior, 1 MB limit).
  When the token is present, files are uploaded to Vercel Blob and a URL is stored instead.
  `vdr-upload` and `vdr-file` endpoints in `api/v2.js` wired to use blob-storage helpers
  automatically. Activate: Vercel Dashboard > Storage > Blob > create store > copy token.

- **Sentry (`api/_lib/sentry.js`)** — STUBBED  
  `captureException()` and `captureMessage()` added using the Sentry HTTP envelope API
  (no npm install — plain fetch). When `SENTRY_DSN` is absent, errors and key events log
  to console only. `api/v2.js` top-level handler now wrapped in try/catch that calls
  `captureException` on unhandled errors. `captureMessage` fires at three decision points:
  deal published, IOI created, investor approved. Activate: sentry.io > Project Settings > DSN.

- **DocuSign (`api/_lib/docusign.js`)** — STUBBED  
  `sendSubscriptionDocument()` and `checkEnvelopeStatus()` added. When
  `DOCUSIGN_ACCESS_TOKEN` + `DOCUSIGN_ACCOUNT_ID` are absent, calls log a stub message and
  return `{ stubbed: true }`. Two new admin endpoints added to `api/v2.js`:
  `resource=admin&op=send-subscription-doc` (sends envelope, stores `deal.subscriptionEnvelopeId`)
  and `resource=admin&op=check-subscription-status` (polls DocuSign, sets `deal.subscriptionSigned`).
  Activate: developers.docusign.com > JWT Grant auth > set env vars.

- **KYC/AML (`api/_lib/kyc.js`)** — STUBBED  
  `initiateKycCheck()` and `getKycStatus()` added. Supports Onfido (default) and Persona
  via `KYC_PROVIDER` env var. When `KYC_PROVIDER_API_KEY` is absent, returns
  `{ stubbed: true, checkId: 'stub-<investorId>', status: 'pending' }`. `api/v2.js`
  `admin&op=approve` now calls `initiateKycCheck` after approval (non-fatal — investor
  approval completes even if KYC call fails). Stores `inst.kycCheckId` and `inst.kycStatus`
  on the investor record. New `resource=admin&op=kyc-status` endpoint polls current status.
  Activate: onfido.com or withpersona.com > set `KYC_PROVIDER_API_KEY` + `KYC_PROVIDER`.

### Files changed
- `api/v2.js` — imports + handler wrapper + 3 captureMessage calls + blob wiring + DocuSign/KYC endpoints
- `api/_lib/blob-storage.js` — new file
- `api/_lib/sentry.js` — new file
- `api/_lib/docusign.js` — new file
- `api/_lib/kyc.js` — new file

---

## [2026-05-02] — Phase 2 frontend additions: Earnings view, NDA modal, Capital Call notices

### Changes

**`advisor-portal.html` — Earnings tab**
- Added "Earnings" nav tab as fourth top-level view (`view-earnings`).
- Summary hero card: total estimated earnings in gold JetBrains Mono; three stat cards for intro fees, projected carry, and cash received to date.
- Intro fee table: Deal | Status | Intro Fee % | Deal Size | Estimated Fee — shimmer loading state, empty state, error state handled.
- Carry table: same structure with Carry % | Projected Gain | Projected Carry columns.
- Payment history list: icon, deal name, type (intro/carry), amount, status badge (Paid / Processing / Pending).
- Fetches `GET /api/v2?resource=advisor&op=earnings`. If endpoint not yet live or returns null, gracefully falls back to local `DEALS` array as placeholder skeleton with `—` for unset fee values. If API returns an error object, shows inline error banner without breaking the page.
- `showView` extended (non-destructive wrapper) to call `loadEarnings()` on first visit to the Earnings tab; subsequent visits skip re-fetch.

**`investor-portal.html` — NDA modal with scroll-gate**
- Replaced bare checkbox NDA gate with a "Review & Sign NDA" button that opens a full-screen modal.
- Modal contains a scrollable `<div>` with full NDA placeholder text (8 clauses); the "I have read and agree" checkbox and Sign button are locked until the investor scrolls within 40px of the bottom.
- On sign: captures `{ timestamp, documentHash, investorId }` and posts to `POST /api/v2?resource=inst&op=nda-accept` (fire-and-forget, does not block UI). Sets `ndaSigned[dealId] = true`, closes modal, refreshes deal view.
- Already-signed state: shows "NDA Signed" green badge in place of the gate.
- Legacy `signNda()` function retained for backward compatibility with any direct callers; wired to the same `ndaSigned` map.

**`investor-portal.html` — Notices section**
- Added "Notices" nav tab as third top-level view (`view-notices`).
- Capital call notices: gold warning-triangle SVG icon, amber left-border, "PENDING" badge.
- Distribution notices: green checkmark SVG icon, green left-border.
- Each card: title, date issued, amount, expandable detail panel (wire instructions placeholder, reference number, due date, notes).
- "Acknowledge Notice" button posts to `POST /api/v2?resource=inst&op=acknowledge-notice` with `{ noticeId }`. On success, badge flips to "Acknowledged" in-place, pending count badge on nav tab decrements.
- Fetches `GET /api/v2?resource=inst&op=notices`. Endpoint not yet live: falls back to empty state ("No pending notices"). Shimmer loading rows shown during fetch.
- Pending notice count badge appears on the Notices nav tab when there are unacknowledged items.

---

## [2026-05-02] — Stored XSS remediation: Q&A thread and deal fields

### Changes

- **`esc()` sanitizer added to both portals** (`advisor-portal.html`, `investor-portal.html`): Added `function esc(str)` that creates a temporary DOM text node, assigns the value via `textContent`, and returns the resulting `innerHTML` — the browser's own HTML encoder. This produces safe output for all five special HTML characters (`&`, `<`, `>`, `"`, `'`).

- **Q&A thread rendering hardened** (`advisor-portal.html`): All six user-data interpolations in the Q&A chat builder are now wrapped in `esc()`: `q.message`, `q.question`, `q.askedBy`, `q.askedAt`, `q.answer`, `q.answeredBy`/`q.answeredAt`. A `<script>` or `<img onerror=...>` payload submitted by an investor now renders as visible literal text in the advisor browser.

- **Q&A onclick attribute injection closed** (`advisor-portal.html`): The `onclick="setQaReplyCtx('${q.id}','${q.askedBy}')"` pattern allowed an investor to break out of the string literal and inject arbitrary JS. Replaced with `onclick="setQaReplyCtx(this)"` and `data-qaid`/`data-askedby` attributes (whose values are HTML-escaped). `setQaReplyCtx` updated to read from `el.dataset` instead of inline string arguments.

- **Q&A thread rendering hardened** (`investor-portal.html`): Same six fields wrapped in `esc()` — `q.message`, `q.sentBy`, `q.sentAt`, `q.question`, `q.askedAt`, `q.answer`, `q.answeredBy`, `q.answeredAt`.

- **Deal name and free-text fields hardened in advisor portal** (`advisor-portal.html`): `d.name` escaped in deal switcher pills, deal detail panel, both PDV preview modals (listing + report), review/edit display, and dashboard deal cards. `d.geography`, `d.structure`, `d.tagline`, `d.thesis`, highlight `icon`/`title`/`body`, activity log `a.text`/`a.time`/`a.dealName` all wrapped in `esc()`.

- **Deal name and free-text fields hardened in investor portal** (`investor-portal.html`): `d.name` escaped in IOI confirmation, deal grid cards, deal detail header, NDA consent text, portfolio list, closing instructions overlay (including sub-fund name). `d.geography`, `d.structure`, `d.thesis`, highlight fields, and `p.submitted` all wrapped in `esc()`.

- **Backend confirmed clean** (`api/v2.js`): Q&A `question`, `answer`, and `message` fields are stored as plain text via `.trim()` only — no pre-encoding at storage time. XSS prevention is applied exclusively at render time in the browser, which is the correct architecture.

---

## [2026-05-02] — Phase 0 security hardening (8 fixes, api/v2.js)

### Changes

- **Rate limiting on auth endpoints** (`api/v2.js`): Added `checkRateLimit(ip)` helper using Redis INCR + EXPIRE pattern (key `ratelimit:auth:{ip}`, 15-minute window, 10-attempt cap). Applied to advisor login, investor login, and advisor forgot-password. Returns HTTP 429 `{ error: "Too many attempts. Try again later." }` when limit exceeded. IP extracted from `x-forwarded-for` (Vercel standard).

- **TACC feed hard-fail when secret absent** (`api/v2.js`): `op=tacc-feed` now returns HTTP 503 `{ error: "Feed not configured" }` immediately if `PRISM_TACC_BRIDGE_SECRET` env var is missing or empty. Previously served live deal data to any caller when the env var was unset.

- **deal-docs and ai-generate admin-only enforcement** (`api/v2.js`): Both `op=deal-docs` and `op=ai-generate` previously called `verifyToken(getCookie(req, 'prism_admin'))` which would pass for any valid JWT regardless of role. Replaced with `getAdmin()` which additionally checks `payload.role === 'admin'`. Returns HTTP 403 if caller is not an admin.

- **advisor-confirm-deal ownership check** (`api/v2.js`): `op=advisor-confirm-deal` now verifies `deal.advisor_id === adv.advisor_id` after fetching the deal. Returns HTTP 403 if the authenticated advisor does not own the deal. Previously any advisor JWT could edit any deal's financial terms.

- **IOI dedup race condition fixed** (`api/v2.js`): Replaced check-then-set pattern with atomic `kvSetnx` (SET NX). If `kvSetnx` returns 0 (key already existed), returns HTTP 409 `{ error: "IOI already submitted" }`. The redundant `kvSet(dedupKey, 'pending')` after IOI record creation removed. Existing approved-IOI check retained as a fast-path for the common case.

- **Auto-seed removed from all production code paths** (`api/v2.js`): Removed four auto-seed call sites: `advisor/me`, `advisor/deals` GET, `deals/marketplace`, and `deals` admin GET (the `deals.length < 8` auto-heal). Seed data (`sarah@capitalgroup.sg`, `jwc@theaurumcc.com`, etc.) can now only be loaded via the explicit admin `op=seed` endpoint. Cold starts return empty state rather than seeding production credentials automatically.

- **Password minimum length 12 characters** (`api/v2.js`): `op=setup-password` and `op=reset-password` now reject passwords shorter than 12 characters with HTTP 400 `{ error: "Password must be at least 12 characters." }`. Previous minimum was 1 character.

- **CORS origin restriction** (`api/v2.js`): `Access-Control-Allow-Origin` now set to `process.env.SITE_URL` instead of being absent (which defaulted to wildcard in some configurations). Added `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` headers. Preflight OPTIONS handling preserved. Falls back to no ACAO header if `SITE_URL` is unset (safe — browser will block cross-origin requests).

---

## [2026-05-02] — Security headers: HSTS, CSP, X-Frame-Options DENY, Permissions-Policy

### Changes
- `vercel.json`: Added `Strict-Transport-Security: max-age=31536000; includeSubDomains` to all routes — enforces HTTPS for 1 year including subdomains
- `vercel.json`: Added `Content-Security-Policy` to all routes — restricts resource loading to same-origin plus Google Fonts (style/font only), permits `unsafe-inline` for scripts and styles (required by vanilla JS/CSS inline architecture), blocks framing via `frame-ancestors 'none'`, locks `base-uri` and `form-action` to same origin
- `vercel.json`: Changed `X-Frame-Options` from `SAMEORIGIN` to `DENY` — investment platform has no legitimate same-origin iframe use case; DENY is the stricter correct value
- `vercel.json`: Retained existing `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()` — all carried forward from prior config, no changes

---

## [2026-05-01] — Landing page mobile: Deals + Capital corner labels on prism

### Changes
- `index.html`: Added "Deals" (bottom-left vertex, blue) and "Capital" (bottom-right vertex, gold) labels inside the prism SVG. Labels use Cormorant Garamond italic for the word + JetBrains Mono for sub-label (INFLOW / MATCHED). Each has a dashed connector line from the triangle vertex and a pulsing animated dot. Hidden on desktop via `.hp-corner-label{display:none}`, shown on mobile (`≤900px`). SVG viewBox extended from 320→342 to accommodate label rows.

---

## [2026-05-01] — Landing page: show prism diagram on mobile hero

### Changes
- `index.html`: On mobile (≤900px), unhid the `.hero-right` prism section which was `display:none`. Each pane (text/CTA + prism) now fills one full viewport (`min-height:100svh`) so the stats section below stays off-screen until scrolled. Side labels ("Deals flow in" / "Capital flows out") hidden on mobile. Prism centered at `min(300px,80%)` width with ambient glow backdrop.

---

## [2026-05-01] — Fix admin portal mobile nav light mode

### Changes
- `admin-portal.html`: Added `[data-theme="light"]` overrides for the luxury mobile nav block (`@media(max-width:768px)`) — nav and tab row were hardcoded `rgba(10,9,8,1)` dark with `!important`, overriding CSS vars even in light mode. Light overrides restore cream gradient nav, correct tab row tint, and dark-on-light text colors

---

## [2026-05-01] — Fix hero section light mode on investor + advisor portals

### Changes
- `investor-portal.html`: Added `[data-theme="light"]` overrides for `.lobby-hero` — was hardcoded `background:#0A0908` (dark only). Light mode now shows cream gradient `#F5F3EF → #EFECE6` with adapted gold glow and subtle dark grid lines
- `advisor-portal.html`: Added comprehensive `[data-theme="light"]` overrides for the entire hardcoded dark hero CSS block — covers `.dhs-headline`, `.dhs-tagline`, `.dhs-stat-val/lbl/div`, `.dhs-sub-bar-track`, `.dhs-ring-pct/sub/detail`, `#dhs-ring-target`, `#dhs-ring-investors`, `.dhs-btn-ghost`, `.dhs-social`, `.dhs-visual`, and the SVG ring track stroke — all now use CSS vars that respond to theme

---

## [2026-05-01] — Fix notifications across all portals + investor light mode

### Changes
- `admin-portal.html`: Fixed notification panel `position:absolute` → `position:fixed;top:calc(var(--nav-h)+8px);right:20px;z-index:1000` — panel was rendering off-screen (100vh below fold) because it lives outside the nav with no positioned ancestor
- `advisor-portal.html`: Same notification panel position fix
- `investor-portal.html`: Added missing `#notif-backdrop` div — clicking outside panel now closes it
- `investor-portal.html`: Updated `closeNotifPanel`/`toggleNotifPanel` to show/hide backdrop
- `investor-portal.html`: Added mobile notif panel override (`left:12px;right:12px;width:auto` at <480px)
- `investor-portal.html`: Fixed light mode — nav was hardcoded `rgba(10,9,8,.92)`, now `var(--bg)` with `[data-theme="dark"]` override matching admin pattern
- `investor-portal.html`: Fixed `.inv-ring-row`, `.ring-detail-card`, `.inv-deal-ring` — converted from hardcoded dark `rgba(13,12,10,.85)` to CSS vars with dark theme overrides
- `investor-portal.html`: Added `transition:background .3s,color .3s` to body for smooth theme switching

---

## [2026-05-01] — Fix admin dashboard IOI + DD column card overlap

### Changes
- `admin-portal.html`: Added `flex-shrink:0;overflow:hidden` to `.ov-action-card` — root cause of overlap was flex container shrinking cards below content height
- `admin-portal.html`: Removed conflicting FIX 3 CSS (`min-height:80px`, `-webkit-line-clamp`) that fought with other overrides
- `admin-portal.html`: Rebuilt DD card % panel from `position:absolute` to flex sidebar — more reliable containment, no overflow bleed
- `admin-portal.html`: Removed duplicate `.ov-ac-name` CAT F override that conflicted with base rule

---

## [2026-05-01] — Critical bug fixes: setup-password redirect, broadcast Q&A, Indicated labels + TESTING_PLAN.md

### Changes
- `setup-password.html`: Fixed post-setup redirect from `/advisor` (404) → `/advisor-portal`
- `api/v2.js`: Fixed broadcast Q&A always returning 400 — added broadcast code path in `answer-qa` handler that routes `{broadcast:true, message}` separately from standard `{qaId, answer}` path
- `investor-portal.html`: "Subscribed" → "Indicated" for ring label and deal card bar sub-text (IOIs are non-binding indications, not subscriptions); also fixed broken closing tag from prior sed run
- `TESTING_PLAN.md`: Created from scratch — 26 scenarios across public/advisor/investor/admin/API flows, Node.js bot runner, autocannon pressure test protocol, pre-launch checklist

---

## [2026-05-01] — Production visual audit: typography floor, copy, mobile polish, brand consistency

### Changes
- `login.html`: Added missing `--muted` and `--text` CSS variables to `:root` (were undefined, causing invisible "A TACC Platform" subtext). Raised all sub-11px font sizes to minimum 9–11px: panel eyebrows (6.5→9px), labels (6.5→9px), sub-descriptions (7.5→11px), note/error/forgot text (7–8→11px). Demo bar text raised from 7/6.5px to 10px. Operator bar desc raised to 11px. Session banner text/buttons raised to 11px with proper 36px min-height touch targets. `<l-tab>` gets `min-height:44px` for mobile tap target compliance. Forgot-success message raised from 8px to 11px.
- `index.html`: All sub-11px label/eyebrow/footer copy raised to 9–11px: form labels, section eyebrows, stat labels, tier items, access criteria, footer links, legal copy, nav links, nav tag, hero eyebrow, hero note, feature titles, CTA labels. Staging URL `prism-plum.vercel.app` replaced with production domain `prism.theaurumcc.com` in both portal showcase chrome bars.
- `advisor-portal.html`: Nav "A TACC Platform" subtext raised from 6px to 8px. Nav placeholder `—` removed from user name (was visible pre-auth). Sign out button raised from 9px to 11px with proper min-height.
- `investor-portal.html`: Nav `ntab` font-size unified with advisor/admin (13→12px, weight 400→500). "A TACC Platform" subtext raised from 6px to 8px. Hardcoded mock user "James Hartwell / JH" removed from nav HTML (was visible before JS auth replaced it). Sign out button raised from 9px to 11px.
- `admin-portal.html`: "A TACC Platform" subtext raised from 6px to 8px. Role badge label corrected from "Admin" to "Operator" (consistent with product terminology). Sign out button raised from 9px to 11px.

---

## [2026-05-01] — Animated welcome hero: prism illustration + entrance animations

### Changes
- `advisor-portal.html` + `investor-portal.html`: Full hero animation overhaul applied to both portals.
- Prism SVG boost: fill gradient opacity raised from ~0.035 to 0.18, outline stroke from 0.10 to 0.26, incoming beam opacity from 0.07–0.18 to 0.14–0.40. Added left/right face polygons with separate gradients for 3D depth. Spectrum rays brightened to near-full opacity with vivid hue values.
- `prismEnter` keyframe: prism scales in from 0.88 + 24px translateY on page load, then transitions into the continuous `prismRotate` drop-shadow pulse.
- `beamPulse`, `raySpectrum`, `vertexGlow`, `particleDrift`, `breatheGlow` all boosted — animations were previously at sub-perceptible opacity levels.
- Ambient background glow: two radial gradients on `::before` pseudo-element (left-weighted gold) animate on a 4s `ambientPulse` loop. Grid texture on `::after` at 1.8% opacity, 60px repeating.
- Staggered greeting entrance: greeting words injected as individual `<span>` elements with incremental `animation-delay`, name rendered in gold with extra 140ms stagger.
- KPI counter animation: `requestAnimationFrame` count-up on numeric stats (deals count, investor count, target IRR, term). Stat rows also stagger in with `statReveal`.
- Prism visible on mobile: removed `display:none` on `.dhs-visual` / `.hero-visual` at ≤768px. Compact 200px prism shown above text content on mobile. Ring float card hidden to keep mobile clean.

---

## [2026-05-01] — 6-issue mobile audit fixes across index + admin portals

### Changes
- `index.html`: Removed "Existing Investors" tier card entirely. Renamed remaining badge to "Institutional Investors & Private Clients". Single card centered with max-width:600px.
- `admin-portal.html`: Removed repetitive "X actions require your attention" inline text from Overview header (bell badge already shows count).
- `admin-portal.html`: Notification panel rebuilt as proper floating popup — `position:fixed` at nav bottom, semi-transparent backdrop (`#notif-backdrop`) inserted via JS, `z-index:800`, slide-down animation. Tapping backdrop closes panel.
- `admin-portal.html`: Mobile nav redesigned — gold gradient bar, active tabs with gold fill + glow, `AURUM` wordmark in gold, role badge with gold border, cleaner tab spacing and color contrast.
- `admin-portal.html`: KPI strip tightened on mobile — smaller font clamp, tighter padding, label text ellipsis.
- Full mobile audit run — confirmed `tl-inner` timeline, `ci-wire-table`, and `lr-deal-name` already have mobile overrides.

---

## [2026-05-01] — Advisor hero top-align + index.html portal showcase spacing

### Changes
- `advisor-portal.html`: Mobile hero now anchors prism SVG visual at top (order:1) and text content below it (order:2, justify-content:flex-start). Eliminates floating text in empty black hero. Ring float card hidden on mobile to declutter.
- `index.html`: Portal showcase gap increased to clamp(48px,7vh,80px) on mobile — portals breathe. `.pw-viewport` pointer-events:none + touch-action:pan-y removes scroll trap so page can scroll freely.

---

## [2026-05-01] — Admin portal: four targeted mobile fixes (Cat H, I, J, L)

### Changes
- `admin-portal.html`: Four targeted fixes applied — CSS + JS additions only. No auth, nav, or desktop layout touched.
- **Cat H — KPI strip odd-item full-width**: Added `@media(max-width:640px){ .kpi-card:last-child:nth-child(odd){ grid-column: 1 / -1; } }` so a lone 5th KPI card spans both columns instead of leaving a blank gap.
- **Cat I — Collapsible overview sections**: Added `.ov-collapsible` CSS, `toggleOvSection()` JS helper, and rewrapped the 4 overview sections (Action Queue, Deal Pipeline, Team Access, Activity) in collapsible containers. On mobile (≤768px) each section header is a tappable row — sections start collapsed. On desktop (≥769px) headers are hidden and all sections are always expanded.
- **Cat J — Equal-height deal cards**: Added `min-height:80px` on `.ov-action-card`; clamped `.ov-ac-name` to 2 lines with `-webkit-line-clamp:2` and `min-height:2.4em`; set `.ov-ac-meta` to single-line ellipsis at 10px. Same treatment applied to `.att-card-title` / `.att-card-body` for attention cards.
- **Cat L — Notification panel mobile overflow**: Added `@media(max-width:768px)` rule making `.notif-panel` `position:fixed`, full viewport width, pinned under the nav bar, with `max-height:60vh` and `overflow-y:auto` — prevents the 320px panel overflowing left on 390px screens.

---

## [2026-05-01] — Advisor Portal: Cat K–L + nav badge + deal switcher mobile fixes

### Changes
- `advisor-portal.html`: Appended a new `<style>` block (Cat K–L + 2 targeted fixes) immediately before `</head>`. No nav HTML, no auth JS touched.
- **Cat K — Stage journey labels** (≤600px): `.sj-circle` shrunk to 28×28px. `.sj-label` set to `white-space:normal; max-width:56px; font-size:7px; line-height:1.3; word-break:break-word` so stage labels wrap to 2 lines instead of colliding. `.sj-inner` forced to `flex-wrap:nowrap` with `overflow-x:auto` on `.stage-journey` so the whole journey scrolls horizontally. `.sj-line` connector reduced to `width:12px; min-width:6px`.
- **Cat L — Notification panel full-width sheet** (≤768px): `.notif-bell-wrap` set to `position:static` so it doesn't create a new stacking context. `.notif-panel` converted to `position:fixed; top:var(--nav-h); left:0; right:0; width:100%; border-radius:0 0 8px 8px; max-height:60vh; overflow-y:auto; z-index:400` — slides in as a full-width sheet below the nav instead of a 340px absolute card that clips off-screen.
- **Nav role badge** (≤480px): `.role-badge` hidden with `display:none` — role is implied by the portal and the badge was squeezing the avatar and Sign out button off-screen.
- **Deal switcher pills** (≤768px): `.deal-switcher` set to `overflow-x:auto; flex-wrap:nowrap; scrollbar-width:none` with webkit scrollbar hidden. `.ds-pill` gets `flex-shrink:0; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` — pills scroll horizontally rather than bleeding off the right edge.

---

## [2026-05-01] — Investor portal: Cat G hero void fix (mobile)

### Changes
- `investor-portal.html`: Appended a new `<style>` block (Cat G) immediately before `</head>` — no nav HTML, no auth JS, no desktop rules touched.
- **Root cause**: `.hero-content { justify-content:center }` (set in "MOBILE SPACING AUDIT" block) combined with `.lobby-hero { min-height:100svh }` left ~220px of dead space above and below the text content on mobile, because `.hero-visual` is hidden and the single text column is only ~400px tall inside an 844px container.
- **Fix**: Override `justify-content` to `flex-start` with `padding-top: clamp(28px,6vh,56px)` so content anchors to the top with breathing room instead of floating in the centre.
- **Also**: `.lobby-hero` set to `min-height:min(100svh,100vh)` (keeps intentional height while the override flow prevents the void). `.hero-dots` forced `position:static` so they flow with content rather than absolute-positioning into the void.
- **Also**: Added `@media(max-width:480px)` rule to strip all `border-left`/`border-right`/`padding-left` from `.hero-stat` — the 2×2 grid dividers were rendering as phantom lines on very small screens.
- Confirmed `.lobby-greeting` is `position:static !important` from two prior override blocks and is NOT reset to absolute anywhere after that — no overlap regression.

---

## [2026-05-01] — Admin portal: 6-category systemic mobile fix (iPhone 15, 390px)

### Changes
- `admin-portal.html`: Appended a new `<style>` block immediately before `</head>` covering all 6 systemic mobile categories. No nav HTML, no auth JS, no desktop rules touched.
- **Cat A** (letter-spacing on CTAs): All button classes tightened to `.02em` at ≤768px; `inline-flex + white-space:nowrap` applied at ≤480px.
- **Cat B** (multi-column grid collapse): Inline `1fr 1fr 1fr` grids forced to `1fr 1fr` at ≤480px; JS-rendered inline 2-col grids in `#pkg-preview-body` and `#idp-body` forced to 1-col; `.adp-grid-3` belt-and-suspenders override.
- **Cat C** (eyebrow/label letter-spacing overflow): `.role-badge`, all non-nav `[class*="-badge"]`, tag/lbl/label classes, `.kpi-lbl`, `.att-card-tag`, `.dp-stage-chip`, `.iqi-badge`, `.ioi-raise-status` capped at `.06em`; wordmark tracking to `.1em`.
- **Cat D** (centered text orphaning): All sub/note/desc/body-text classes and `.view-sub`, `.kpi-sub`, `.modal-body`, `.adp-hint`, `.lr-cb-note` forced `text-align:left` at ≤480px; `.pp-capital-block` explicitly re-centred.
- **Cat E** (fixed heights clipping): All action buttons `height:auto; min-height:44px` at ≤768px; `[class*="-card"]` set `height:auto`; `.kpi-card` gets `min-height:72px`.
- **Cat F** (overflow/nowrap traps): Non-nav badges `white-space:normal; max-width:100%`; `.dp-name`, `.ioi-row-name`, `.ov-ac-name` get ellipsis; `.view-sub` and `.ov-header-alert` forced `white-space:normal`.

---

## [2026-05-01] — Advisor Portal: six-category categorical mobile fixes (390px iPhone)

### Changes
- `advisor-portal.html`: Appended a new `<style>` block immediately before `</head>` with all six systemic mobile fix categories. No nav HTML, no auth JS, no desktop rules changed.
- **Cat A — CTA letter-spacing**: All button classes tightened to `.02em` at ≤768px. Primary CTAs (`.dhs-btn-primary`, `.wiz-next`, `.wiz-submit`, `.ipc-accept`, `.banking-save-btn`) set to `inline-flex + gap:6px + white-space:nowrap` at ≤480px so arrow glyphs never orphan.
- **Cat B — Grid collapse**: `.rev-two-col` inline `1fr 280px` grid forced to `1fr` at ≤480px. `.dash-kpi-grid` and `.prism-docs-grid` forced to `1fr` at ≤360px. `materials-grid`, `closing-grid`, `banking-field-row`, `field-row`, `vdr-layout` were already covered by prior audit blocks.
- **Cat C — Eyebrow / label letter-spacing**: `.nav-wm-aurum` and `.nav-wm-prism` (was `.22em`) reduced to `.1em` at ≤480px. Full selector list including `.ipc-tag`, `.doc-type-label`, `.dhs-eyebrow`, `.dhs-action-badge`, `.role-badge`, `.class-chip`, `.stage-chip`, `.vdr-section-hd`, `.banking-section-lbl`, `.cs-status`, and all `[class*="-badge"]`, `[class*="-chip"]`, `[class*="-tag"]` brought to `.06em`.
- **Cat D — Centered text orphaning**: `.dhs-tagline`, `.submit-sub`, `.closing-note`, `.banking-note`, `.cb-text-sub`, `.ipc-note`, `.ring-card-detail`, `.cs-desc`, `.success-body`, `.doc-req-note`, and all `[class*="-sub"]`, `[class*="-note"]`, `[class*="-desc"]`, `p` switched to `text-align:left` at ≤480px.
- **Cat E — Fixed heights clipping**: `.dhs-btn-primary`, `.dhs-btn-ghost`, `.ctab`, and all non-icon buttons set to `height:auto; min-height:44px` at ≤768px. Card containers (`.ov-card`, `.ps-card`, `.ring-card`, `.dash-kpi-card`, `.prism-doc-card`, `.doc-card`, `.closing-slot`) set to `height:auto`.
- **Cat F — overflow / white-space traps**: `.dhs-action-badge`, `.ds-ioi-banner`, `[class*="-banner"]`, `[class*="-badge"]` set to `white-space:normal; max-width:100%; overflow:visible` at ≤480px. `.deal-name` kept `nowrap + ellipsis`. `.ipc-note` flipped to `overflow:visible; white-space:normal; word-break:break-word`. `.closing-slot` overflow un-trapped. `.ds-pill` capped at `calc(100vw - 80px)`.

---

## [2026-05-01] — Investor portal: 6-category systemic mobile fix (iPhone 15, 390px)

### Changes
- `investor-portal.html`: Appended a new `<style>` block immediately before `</head>` with 6 categorical fixes. No nav HTML, no auth JS, no desktop rules touched.
- **Cat A (CTA letter-spacing):** All `.btn-primary`, `.btn-ghost`, `.ioi-cta`, `.wiring-cta`, `.ci-*-btn`, and `button` reset to `letter-spacing:.02em` at ≤768px. At ≤480px, `.btn-primary`/`.btn-ghost` become `display:flex` with `gap:6px` and `white-space:nowrap` so arrow glyphs never orphan.
- **Cat B (grid collapse):** `.ci-wire-row`, `.ph-stats`, `.pos-grid`, `.docs-grid`, `.stat-grid` all forced to `1fr` at ≤480px. `.alloc-section` forced to `1fr` at ≤640px (was `auto 1fr`, too narrow for 390px).
- **Cat C (eyebrow letter-spacing):** `.hero-eyebrow`, `.urgency-badge`, `.dc-class-tag`, `.chart-lbl`, `.ci-eyebrow`, `.ci-section-title`, `.ci-ref-lbl`, `.tl-lbl`, `.ps-lbl`, `.dd-tag`, `.pos-badge`, `.eq-sc-name`, `.vp-table th`, `.ioi-lbl`, `.ring-sub`, `.section-count`, `.dc-oversubscribed`, `.nav-wm-tacc`, `.nav-user-type` all capped at `letter-spacing:.08em` at ≤480px. Inline `[style*="letter-spacing:.2x"]` attribute selectors catch hardcoded values. Nav wordmark capped at `.14em`.
- **Cat D (centered text orphans):** `.hero-tagline`, `.dd-thesis`, `.hl-body`, `.nda-gate-body`, `.tog-text`, `.ioi-s-body`, `.ioi-confirm-step-text`, `.inv-dr-empty`, `.ring-detail-card`, `.pri-detail`, `.ci-imp-list li`, `.ci-ref-note` all switch to `text-align:left` at ≤480px.
- **Cat E (fixed heights clipping):** All content cards (`.deal-card`, `.pos-card`, `.hl-card`, `.doc-card`, `.stat-cell`, `.eq-sc`, `.inv-ring-row`, `.inv-deal-ring`, `.ioi-form`, `.panel-ring-row`, `.nda-gate`, `.ci-*`) set to `height:auto; min-height:0` at ≤768px. All buttons set to `height:auto; min-height:44px`. Icon-only elements (`.theme-btn`, `.nav-avatar`) exempt. `.return-chart` converted to `clamp(100px,30vw,140px)`.
- **Cat F (overflow:hidden traps):** `.deal-card`, `.pos-card`, `.hl-card`, `.ioi-form`, `.ioi-pipeline`, `.inv-dr-section`, `.ci-wire-table`, `.action-panel` set to `overflow:visible` at ≤480px. `.urgency-badge`, `.dc-class-tag`, `.pos-badge`, `.closing-stage-chip`, `.dc-oversubscribed`, `.inv-dr-view-btn` get `white-space:normal; max-width:100%`. Generic `[class*="-row"]` overflow released (with specific nav/functional exclusions). `.stat-grid` overflow restored; each `.stat-cell` gets its own border+radius.

---

## [2026-05-01] — Admin portal: mobile spacing audit (iPhone 15, 390px)

### Changes
- `admin-portal.html`: Appended a new `<style>` block (20 targeted rule groups) after the hardened nav override block and before `</head>`. No nav HTML or auth JS touched.
- `.view-inner` at ≤480px: `padding:20px 16px 80px` — breathing room and nothing hides under sticky elements.
- `.view-inner > *` at ≤600px: `margin-bottom:clamp(24px,4vh,48px)` between all major sections.
- `.kpi-val` at ≤600px: `clamp(20px,5vw,32px)`; `.kpi-lbl` `white-space:normal` so labels wrap.
- `.ov-stage-lanes` at ≤600px: 1-column collapse (was only 2-col at 900px, still too wide at 390px); connector line hidden.
- `.dp-name`: `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` — deal names no longer bust card width.
- `.dp-btn` at ≤480px: full-width, `min-height:44px` for 44px touch targets.
- `.q-approve`, `.q-decline` at ≤480px: `min-height:44px; width:100%`.
- `.ioi-deal-footer` at ≤480px: `flex-direction:column; align-items:stretch` — all action buttons full-width.
- `.section-hd-title`, `.ov-section-title` at ≤600px: `clamp(15px,4vw,22px)`.
- `.section-hd > button/a` at ≤600px: `min-height:36px; padding:6px 12px; font-size:12px`.
- Mono letter-spacing at ≤480px: tightened to `.06em` — prevents label overflow on narrow screens.
- `.notif-panel` at ≤440px: `width:calc(100vw - 32px); right:-8px` — stays within 390px viewport.
- `.ntab-badge`: `pointer-events:none; transform:translateX(2px)` — count dot no longer widens the tab.
- `.ioi-deal-hd-right` at ≤480px: `flex-direction:row; flex-wrap:wrap`.
- `th` at ≤600px: `white-space:normal` — table headers wrap instead of forcing horizontal scroll.
- `.ov-bottom-grid` at ≤768px: `grid-template-columns:1fr` (tightened from 900px breakpoint).
- `.modal-box` at ≤480px: `padding:16px; width:calc(100vw - 24px); max-height:85vh`.
- Pipeline heading row at ≤480px: stacks vertically, `+ Add Deal` stretches full-width.
- `.view-heading` at ≤480px: `clamp(20px,6vw,32px)`.

---

## [2026-05-01] — Advisor Portal: mobile spacing audit and full-screen hero fix (iPhone 15)

### Changes
- `advisor-portal.html`: Appended a new targeted `<style>` block (14 rule groups) before `</body>`, applying iPhone 15 (390×844px) spacing fixes without touching the nav override block or desktop layout.
- `#dash-hero-static`: `min-height:100svh` (with `100vh` fallback) at ≤768px — hero fills the full first pane instead of collapsing to `min-height:auto`.
- `.dhs-left`: padding changed to `clamp(28px,6vh,56px) 20px` at ≤768px — generous vertical breathing on portrait mobile.
- `.dhs-headline`: hero font raised to `clamp(24px,7vw,42px)` at ≤768px, up from the previous `clamp(22px,6vw,38px)`.
- `.tab-panel.active`: `padding-bottom:80px` at ≤480px — bottom content never hidden under sticky footer or iOS home indicator.
- `.dash-section`: `margin-bottom:clamp(24px,4vh,48px)` at ≤768px — consistent vertical rhythm between dashboard sections.
- `.dash-section-title`, `.section-title`: responsive font-size clamps at ≤480px.
- `.ov-card`, `.ring-card`, `.ps-card`, `.prism-doc-card`: minimum `14px 16px` padding enforced at ≤480px.
- `.notif-panel`: `max-width:calc(100vw - 16px)` at ≤480px — dropdown can't bleed off-screen at 390px.
- `.dhs-eyebrow` and mono labels: `letter-spacing` reduced to `.14em`–`.1em` at ≤480px to prevent overflow.
- `.mini-ring-wrap`: reduced to `56×56px` at ≤480px; deal header ring never overflows.
- `.perf-ring-wrap`: capped at `100px` at ≤360px — extra safety on smallest viewports.
- `.ipc-accept`, `.ipc-decline`: `min-height:44px` enforced — meets touch-target standard.
- `.vdr-layout`, `.closing-slot`, `.submit-wrap`: padding/bottom-clearance tightened for mobile.

---

## [2026-05-01] — Investor Portal: mobile spacing audit and full-screen hero fix

### Changes
- `investor-portal.html`: Appended a new third `<style>` block (12 targeted rule groups) before `</head>`, applying iPhone 15 (390px) spacing fixes without touching the nav fix block or desktop layout.
- `.lobby-hero`: `min-height:100svh` (with `100vh` fallback) at ≤768px; changed from `display:grid` to `display:flex; flex-direction:column` so the hero fills the full viewport on first load.
- `.hero-content`: `flex:1; justify-content:center; padding-bottom:clamp(40px,8vh,80px)` — content fills remaining height and bottom stat row is never cut off.
- `.lobby-greeting`: enforced `position:static` at ≤768px with `clamp(18px,4vh,32px)` top padding — no longer an absolute overlay fighting with content.
- `.hero-dots` + `.hero-sub-bar-wrap`: `margin-top:auto; flex-shrink:0` so dots pin to bottom of the flex column naturally.
- `.section`, `.portfolio-hero`, `.portfolio-body`: replaced flat pixel padding with `clamp(32px,6vh,64px)` / `clamp(24px,5vh,40px)` at ≤768px and ≤480px for true breathing room.
- `.section-title`: `font-size:clamp(18px,5vw,28px)` at ≤768px — never truncates or wraps awkwardly.
- `.hero-stat` at ≤480px: all `border-left/border-right` cleared so no phantom dividers appear in the 2×2 grid; `row-gap:16px` added.
- `.ph-stats`: converted to `display:grid; grid-template-columns:1fr 1fr` at ≤480px for clean two-column stat layout.
- `.pos-card-top/.btm`, `.deal-card` cells, `.ioi-confirm`: minimum `14px 16px` / `24px 16px` padding enforced at ≤480px.
- `.action-sticky`: `position:static !important` reinforced at ≤768px — sidebar never sticks on mobile.
- `.demo-badge`: `pointer-events:none; opacity:.55` at ≤480px with `env(safe-area-inset-bottom)` offset so it doesn't cover bottom CTAs.
- `#view-deal`: `height:100svh` at ≤768px with `.dd-inner` `padding-bottom` accounting for `env(safe-area-inset-bottom)`.

---

## [2026-05-01] — Admin portal: comprehensive mobile layout overhaul

### Changes
- `admin-portal.html`: Appended ~120 lines of inline mobile CSS before `</style>`, targeting iPhone 15 (390px) with breakpoints at ≤768px, ≤600px, and ≤480px.
- Deal pipeline (`.dp-row`): block card layout at ≤600px; header hidden; `.dp-closing`/`.dp-geo` hidden at ≤480px; deal name full-width bold 14px; status+amount inline.
- IOI table: overrides `display:table` back to block/flex card layout at ≤600px; header hidden; actions full-width flex row.
- IOI deal-group header: wraps at ≤600px; `.ioi-sub-wrap` full-width.
- Modals (`.modal-box`): `max-height:80vh; overflow-y:auto` at ≤768px; `.notif-panel` clamped to viewport width.
- Push-preview modal: 2-col breakdown stacks at ≤600px; padding tightened at ≤480px.
- Attention grid: 1-column at ≤600px; action buttons 44px min-height.
- `.view-inner`: padding reduced at ≤600px and ≤480px.
- Launch review: tabs scrollable; body/header padding reduced; deal name max-width trimmed.
- Deal detail panel: breakdown stacks; IOI tables overflow-x scroll.
- IOI detail panel: amount shrinks; meta grid 1-col; action strip padding reduced.
- Deal Studio: slot/output panel padding reduced at ≤480px.
- Overview: stage lanes get overflow-x:auto to prevent content loss.
- `.eq-scenarios`: 2-col at ≤480px.
- `.ddp-ioi-table`/`-full`: `display:block; overflow-x:auto` at ≤600px.

---

## [2026-05-01] — Advisor Portal: Comprehensive mobile inline styles

### Changes
- `advisor-portal.html`: Appended a new `@media` block before the final `</style>` tag covering all major layout-breaking issues on iPhone 15 (390px baseline).
- Dashboard hero (`#dash-hero-static`): 1-column stack at ≤768px, `.dhs-visual` prism hidden, `.dhs-left` padding 28px 20px, `.dhs-headline` clamped to `clamp(22px,6vw,38px)`.
- Hero stats (`.dhs-stats`): flex-wrap with 2-column layout at ≤480px; `.dhs-stat-div` separators hidden.
- Hero CTA buttons (`.dhs-actions`/`.dhs-ctas`): full-width column stack at ≤480px.
- Stage journey: `.sj-connector` hidden at ≤480px; stage padding reduced; `min-width:0!important` reinforcement at ≤768px.
- Deal header: full-column at ≤600px, ring flipped to row + shrunk to 64px, quick-stats wrap.
- IOI push card: tightened padding at ≤480px, `.ipc-body` stacks to column, action buttons full-width.
- Dashboard sections: `.dash-section-hd` flex-wrap at ≤480px, section padding reduced to 16px.
- Submit wizard: padding reduced to 20px 16px at ≤480px, wizard labels truncated, nav buttons full-width.
- Tab panels: padding reduced to 16px at ≤480px.
- Content tabs: tighter padding at ≤480px.
- Deal switcher: reduced padding/gap at ≤480px.
- Notification panel: viewport-width at ≤400px to prevent overflow.
- 360px floor: overview + materials grids collapse to 1-col.

---

## [2026-05-01] — Add universal mobile.css foundation (admin + advisor portals)

### Changes
- `mobile.css` (new): Universal mobile stylesheet covering 8 areas — typography floor (13px body, 11px badge/chip, 10px mono), 44×44px touch targets for all interactive elements, tab-row horizontal scroll (overflow-x: auto, no trap), `.sj-inner`/`.tl-inner` min-width: 0 flex-wrap fix, grid collapse (kpi 2-col, deal/docs 1-col), modal/drawer fullscreen bottom-sheet on ≤768px, body overflow-x: hidden + flex-row wrap, iOS font-size: 16px zoom suppression.
- `admin-portal.html`: `<link rel="stylesheet" href="/mobile.css">` added immediately before `</head>` (line 818).
- `advisor-portal.html`: same link added before `</head>` (line 503).
- investor-portal.html NOT modified — handled by separate agent.

---

## [2026-05-01] — Investor Portal: Fix greeting visibility and restore ring IDs

### Changes
- `investor-portal.html`: `.hero-greeting` CSS — font-size upgraded from `clamp(13px,1.2vw,16px)` to `clamp(15px,1.4vw,20px)`; color changed from `var(--text-2)` to `var(--text)` so greeting is legible.
- `investor-portal.html`: Ring HTML replaced — previous patch had introduced `inv-ring-row`/`inv-ring-fill`/`inv-ring-pct` IDs that `applyHeroSlide()` never writes to. Restored canonical IDs: `hero-ring`, `hero-ring-pct`, `hero-sub-amt`, `hero-alloc-disp`, `hero-inv-count`, `hero-days` inside a new `.inv-deal-ring` wrapper.
- Added `.inv-deal-ring` CSS (flex row, dark backdrop, gold border, blur).
- `load()`: nav name now prefers `me.name` over `me.firm` (was `me.firm`-only).

---

## [2026-05-01] — Advisor Portal: Fix hero right-panel visual overlap

### Changes
- `advisor-portal.html`: Replaced broken `.dhs-prism-scene` absolute-positioning layout with a clean flex-column `.dhs-vis-inner` wrapper.
- New DOM order: action badge pill (above) → prism SVG → ring circle + detail card side-by-side in a row.
- Removed `position:absolute` from `.dhs-ring-float` and `.dhs-action-badge`; both are now flow elements.
- `.dhs-vis-inner` is `flex-direction:column; align-items:center; gap:16px; width:min(320px,85%)`.
- `.dhs-ring-float` is `display:flex; align-items:center; gap:16px` — ring circle and detail card sit side by side.
- `.dhs-ring-detail` gains `flex:1; text-align:left` so it fills available width next to the ring.
- `.dhs-visual` centered with `justify-content:center; padding:0` (was left-aligned).
- `.dhs-prism-scene` class and its CSS removed entirely.
- All JS `getElementById` targets (`dhs-ring-fill`, `dhs-ring-pct`, `dhs-ring-amt`, `dhs-ring-target`, `dhs-ring-investors`, `dhs-action-badge`, `dhs-ab-text`) preserved and verified.

---

## [2026-05-01] — Advisor Portal: Dashboard hero upgraded to investor-portal lobby style

### Changes
- `advisor-portal.html`: Replaced weak dashboard hero with exact investor-portal lobby layout transplanted in.
- Hero uses hardcoded dark hex values (#0A0908 bg, #C5A572 gold, #EDE8DF text) — always dark regardless of light/dark theme toggle.
- Prism SVG updated: stroke uses `rgba(255,255,255,0.12)` instead of `currentColor` (invisible in light mode bug fixed).
- Left panel: eyebrow dot, large serif italic greeting headline, tagline, KPI stat strip (deals / capital indicated / investors / actions needed), CTA buttons, action alert bar, progress bar strip.
- Right panel: animated prism SVG, ring float (bottom-right) with live allocation % / IOI amount / target raise / investor count, action badge.
- `renderDashboard()` fill block updated to match new IDs: `dhs-headline`, `dhs-tagline`, `dhs-stats`, `dhs-social`, `dhs-sub-bar-fill`, ring IDs unchanged.
- Added `.dhs-stat`, `.dhs-stat-val`, `.dhs-stat-lbl`, `.dhs-stat-div` CSS for the KPI stat strip.

---

## [2026-05-01] — Advisor Portal: Dashboard landing view

### Changes
- `advisor-portal.html`: Added a full "Dashboard" tab as the new default landing view for advisors. The advisor now lands on the Dashboard instead of My Deals.
- New `#view-overview` div with `id="dash-root"` inserted before the My Deals view. `view-deal` no longer starts as `active`.
- Nav tabs updated: Dashboard (first, default) · My Deals · Submit New Deal.
- `showView('overview',...)` now calls `renderDashboard()`. `renderMockDeals()` and `load()` both call `renderDashboard()` after setting up deals. `load()` also calls `showView('overview',...)` when real deals are loaded.
- New `renderDashboard()` JS function: computes cross-deal KPI aggregates (total raise, capital indicated, active investors, nearest close), builds an action queue scanning all deals for pending review/IOI/dataroom/Q&A items, renders stage pipeline, deal cards with animated fill bars, recent activity feed, and platform documents section.
- Helper functions added: `goDashDeal(idx)`, `goDashAction(idx,tab)`, `filterDashByStage(stage)`.
- New dashboard CSS block added before `</body>`: `.dash-hero`, `.dash-kpi-grid`, `.dash-kpi-card`, `.dash-action-list`, `.dash-action-card`, `.dash-pipeline`, `.dash-deal-grid`, `.dash-deal-card`, `.dash-activity-feed`, `.dash-pdoc-list` — all using existing CSS variable system with serif italics for titles, mono for numbers, gold accents.

---

## [2026-05-01] — Hide terms universally from Equity deal listings (all portals)

### Changes
- `admin-portal.html`: "Term" metric removed from Key Metrics grid for Equity deals. Auto-generated thesis no longer includes "X-month investment horizon" phrase for Equity. Term highlight excluded from AI-generated highlights array for Equity. `stats.term` omitted from generated stats for Equity.
- `advisor-portal.html`: "Term" row hidden in deal Economics section for Equity. Quick stats subtitle no longer shows "X-month term" for Equity (shows IRR only).
- `investor-portal.html`: Term Sheet document excluded from deal document list for Equity. "Term Sheet" removed from the doc-unlock hint text for Equity deals.
- Private Credit and Real Estate continue to show terms unchanged.

---

## [2026-05-01] — Admin portal: Rename "Open Due Diligence" → "Open Data Room" in See Investors popup

### Changes
- `admin-portal.html` (`showInvestorsStep2`): CTA button now reads "Open Data Room →" instead of "Open Due Diligence →". Scoped to the See Investors step-2 popup only — the queue column title and IOI detail panel are unchanged.

---

## [2026-05-01] — Admin portal: Approve/Decline pending IOIs directly in See Investors popup

### Changes
- `admin-portal.html` (`openInvestorsPopup`): Pending IOI rows now show inline **Approve** (green) and **Decline** (red) buttons instead of just a status badge. Approved and declined rows continue to show their badge as read-only.
- `admin-portal.html` (`ioiActionInPopup`): New function — calls existing `actIoi()` to update state and fire the API, then re-renders the overview KPIs and refreshes the popup in-place. No navigation away required.

---

## [2026-05-01] — Advisor portal: IOI Interest Summary styled as IOI Package template

### Changes
- `advisor-portal.html` (`openPrismDoc('ioi')`): Replaced plain key-value table with the full IOI Package layout matching the admin template — AURUM | PRISM header, deal name in serif italic, PREPARED FOR advisor line, large gold capital figure, % of target + investor count, confidentiality strip, investor composition by type, recommended action, and deal economics footer.
- `advisor-portal.html`: Fixed data source — was reading `d.iois` (empty on advisor portal) instead of aggregate fields `d.ioi_agg`, `d.ioi_count`, `d.investors_by_type` which are always populated. Investor names remain undisclosed per the confidentiality model.

---

## [2026-05-01] — Rename "Private Equity" → "Equity" across all portals

### Changes
- `admin-portal.html`: 7 occurrences replaced (dropdowns, deal cards, asset class labels)
- `advisor-portal.html`: 3 occurrences replaced (deal mock data, asset class display)
- `investor-portal.html`: 1 occurrence replaced

---

## [2026-05-01] — Admin portal: pre-publish preview modal + investors popup 2-step IOI package flow

### Changes
- `admin-portal.html` ("Publish Live →" buttons): Both buttons in the "Ready to Publish" column and the new-deal card now call `previewBeforePublish(dealId, btn)` instead of `publishDeal` directly.
- `admin-portal.html` (`previewBeforePublish`): Opens a full-page `#publish-preview-modal` (z-index 700, blur backdrop, max-width 680px, scrollable inner panel) showing the deal exactly as investors will see it — serif italic deal name, tagline, asset/geo/structure chips, thesis block, highlights list with icons, and an economics sidebar (IRR, allocation, min ticket, term, closing date).
- `admin-portal.html` (`confirmPublishLive`, `closePublishPreview`): "Confirm & Publish Live →" footer button calls the existing `publishDeal` and then closes the modal; "Back" button closes without publishing.
- `admin-portal.html` (`openInvestorsPopup`): Appended a "Next: Review IOI Package →" gold button at the bottom of the investor list body (Step 1 of 2).
- `admin-portal.html` (`showInvestorsStep2`): Replaces the modal body with a dark/gold IOI Package panel showing: AURUM|PRISM + A TACC PLATFORM header, IOI PACKAGE + date + LIVE badge, deal name in serif italic, capital amount in 52px gold mono, % of target + investor count, confidentiality strip, recommended action box, optional note textarea, and "Open Due Diligence →" / Cancel / ← Back footer buttons.
- `admin-portal.html` (`confirmPushFromPopup`): Marks all approved IOIs as pushed, sets `deal.stage = 'dd'`, closes the popup, re-renders overview/KPIs/pipeline, and shows a toast — equivalent to the existing `confirmPush` logic without requiring the separate push modal.

### Why
Admin needed to review advisor-confirmed deal content before it went live on the investor portal. The investors popup also needed a natural next step from "see who indicated" to "formally open DD with an IOI summary for the advisor."

---

## [2026-05-01] — Fix: notification click shows overlay popup + highlights field name normalization

### Changes
- `advisor-portal.html` (`adaptDeal`): Added explicit fallbacks — `thesis: d.thesis || d.ai_draft?.thesis`, `tagline: d.tagline || d.ai_draft?.tagline`, `highlights: d.highlights?.length ? d.highlights : d.ai_draft?.highlights`. Ensures deals loaded before the `send-to-advisor-review` API fix still show content.
- `advisor-portal.html` (`notifClick`): For `deal_review_requested` type — now sets `_pendingReviewDealId` and shows the `#review-notify-overlay` full-page popup instead of jumping directly to the Review & Edit tab. The overlay's "Review Now" button then navigates. This is the expected UX: advisor sees the popup, reads context, then clicks in.
- `advisor-portal.html` (`renderReviewEdit`): Highlights now render with `h.s || h.title` and `h.b || h.body` so both API format (`{s, b}`) and mock/legacy format (`{title, body}`) work.
- `advisor-portal.html` (`openPrismDoc listing`): Same `h.title || h.s` / `h.body || h.b` normalization applied to the Materials doc viewer.

---

## [2026-05-01] — Fix: AI-generated deal content not reaching advisor review

### Changes
- `api/v2.js` (`send-to-advisor-review` op): Promote `deal.ai_draft` fields (`thesis`, `tagline`, `highlights`) to top-level deal fields before saving, so advisor sees them on load. Highlights are normalised to `{icon, s, b}` in case field names differ. Also accept explicit `thesis`/`tagline`/`highlights` overrides in the request body. Audit log entry now records whether `ai_draft` promotion occurred.
- `admin-portal.html` (`sendToAdvisorReview` function): Build a `payload` object that includes current `_launchContent` fields (`thesis`, `tagline`, `highlights`) when present, so content generated in Deal Studio is forwarded to the API even if it hasn't been saved to Redis via `ai-generate`.

### Why
`send-to-advisor-review` was only setting `advisor_review_status = 'pending'` — it never copied the AI-generated content from `deal.ai_draft` to top-level fields. Advisor portal reads `d.thesis`, `d.tagline`, `d.highlights` directly, so they were always `undefined` after "Send to Advisor" from Deal Studio.

---

## [2026-05-01] — Advisor portal: Stage-aware Next Step guide + enriched activity log

### Changes
- `advisor-portal.html`: Added **"Next Step" guide card** above the activity log in `renderOverview()` — dynamically computed from `d.stage`. States: Under Admin Review (amber), Deal Live (green), IOI Awaiting Decision (gold, when `pushed_ioi.status==='pending'`), Due Diligence Active (blue), Closing Stage (gold), Deal Realized (green).
- `advisor-portal.html`: Each guide card shows stage icon, title, and a plain-English description of exactly what the advisor should do at that stage.
- `advisor-portal.html`: Added `publish` and `review` activity types (icons: ● and ✎) to the icon/emoji maps so stage-transition entries render correctly.
- `advisor-portal.html`: Enriched activity arrays for all 4 mock deals to include full lifecycle history: review confirmation, publish, IOI events, stage transitions, investor access events — in chronological order from most recent.
- `advisor-portal.html`: Renamed "Recent Activity" section to "Activity Log".

---

## [2026-05-01] — Admin portal: "See Investors" replaced with inline popup modal

### Changes
- `admin-portal.html`: Replaced `seeInvestors()` (navigated away to IOI Queue tab) with `openInvestorsPopup()` — a fixed overlay modal that appears on the Overview page directly.
- Modal shows all IOIs for the deal grouped into "Approved" (top) and "Pending / Other" (bottom) sections, with avatar initials, investor name/type/geo, amount in gold mono, status badge, and date.
- Summary bar at modal bottom shows approved investor count, total approved amount, and % of target raise.
- Added `.inv-popup-row` CSS class and `#investors-popup` modal HTML.
- Removed the old `seeInvestors` function entirely.

---

## [2026-05-01] — Advisor portal: Prism doc viewer modals + deal content data

### Changes
- `advisor-portal.html`: Added `tagline`, `thesis`, and `highlights` arrays to all 3 mock deals (PBI, CCP2, VAS) so Material doc viewer has real content to display.
- `advisor-portal.html`: Removed "AI-Generated Deal Brief" card from Prism Platform Documents (it is the same thing as Investor Portal Listing).
- `advisor-portal.html`: Wired "IOI Interest Summary" button to `openPrismDoc('ioi')` — shows approved IOI breakdown with investor type, region, date, and amount.
- `advisor-portal.html`: Wired "Investor Portal Listing" button to `openPrismDoc('listing')` — shows full deal as published: name, asset class chips, tagline, thesis, highlights, and economics.
- `advisor-portal.html`: Wired "Platform Deal Report" button to `openPrismDoc('report')` — shows capital summary, investor composition, and stage.
- `advisor-portal.html`: Added `openPrismDoc(type)` and `closePrismDoc()` functions, modal overlay (`#prism-doc-viewer`), and `.pdv-*` CSS classes for the viewer.

---

## [2026-05-01] — Admin portal: "Ready to Publish" queue column + notification bell

### Changes
- `admin-portal.html`: Added 4th queue column **"Ready to Publish"** (green dot) to the Overview action queue. Deals where `advisor_review_status === 'approved'` now appear here with a "Publish Live →" button, and are excluded from the "New Deals" column so they no longer appear in both.
- `admin-portal.html`: Mock data — added `advisor_review_status:'approved'` to the first `NEW_SUBMISSIONS` entry (`ns1`, Meridian Financial Corp) so the column is non-empty on load.
- `admin-portal.html`: Queue grid CSS updated from `repeat(3,1fr)` to `repeat(4,1fr)`. Added `.ov-dot-green` CSS class. Responsive breakpoints updated: 2-col at ≤1100px, 1-col at ≤640px.
- `admin-portal.html`: Added notification bell button (`#notif-bell`) to admin top nav (right side, before Sign out). Shows an amber badge with total pending count = publish-ready deals + pending investor approvals.
- `admin-portal.html`: Bell click opens `#notif-panel` dropdown listing each publish-ready deal (green dot) and each pending investor (amber dot). Clicking a deal item navigates to Overview; clicking a pending investor shows a toast. Dismiss on outside click. Shows "All clear" if nothing pending.
- `admin-portal.html`: Added `updateNotifBell()` — computes badge count and toggles bell styling. Called at end of `renderOverview()`.
- `admin-portal.html`: Added `toggleNotifPanel()` — renders notification list, opens/closes panel, wires outside-click dismiss.
- `admin-portal.html`: Added CSS for `.notif-bell-wrap`, `.notif-bell-btn`, `.notif-badge`, `.notif-panel`, `.notif-panel-hd`, `.notif-item`, `.notif-item-dot`, `.notif-item-body`, `.notif-empty`.

---

## [2026-05-01] — Advisor portal: Overview + Performance merge, Prism Platform Documents in Materials

### Changes
- `advisor-portal.html`: Removed Performance tab button from tab nav; emptied static `#tab-performance` panel (hidden, display:none) to eliminate duplicate DOM IDs.
- `advisor-portal.html`: `renderOverview()` now appends a "Raise Progress" section (ring chart, investor composition, closing countdown, min ticket) at the bottom of the Overview tab and calls `animatePerf()` after `innerHTML` is set — consolidating what was previously a separate Performance tab.
- `advisor-portal.html`: `renderMaterials()` now shows a "Prism Platform Documents" section above Core Documents with four read-only reference cards: IOI Interest Summary, Investor Portal Listing, AI-Generated Deal Brief, Platform Deal Report.
- `advisor-portal.html`: Added CSS for `.prism-docs-grid`, `.prism-doc-card`, `.pdc-icon`, `.pdc-body`, `.pdc-label`, `.pdc-desc`, `.pdc-btn`.

---

## [2026-05-01] — Advisor Review: full-page overlay + investor-style deal preview with inline editing

### Changes
- `advisor-portal.html`: Replaced plain form `renderReviewEdit()` with a rich two-column investor-preview layout. Left column shows deal identity, editable name (serif display field), editable thesis, highlights (click-to-edit per row with icon/title/body), and read-only key-stats chips. Right sidebar shows all deal economics as click-to-edit mono fields with comma formatting. Confirm and Save Draft buttons in sidebar.
- `advisor-portal.html`: Added full-page notification overlay (`#review-notify-overlay`) — fires on load via `checkReviewOverlay()` when any deal has an unread `deal_review_requested` notification or `advisor_review_status === 'pending'`. "Review Now" navigates directly to that deal's Review tab; "Later" dismisses.
- `advisor-portal.html`: Added `dismissReviewOverlay()`, `checkReviewOverlay()` functions. `checkReviewOverlay()` called from both `loadNotifications()` (live API path) and `renderMockDeals()` (mock data path).
- `advisor-portal.html`: Added `fmNum()` and `parseNum()` helpers for comma-formatted number display/parsing in edit fields.
- `advisor-portal.html`: Added `_pendingReviewDealId` and `_revEdits` module-level state. Rewrote `confirmDealReview()` to read from `_revEdits` accumulator (populated by inline edit save handlers) rather than querying DOM inputs directly. `reviewField()` and `reviewTextarea()` helper functions removed (no longer needed).
- `advisor-portal.html`: Added `.rev-edit-hint` / `.rev-field-wrap:hover` CSS for hover-reveal pencil hints, and `@media(max-width:700px)` responsive stack for the two-column review grid.

---

## [2026-05-01] — Advisor review step: AI-gen → advisor edits → admin publishes

### Changes
- `api/v2.js`: New `admin` op `send-to-advisor-review` — sets `deal.advisor_review_status='pending'`, appends `deal_review_requested` notification for advisor, writes audit log entry
- `api/v2.js`: New `advisor` op `advisor-confirm-deal` — saves advisor edits to deal fields (name, IRR, allocation, min ticket, term, closing date, geography, structure, thesis, highlights), sets `advisor_review_status='approved'`, appends `advisor_confirmed_deal` notification for admin, writes audit log entry
- `admin-portal.html`: "Generate with AI →" deal cards in Overview now show state-dependent actions: Generate → Send to Advisor → Awaiting Advisor Review → Publish Live. Added `sendToAdvisorReview()` and `publishDeal()` functions. AI Deal Studio output panel now shows "Send to Advisor →" as primary action. KPI "New Submissions" tile sub-label shows count of advisor-approved deals ready to publish.
- `advisor-portal.html`: New `deal_review_requested` notification type in bell dropdown with gold icon and navigation to review tab. REVIEW badge on deal switcher pill for deals pending review. New hidden "Review & Edit" ctab shown when `advisor_review_status === 'pending'`. New `tab-review` panel with editable form for all deal fields. `renderReviewEdit()`, `reviewField()`, `reviewTextarea()`, and `confirmDealReview()` functions added. Clicking a review-request notification navigates directly to the Review & Edit tab.

---

## [2026-05-01] — Rename Push to "Open Due Diligence" + auto-DD trigger

### Changes
- `admin-portal.html`: Renamed "Deploy Capital" column to "Open Due Diligence"; renamed all "Push Package" / "Push to Advisor" buttons to "Open Due Diligence"; `confirmPush()` and `confirmPushPackage()` now auto-advance `deal.stage` to `'dd'` locally and call `renderPipeline()`; removed manual "Advance to Due Diligence" button from pipeline (both table and detail panel — `live→dd` transition blocked via `nextStage!=='dd'` guard); updated KPI tile "Ready to Push" → "Ready for DD" with sub-label "awaiting DD open"; updated IOI queue subtitle and IOI detail panel action text; updated push modal title/body for clarity
- `advisor-portal.html`: No label changes required — "Accept & Advance to Due Diligence" already correct
- `investor-portal.html`: Updated IOI confirmation step 2 from "advisor will be notified of your interest" to "the deal moves directly to Due Diligence"
- `api/v2.js`: `push-package` op now captures `prevStage`, sets `deal.stage = 'dd'` before save, and appends two audit log entries: `package_pushed` (existing) + `stage_changed` (new, actor: 'system', trigger: 'package_pushed')

---

## [2026-05-01] — Fix Deploy Capital card layout (absolute position approach)

### Changes
- `admin-portal.html` `renderOverview()` `pushCards`: replaced broken `display:flex;padding:0` override on `.ov-action-card` with `position:relative;padding-right:72px` — keeps existing card padding intact, % Funded panel is absolutely positioned in the right edge so it never crowds or hides left-column text; reduced % font-size to 20px for proportion

---

## [2026-05-01] — Advisor notification chain: IOI push + stage change alerts

### Changes
- `api/v2.js` `push-package`: appends `{ type:'ioi_pushed', ioi_id, investor_firm, amount, pushed_at, read:false }` to `deal.notifications[]` whenever admin pushes an IOI package to an advisor
- `api/v2.js` `deals` POST update handler: appends `{ type:'stage_change', from_stage, to_stage, advanced_at, read:false }` to `deal.notifications[]` whenever a stage transition is detected
- `api/v2.js` new `resource=advisor&op=notifications` endpoint: GET returns all notifications across advisor's deals sorted newest-first with `unread_count`; POST `action=mark-read` marks notification(s) as read by id or `'all'` (optionally scoped to `dealId`)
- `advisor-portal.html` CSS: added `.notif-bell-wrap`, `.notif-bell-btn`, `.notif-badge`, `.notif-panel`, `.notif-item`, `.ds-ioi-banner` styles; bell pulses via existing `breathe` animation when unread
- `advisor-portal.html` nav: added notification bell button with badge and dropdown panel between role-badge and theme toggle
- `advisor-portal.html` `adaptDeal`: carries `notifications` array from API response
- `advisor-portal.html` `renderSwitcher`: shows gold/amber "New IOI Package · $X" banner pill on deal switcher button when deal has unread `ioi_pushed` notification
- `advisor-portal.html` `renderOverview`: added prominent blue "DD Room Active" context banner for deals in `dd` stage with "Open DD Room →" shortcut button
- `advisor-portal.html` `acceptAdminIOI` / `declineAdminIOI`: marks IOI push notifications as read locally + persists to server on advisor action
- `advisor-portal.html` `loadNotifications()`: fetches notifications endpoint on load, merges data back into DEALS, refreshes bell badge and switcher banners
- `advisor-portal.html` `renderNotifBell`, `toggleNotifPanel`, `renderNotifList`, `notifClick`, `markAllNotifRead`: full notification dropdown UI — click navigates to deal, marks notification read, outside-click closes panel

---

## [2026-05-01] — Admin portal nav fix, auto-reseed, mock name scrub (frontend)

### Changes
- `admin-portal.html` CSS: added `overflow-x:auto` and `-webkit-overflow-scrolling:touch` to base `.nav-tabs` rule and `flex-shrink:0` to base `.ntab` rule — fixes System tab clipped off-screen on desktop
- `admin-portal.html` `load()`: added auto-heal block — if KV returns 0 < deals < 8, triggers `/api/v2?resource=deals&op=seed` then re-fetches before rendering, so partial KV data no longer replaces the full mock set
- `admin-portal.html` mock data: replaced Harrison Family Office → Whitmore Family Office, R. Nakashima → Tanaka Family Office, Kessler Family Office → Sterling Family Office, Pemberton Holdings → Ashford Holdings, Riviera Capital SG → Marquette Capital SG, Thomas Kim → T. Kwan / TACC Pte Ltd (across DEALS, NEW_SUBMISSIONS, MOCK_INVESTORS, activity feed)
- `investor-portal.html` mock data: replaced GIC → Meridian Sovereign Fund, Harrison Family Office → Whitmore Family Office, Riviera Capital SG → Marquette Capital SG, Thomas Kim → T. Kwan / TACC Pte Ltd
- `advisor-portal.html` mock data: replaced Temasek Holdings → Singa Capital Fund, GIC Private Ltd → Meridian Sovereign Fund

---

## [2026-05-01] — Replace real company names with fictional ones; add admin deals auto-heal

### Changes
- `api/v2.js` `seedAdvisors`: renamed `Thomas K J` → `T. Kwan`
- `api/v2.js` `seedInvestors`: replaced 7 real-world firm names with fictional equivalents — Northfield Endowment → Westbrook Endowment, Harrison Family Office → Whitmore Family Office, Kessler Family Office → Sterling Family Office, Wellington Capital SG → Hargrove Capital SG, R. Nakashima Family Office → Tanaka Family Office, Pemberton Holdings → Ashford Holdings, Riviera Capital SG → Marquette Capital SG
- `api/_lib/deal-storage.js` `seedIois`: same 9-name replacement applied across all IOI seed entries (Temasek Holdings → Singa Capital Fund, GIC Private Ltd → Meridian Sovereign Fund, plus all above)
- `api/v2.js` admin deals GET handler: added auto-heal block — if `listDeals()` returns fewer than 8 deals, forces full reseed (advisors, investors, deals, IOIs) before responding, ensuring admin portal never shows empty data after KV eviction

---

## [2026-05-01] — Fix seed op: IOIs now force-refreshed on Load Test Data

### Changes
- `v2.js`: `seedIois` was not imported or called in `op=seed` handler — now imported and called with `force=true` so "Load Test Data" fully refreshes IOI records alongside deals

---

## [2026-05-01] — Expanded seed: 16 deals, 8 advisors, 14 investors, full IOI set

### Changes
- `deal-storage.js`: 16 deals across all asset classes (PE, credit, RE, infra) and 7 advisors; explicit IDs to avoid name-collision; IOI seed expanded to 8 active deals with realistic investor names
- `v2.js`: seedAdvisors expanded to 8 advisors (TACC, Chen Capital, Marcus Chen, Mehta, Lim, Park, Kim RE, Pacific Bridge); seedInvestors expanded to 14 institutions including Harrison FO, Kessler FO, Wellington, Nakashima, Pemberton, Riviera Capital, Meridian AM, Stonegate
- `seedIois` now accepts force param so re-seeding also refreshes IOI data

---

## [2026-05-01] — Advisor portal: ZIP dataroom extraction + Q&A chat redesign

### Changes
- Dataroom: ZIP uploads now extract contents via JSZip (CDN) — files grouped into folders by ZIP directory structure
- Q&A: redesigned as chat bubble interface — investor questions left, advisor replies right (gold)
- Q&A: "Opening Statement" button pre-fills a broadcast message template
- Q&A: "Unanswered — reply" badge on investor questions focuses the compose area with context
- Q&A: dummy thread seeded with opening statement + 4 realistic investor questions

---

## [2026-05-01] — Investor portal Q&A redesigned as chat bubbles

### Changed — `investor-portal.html`
- Replaced old flat `.inv-qa-item` list CSS with new chat bubble classes: `.inv-qa-chat`, `.inv-qa-bubble`, `.inv-qa-bubble-body`, `.inv-qa-bubble-meta`, `.inv-qa-compose`, `.inv-qa-send-btn`
- `renderInvestorDataroom()`: Q&A section now reads `d._investorQa` and renders investor questions right-aligned (gold tint) and advisor messages/answers left-aligned; unanswered questions show an "Awaiting reply" pill
- `loadQaThread()`: now maps API response items to `d._investorQa` (was `d.qa_thread`); supports both `investor_q` and `advisor_open` item types
- `submitInvestorQuestion()`: appends new question locally as a right-side bubble, clears textarea, re-renders, and scrolls `#inv-qa-chat` to bottom

---

## [2026-05-01] — API audit fix: 5 confirmed break points repaired

### Fixes
- `login.js`: admin login for tkj@theaurumcc.com now also issues `prism_advisor` cookie (same login gives both admin and advisor portal access)
- `api/v2.js` op=me: added seed fallback — if listDeals returns 0 for advisor, auto-seeds before responding (same pattern as marketplace)
- `admin-portal.html` load(): removed `dealsR.deals.length` guard — API data always replaces mock data even if empty; mock IDs (d9, tacc1 etc.) no longer used for API calls
- `investor-portal.html` load(): removed `.length` guard — API data always replaces mock data so published deals appear immediately
- `advisor-portal.html`: fixed logout URL from 404 `/api/advisor/logout` → correct `/api/v2?resource=advisor&op=logout`

---

## [2026-05-01] — TACC Singapore deals, System tab with seed, delete control.html

### Changes
- `deal-storage.js`: seed deals replaced — adv-tkj (tkj@theaurumcc.com) now gets Figure AI Series C (ioi), Shield AI Series F (dd — dataroom testable), Anthropic Series E (review); SG Capital Group gets Pacific Credit V + Metro Core Logistics + Bridgeford
- `admin-portal.html`: added System nav tab with "Load Test Data" button (calls `/api/v2?resource=deals&op=seed`); `runSeed()` function wired in
- `control.html`: deleted — functionality moved into admin portal System tab
- `vercel.json`: removed `control` from no-cache headers

---

## [2026-05-01] — TKJ account: admin + advisor dual role, DD deal assigned, force reseed

### Changes
- `login.js`: tkj@theaurumcc.com / 1234 now works as **admin** login — falls back to KV advisor with `is_admin:true` flag when not in ADMIN_USERS env var
- `v2.js` seedAdvisors: added `is_admin:true` to adv-tkj record; always force-updates on reseed
- `deal-storage.js` seedDeals: Summit Energy Credit (DD stage) reassigned from adv-mc1 → adv-tkj so tkj sees 3 deals including one in DD phase; `force` param added — "Load Test Data" passes `force:true` to update existing KV records
- Why: operator (tkj) needed to log into both admin and advisor portals with same credentials, and needed a DD-stage deal to test the dataroom feature

---

## [2026-05-01] — API connectivity audit — all three portals wired to backend

### Problems fixed

**investor-portal.html**
- `load()`: Fixed marketplace deal fetch — was hitting non-existent `/api/deals/marketplace`, now correctly calls `/api/v2?resource=deals&op=marketplace`.
- `load()`: Fixed my-IOIs fetch — was hitting `/api/marketplace/my-iois`, now `/api/v2?resource=marketplace&op=my-iois`.
- `submitIoi()`: Fixed IOI submission endpoint — was `/api/marketplace/ioi`, now `/api/v2?resource=marketplace&op=ioi`.
- `renderInvestorDataroom()`: Added `loadVdrFilesInvestor()` call on dataroom tab open — investor dataroom was rendering mock-only `d.vdr_files` without ever fetching live files from `/api/v2?resource=inst&op=vdr-files`.
- `viewInvestorDoc()`: Was calling admin-only `resource=admin&op=deal-docs` with investor cookie (always 401). Fixed to call new `resource=inst&op=inst-doc-download&slot=X` endpoint.

**admin-portal.html**
- `load()`: Fixed IOI fetch — was hitting `/api/marketplace/deal-iois`, now `/api/v2?resource=marketplace&op=deal-iois`.
- `actIoi()`: Fixed approve/reject IOI calls — were POSTing to `/api/marketplace/approve-ioi` and `/api/marketplace/reject-ioi` (non-existent). Now correctly route to `/api/v2?resource=marketplace&op=approve-ioi` and `reject-ioi`.
- `confirmPush()`: Was only mutating local state, never called API. Now fires `POST /api/v2?resource=admin&op=push-package` after updating local state.
- Stage modal confirm: Was only mutating local `d.stage`, never persisted to KV. Now fires `POST /api/v2?resource=deals` with `action:update, stage:targetStage`.
- `declineDeal()`: Was only removing from local `NEW_SUBMISSIONS`, never persisted kill. Now fires `POST /api/v2?resource=deals` with `action:update, stage:'killed'`.

**advisor-portal.html**
- `renderDataroom()` tab switch: Was rendering from `d._vdrFiles || VDR_FILES` only. Now calls `loadVdrAndQa()` on tab open, which fetches `/api/v2?resource=advisor&op=vdr-files` and `/api/v2?resource=advisor&op=qa-thread-advisor`, updating local deal state and re-rendering.
- `acceptAdminIOI()` / `declineAdminIOI()`: Were only mutating local state. Now persist decision to KV via new `POST /api/v2?resource=advisor&op=respond-package`.

**api/v2.js**
- `advisor op=me`: Now hydrates `pushed_ioi` from the latest `package:` KV record for each deal, so the advisor portal can display pushed IOI packages without a separate fetch.
- Added `advisor op=respond-package`: New endpoint for advisor to accept or decline a pushed IOI package; persists decision on both the package record and deal record, advances stage to `dd` on acceptance.
- Added `inst op=inst-doc-download`: New investor-authenticated endpoint to download NDA-gated deal documents (replaces incorrect use of admin `deal-docs` endpoint from investor portal).

---

## [2026-05-01] — Dataroom / Q&A tab — advisor and investor portals

### `advisor-portal.html`
- **New 4th tab "Dataroom / Q&A"** added to the content-tabs bar; only visible when `deal.stage === 'dd'`.
- **`renderHeader()`** updated to show/hide the tab based on current deal stage.
- **`renderDataroom()`** function renders two-column layout: VDR file browser (left, 60%) and Investor Q&A thread (right, 40%).
- **DD deadline banner** at top — amber if open, red if expired. Computed as closing date minus 14 days.
- **File upload:** "Upload to Dataroom" button triggers hidden file input. `handleVdrUpload()` reads files as base64, handles ZIP detection with toast, POSTs to `/api/v2?resource=advisor&op=vdr-upload`, falls back to local state on API error.
- **VDR file list** grouped by folder with filename, size, date, and View button. `viewVdrFile()` is a placeholder toast.
- **Q&A thread rendering** shows questions newest-first with reply textarea for unanswered items. `submitAnswer()` POSTs to `/api/v2?resource=advisor&op=answer-qa` and updates local state regardless.
- **Mock data:** New `d3` (Vantage Analytics) deal added at `stage:'dd'` to trigger the tab in dev. `VDR_FILES` and `QA_THREAD` globals added with sample data.
- **`renderMockDeals()`** fallback added so mock deals render without auth in local dev.
- **CSS:** Full VDR/Q&A component styles added using existing `--mono`, `--gold`, `--border` vars.

### `investor-portal.html`
- **`d3` Vantage Analytics** stage changed from `live` to `dd`; `vdr_files` and `qa_thread` mock data arrays added inline.
- **Deal detail tabs:** When `d.stage === 'dd'`, the `dd-left` panel wraps existing content in an Overview tab and adds a "Dataroom / Q&A" tab.
- **`invShowDealTab()`** handles tab switching between Overview and Dataroom panels.
- **`renderInvestorDataroom()`** renders DD deadline banner, VDR file list (no upload button), and Q&A thread with answered/pending states.
- **`loadQaThread()`** fetches live Q&A from `/api/v2?resource=inst&op=qa-thread` and refreshes panel.
- **`submitInvestorQuestion()`** POSTs to `/api/v2?resource=inst&op=submit-qa`; updates local state on success or API error. Q&A input disabled when DD period closed.
- **`viewVdrFileInvestor()`** fetches file from `/api/v2?resource=inst&op=vdr-file`; falls back to `showVdrViewerMock()` in dev.
- **File viewer modal** with watermark overlay (8 rows of `AURUM PRISM · [investor] · [date] · CONFIDENTIAL` at –30° rotation, no download affordance). Live path uses `<iframe src="data:...">`.
- **CSS:** Full investor dataroom component styles added including viewer modal and watermark layers.

---

## [2026-05-01] — DD Dataroom (VDR) + Q&A backend endpoints

### `api/v2.js`
- **New KV key patterns documented:** `vdr:{dealId}:index`, `vdr:{dealId}:file:{fileId}`, `qa:{dealId}`
- **`resource=advisor, op=vdr-upload` (POST):** Advisor uploads dataroom files (base64 array). Stores each file content separately, merges into index, writes audit log entry on the deal.
- **`resource=advisor, op=vdr-files` (GET):** Returns index metadata for advisor's own deal (no binary content).
- **`resource=advisor, op=qa-thread-advisor` (GET):** Returns full Q&A thread for advisor's own deal.
- **`resource=advisor, op=answer-qa` (POST):** Advisor answers a question by qaId; records answeredAt and answeredBy from KV advisor record.
- **`resource=inst, op=vdr-files` (GET):** Returns file index + dd_deadline + dd_expired. Gated: approved IOI required.
- **`resource=inst, op=vdr-file` (GET):** Returns base64 file content + watermark metadata. Gated: approved IOI required.
- **`resource=inst, op=submit-qa` (POST):** Investor submits a question. Gated: approved IOI + DD not expired.
- **`resource=inst, op=qa-thread` (GET):** Returns full Q&A thread. Gated: approved IOI.
- **Helper `getDdDeadline(deal)`:** Computes DD deadline as closing_date minus 14 days.
- **Helper `getApprovedIoi(dealId, investorId)`:** Scans IOI keys to verify approved status; reuses existing `ioi_exists` dedup key pattern.

---

## [2026-05-01] — Admin overview UX: layout reorder, column renames, clickable rows, package preview panel

### `admin-portal.html`
- **Sign-up grid moved up** — Advisor Access and Investor Access panels now appear above the Action Queue, not below it.
- **Column 2 renamed**: "IOI Decisions" → "Inbound IOI from Investors".
- **Column 3 renamed**: "Ready to Push" → "Deploy Capital".
- **Inbound IOI cards** — investor name is now clickable (`openIoiDetail`), with a `↗` affordance.
- **Deploy Capital cards** reworked — deal name is the primary identifier; investor + amount + advisor shown as secondary context. Two action buttons: "Preview Package →" (`openPackagePreview`) and "Push to Advisor" (`openPushModal`).
- **IOI Intelligence rows** now clickable — clicking a row navigates to the IOI Queue tab and smooth-scrolls to that deal's first non-declined IOI. Hover tint added via `.ov-intel-row:hover`.
- **`openPackagePreview(dealId, ioiId)`** added — full-screen slide-in panel showing Deal Economics, Investor IOI, Investment Thesis, Key Highlights, and a Package Summary callout. Bottom action bar has Cancel and "Push Package to [Advisor] →" buttons.
- **`closePackagePreview()`** added.
- **`#pkg-preview-panel`** HTML element added after the IOI detail panel.
- `.ov-intel-row` CSS updated to include `cursor:pointer`, `transition`, `border-radius`, negative margin padding, and `:hover` rule.

---

## [2026-05-01] — Mock data expansion, closing instructions (investor), banking details (advisor)

### `admin-portal.html`
- **4 new deals added** (d5–d8): Nexus Digital Infrastructure (live/PE), Apex Growth Partners Fund III (dd/PE), Meridian Financial Corp Growth Equity (review/PE), Clearwater Credit Partners III (close/credit). d6 and d8 include IOI arrays.
- **2 new advisor submissions** added to `NEW_SUBMISSIONS`: Horizon Renewable Energy Fund and Cascade Software Series B.
- **MOCK_ADVISORS expanded** to 6 entries with realistic firms and statuses (active/pending).
- **MOCK_INVESTORS expanded** to 8 entries; added `invite_sent` as a third status value with blue dot and "Invite Sent" badge. CSS updated: `.ov-signup-dot.invite_sent` (blue) and `.ov-signup-status.invite_sent` (blue chip).
- `investorAccessLabel()` and `advisorStatusLabel()` helper functions replace inline ternaries for cleaner status label rendering.

### `investor-portal.html`
- **d8 (Clearwater Credit Partners III, close stage)** added to `DEALS` array.
- **Portfolio entry for d8** added: $2M committed, `pipeline_step:4`, `status:'close'`.
- **PIPELINE_STEPS** expanded from 4 to 5 steps — "Closing / Wiring" added as the final step.
- **Portfolio card rendering** updated: close-stage cards get a green border, "Closing" chip, confirmation copy, and a "Wire Instructions Ready →" CTA button.
- **`showClosingInstructions(dealId)`** added: full-screen overlay with DBS Bank wire details, deal-specific payment reference (ACP-[TICKER]-HFO-2026), important notes, contact details, and Download PDF placeholder. Responsive table collapses on mobile below 520px. Back button removes overlay.
- New CSS classes: `pos-card-close`, `closing-stage-chip`, `ps-close`, `wiring-cta`, and full `ci-*` block for the closing instructions overlay.

### `advisor-portal.html`
- **d8 (Clearwater Credit Partners III)** added to advisor `DEALS` mock array in `close` stage with full documents, closing_docs, dataroom, and activity arrays.
- **Banking Details section** added to `renderMaterials()` — appears when `d.stage === 'close'` or `'realized'`. Two sections: Section A (Capital Receipt / Deployment) and Section B (Distribution Account / Exits). Section B has a "Same as Capital Receipt account" checkbox that copies and locks Section A values.
- **`saveBankingDetails()`** reads all fields and persists to `d.banking` on the in-memory deal object; toasts confirmation.
- **`toggleSameAccount()`** handles the same-account checkbox: copies Section A into Section B, toggles opacity/pointer-events.
- New CSS block: `.banking-section`, `.banking-form`, `.banking-field`, `.banking-label`, `.banking-input`, `.banking-save-btn`, `.bk-mono`, `.banking-same-label`, `.banking-section-lbl`, `.banking-note-sub`.

---

## [2026-05-01] — Admin Overview dashboard: scrollable queue columns, New Deals label, sign-up access panel, richer visuals

### `admin-portal.html` — `renderOverview()`, `renderKPIs()`, CSS
- **Action queue columns now scroll:** `.ov-col-body` has `max-height:380px; overflow-y:auto` — each column caps at ~380px and scrolls internally instead of pushing the page down.
- **"Pending Review" renamed to "New Deals":** column title and card tags updated; meta text now clarifies these are advisor submissions awaiting AI generation + review.
- **Overview header bar:** thin row above the queue showing today's date (long format) and a live "X actions require your attention" / "All clear" summary with an amber pulse dot.
- **KPI top-border accent:** moved the accent line from the bottom to the top of each tile for stronger visual hierarchy (gold/amber/green).
- **KPI count-up animation:** integer KPI values animate from 0 on each render via a cubic-ease `requestAnimationFrame` loop (600ms). Currency strings such as "$12M" are intentionally skipped.
- **Stage map connector line:** a faint horizontal rule sits behind the lane headers via a CSS `::after` pseudo-element. Lanes with a pending IOI show a small amber pulse dot beside their count badge.
- **IOI Intelligence sparklines:** each deal row now renders a CSS-only mini bar chart (up to 6 bars, height proportional to IOI amounts) above the meta pills.
- **Activity feed:** rows have a 2px coloured left border by activity type (gold=IOI, amber=submit, blue=stage change, green=push) plus alternating row tint.
- **Sign-up access cycle panel:** two-column grid below the bottom panels — "Advisor Access" and "Investor Access" — each in a standard `.ov-panel` with fixed max-height and internal scroll. Rows show a green/amber status dot, name, firm/type, date, and a pill badge. Backed by `MOCK_ADVISORS` / `MOCK_INVESTORS` defined inline in `renderOverview`.
- **Panel headers enhanced:** `.ov-panel-hd` now supports a secondary right-aligned subtext (`ov-panel-hd-sub`) showing event count or grouping label.

---

## [2026-05-01] — Admin portal: Add Deal wizard panel + IOI detail slide-in + table fix

### `admin-portal.html`
- **Add Deal panel:** full-screen slide-in (`#admin-deal-panel`) accessible from a gold "+ Add Deal" button in the Deal Pipeline header. Collects company info, asset class, deal economics (IRR, hurdle, term, allocation, ticket, closing date). On submit, POSTs to `/api/advisor/deals`, pushes deal into `NEW_SUBMISSIONS`, and navigates to Deal Studio.
- **IOI Detail panel:** full-screen slide-in (`#ioi-detail-panel`) opened by clicking any investor name in the IOI queue. Shows amount, 8-field meta grid, 4-step status timeline, investor note, deal context cards. Sticky action strip renders Approve/Decline (pending), Push to Advisor Package (approved), or status message. `approveFromDetail` / `declineFromDetail` delegate to existing `actIoiQueue`.
- **IOI table alignment fix:** converted `.ioi-table` / `.ioi-row` to CSS `display:table` / `display:table-cell` so columns align correctly. Added avatar initial bubble (`.ioi-row-init`) and Date column. Header updated to match (Type · Geography, Date, removed right-align on Actions).

---

## [2026-05-01] — Admin Overview: luxury command-centre dashboard redesign

### `admin-portal.html`
- **3-column Action Queue:** Pending Review (new advisor submissions → AI generate button), IOI Decisions (approve/decline per investor), Ready to Push (approved IOIs with push-to-advisor action). Each column has a colour-coded dot (amber/gold/violet), badge count that highlights gold when items exist, and "No items — all clear" empty state.
- **5-tile KPI strip:** Capital Indicated, Investor Indications (amber alert when pending), New Submissions, Ready to Push, Actions Required. Each tile has a coloured accent line at the base (amber/gold/green) that conveys status at a glance.
- **Deal Stage Map:** 5-lane horizontal grid (Review → Live → DD → Close → Realized) showing all active deals as clickable chips. Each chip shows ticker, deal name, and IOI aggregate. Clicking navigates to the deal in the Pipeline tab.
- **IOI Intelligence panel:** Per-deal gold fill-bar showing subscription % with pill counts for pending and declined IOIs.
- **Platform Activity feed:** Icon-badged timeline with per-event type colour coding (IOI gold, submit blue, push violet, stage green, review grey).

- `admin-portal.html`: added ~90 lines of new CSS for overview dashboard components (`ov-queue-grid`, `ov-queue-col`, `ov-lane`, `ov-deal-chip`, `ov-bottom-grid`, `ov-panel`, `ov-at-*`, `ov-intel-*`, enhanced `kpi-card` accent lines)
- `admin-portal.html`: updated `.kpi-strip` grid to 5 columns at `>=1024px`, 3 columns at `>=640px`
- `admin-portal.html`: rewrote `renderKPIs()` — 5 tiles (Capital Indicated, Investor Indications, New Submissions, Ready to Push, Actions Required) with colored accent bar via `kpi-alert`/`kpi-gold`/`kpi-green` modifier classes
- `admin-portal.html`: rewrote `renderOverview()` — 3-column action queue, 5-lane stage map with deal chips, Platform Activity feed with icon badges, IOI Intelligence panel with fill-bar allocation tracking

## [2026-05-01] — Admin portal: dark mode default, double-unit fix, pre-committed capital field

- `admin-portal.html`: defaulted `data-theme` to `dark`; updated theme-btn icon to match; added `localStorage` persistence to `toggleTheme()`; added IIFE at top of `<script>` to restore saved theme on load
- `admin-portal.html`: fixed `renderLRPreview()` double-unit bug — `_cleanNum()` strips non-numeric chars before parsing IRR/hurdle/term fallback strings from deal data
- `admin-portal.html`: `renderLRPreview()` now reads `lr-pre-committed` input and factors it into `ioi_agg`; IOI bar copy changed from "subscribed" to "indicated"; shows remaining open allocation in gold
- `admin-portal.html`: added Pre-Committed Capital input field in Review & Launch right column (below Min Ticket); wired into `openLaunchReview()`, `updateLaunchPreview()` summary label, and `confirmPublish()` payload as `pre_committed`

## [2026-05-01] — Admin Review & Launch: full-fidelity investor preview with return chart

### `admin-portal.html`
- **Return Profile section (Edit Content tab):** New `lr-section` block with three numeric inputs — Target IRR (%), Hurdle Rate (%), Term (months). Wired to `oninput="updateLaunchPreview()"`. Includes a live mini-chart preview (`#lr-rp-chart-preview`) showing MOIC/exit value (PE) or annual income/hurdle (yield) as fields are typed.
- **`openLaunchReview()` auto-populate:** After stats population, reads `deal.target_irr`, `deal.hurdle`, `deal.term_months` (with fallbacks) into the three new return profile inputs.
- **`renderLRPreview()` full rewrite:** Investor Preview tab now renders the complete investor portal layout — deal logo chip, asset class badge, geography/structure, serif deal name, thesis block, highlight cards grid, asset-class-aware return chart (PE: 3-scenario Conservative/Base/Upside grid + year-by-year value path table; credit/infra/RE: income bar chart with hurdle line), deal stage timeline, document slots grid (4 slots, opacity-dimmed if not uploaded), and a sticky right-column stats grid (6 cells: IRR, Term, Min Ticket, Allocation, Hurdle, Closing countdown) + IOI flow placeholder with subscription bar.
- **`updateLaunchPreview()` mini-chart refresh:** Appended return profile mini-chart logic — live MOIC/exit calculation (PE) or annual income (yield) displayed in the Edit Content tab as the operator types, before switching to the full preview.
- **CSS:** Added `.eq-scenarios`, `.eq-sc`, `.eq-sc.is-base`, and all `.eq-sc-*` label classes to match the investor portal PE return chart styles.

---

## [2026-05-01] — Return calc by asset class, IOI confirmation + lobby return, API error fix

### `investor-portal.html`
- **Asset-class-aware return chart:** `buildReturnChart(d)` now branches on `asset_class`. PE/equity deals render a 3-scenario grid (Conservative/Base/Upside) with IRR %, MOIC, and exit value on $500K, plus a year-by-year value path table (Yr 1–5) with animated progress bars and MOIC column. Scenarios derived from `target_irr`: Conservative = 60% of target, Base = target, Upside = 135% of target. Credit/infra/RE keep the existing income bar chart (RE label updated to "Distribution & Return Scenarios").
- **Equity IOI estimate:** `syncSlider()` now shows projected exit value (`amount × MOIC at full hold`) for PE deals; income/yr for yield-generating deals. IOI est label dynamically reads "Projected exit value (Nyr base hold)" vs "Est. annual income at base case IRR".
- **IOI submission fix:** `submitIoi()` no longer hard-stops on all API errors. Only "already submitted" triggers an error bail. Other failures (e.g., unpublished test deals returning "Deal not available") let the local mock flow complete.
- **IOI confirmation screen:** After successful submission, `showIoiConfirmation(d, amt)` replaces the deal detail panel with a full-screen serif confirmation: deal name, indicated amount, submission date, 3-step pipeline (Admin Review → Advisor Notification → DD Access), and two CTAs — "Return to Marketplace" (closes deal panel + navigates to lobby) and "View My Portfolio".

### `investor-portal.html`
- **`buildReturnChart(d)`:** Asset-class–aware chart function. For `pe` deals: renders 3-scenario grid (Conservative / Base / Upside) with IRR, MOIC, and exit value on $500K, plus a year-by-year value path table with animated gold bar fills. For all other classes (credit, infra, RE): renders the existing bar chart (income scenarios + hurdle line), with RE getting a "Distribution & Return" label.
- **`showIoiConfirmation(d, amt)`:** Replaces the deal detail panels after IOI submission. Renders a full-width serif confirmation with deal name, submitted amount, date, and a 3-step next-actions timeline (Admin review → Advisor notification → DD access). Includes "Return to Marketplace" and "View My Portfolio" CTAs.
- **`syncSlider` (inside `openDeal`):** PE deals now show projected exit value (`fmFull(amount × MOIC) at Nyr`) instead of annual income; non-PE deals unchanged.
- **IOI est label:** Dynamically shows "Projected exit value (Nyr base hold)" for PE deals vs "Est. annual income at base case IRR" for yield deals.
- **Return chart animation:** PE branch animates `.vp-bar-fill` widths via `data-pct`; non-PE branch null-checks all DOM ids before setting (safe for both paths).
- **`submitIoi`:** API errors only hard-stop on "already submitted" — other backend errors (e.g. deal not yet published) let the mock flow proceed. Post-submit now calls `showIoiConfirmation` instead of the old inline right-panel rewrite.

---

## [2026-05-01] — Investor portal: doc gating, IOI slider UX

### `investor-portal.html`
- **Doc visibility gating:** Before an investor has submitted an IOI (`PORTFOLIO.some(p => p.deal_id === id)`), only the NDA Template is shown in the documents section. All other docs (Management Presentation, Financials, Term Sheet) are hidden until after IOI submission. A note below the doc grid explains what unlocks after submitting.
- **IOI slider range:** Fixed $100K–$5M universal range replacing per-deal `min_ticket`/`target_alloc` dynamic range. Slider step is $100K throughout.
- **IOI amount formatting:** Input changed from `type="number"` to `type="text" inputmode="numeric"`. Added `fmtAmtInput(el)` and `readAmt(el)` helpers (mirrors advisor portal pattern). Input shows comma-formatted values live; `readAmt` strips commas before parsing. Slider→input sync now writes formatted value.
- **`submitIoi` validation:** Reads amount via `readAmt()`; minimum check is flat $100K instead of per-deal `min_ticket`.

---

## [2026-05-01] — Admin portal platform params input formatting

### `admin-portal.html`
- Added `fmtAmtInput(el)` and `readAmt(el)` helpers adjacent to `fmU` — format thousands on input, strip commas on read.
- Platform Allocation and Platform Min Ticket inputs in pending deal cards changed from `type="number"` to `type="text" inputmode="numeric"` with `oninput="fmtAmtInput(this)"` so values display with comma separators.
- `savePlatformParams` now uses `readAmt()` instead of `parseInt(…value)` to correctly strip commas before posting to the API.

---

## [2026-05-01] — Advisor wizard amount field formatting

### `advisor-portal.html`
- Added `fmtAmtInput(el)` and `readAmt(el)` helpers after `fmU` — format thousands on keyup, strip commas on read.
- Wizard step 2 alloc and min-ticket inputs changed from `type="number"` to `type="text" inputmode="numeric"` with live `oninput` formatting and comma placeholders.
- `wizSubmit()` reads both fields via `readAmt()` instead of `parseInt()` so comma-formatted values parse correctly.

---

## [2026-05-01] — Six investor/admin portal fixes

### `investor-portal.html`
- **Fix 1 — hurdle field normalisation:** `adaptDeal()` now maps `hurdle: d.hurdle || d.hurdle_rate || 8` so API deals using `hurdle_rate` (underscore) display correctly in the stat grid and return chart hurdle line.
- **Fix 2 — real API docs in deal detail:** `openDeal()` is now `async`. Fetches document metadata from `resource=inst&op=inst-deal-docs` before rendering. Falls back to four static placeholder slots if the API returns nothing. NDA state from the API (`nda_signed`) is merged into local `ndaSigned` map so re-renders are consistent. Added `viewInvestorDoc(dealId, slot)` that fetches binary from `resource=admin&op=deal-docs` and opens it in a new tab.
- **Fix 3 — NDA sign recorded via API:** `signNda()` is now `async`. On NDA acceptance, fires `POST resource=inst&op=record-nda` (fire-and-forget, does not block UI). All existing re-render and toast logic preserved.
- **Fix 4 — preview-mode deals filtered from marketplace:** `initLobby()` now pre-filters `DEALS` to `publicDeals` (excludes `launch_mode === 'preview'`). Featured deal and deal grid both derived from `publicDeals`.

### `admin-portal.html`
- **Fix 5 — highlights format in Deal Studio fallback mocks:** All hardcoded highlight arrays in `showAIOutput()` (both the generic deal fallback and the Pacific Bridge fallback) now use `{icon, s, b}` object format. `buildHighlightRow()` updated to flatten objects to `"s — b"` string for the editable input field. Highlights rendering in the AI output panel handles both string and object formats via inline ternary.
- **Fix 6 — Investor Preview tab in Review & Launch panel:** Added `.lr-tabs` tab strip below the header with "Edit Content" and "Investor Preview" tabs. Existing two-column edit layout wrapped in `#lr-edit-view`. Added `#lr-preview-view` pane with full investor-facing deal preview. Added `switchLRTab(tab)` and `renderLRPreview()` functions — preview reads live field values from the edit form. Panel always opens on Edit tab.

---

## [2026-05-01] — Highlights schema, NDA ops, investor doc gate, launch_mode filter

### `api/v2.js`

**Fix 1 — `ai-generate` op: highlights as structured objects**
- Updated Claude prompt to request highlights as `{icon, s, b}` objects instead of plain strings. Each item has a diamond icon, a short bold title (4-6 words), and a one-sentence body.
- Replaced `if (!apiKey) return bad(...)` hard error with a structured mock fallback that returns realistic `{icon, s, b}` highlights, tagline, thesis, and stats derived from the deal record. Mock response includes `mock: true` flag so callers can detect it.

**Fix 2 — `publish-deal` op: normalise highlights on save**
- Added `normHighlights` normalisation step before persisting highlights. Plain strings are split on ` — ` and converted to `{icon, s, b}` objects. Structured objects are passed through unchanged. Older deals posted from the admin UI before the schema update are handled transparently.

**Fix 3 — New `record-nda` POST op (resource=inst)**
- Records investor NDA acceptance to `nda_signed:{inst_id}:{dealId}` in KV with timestamp and IDs. Auth-gated to valid `prism_inst` cookie.

**Fix 4 — New `check-nda` GET op (resource=inst)**
- Returns `{signed, signed_at}` for a given investor + deal combination. Auth-gated to valid `prism_inst` cookie.

**Fix 5 — New `inst-deal-docs` GET op (resource=inst)**
- Serves document metadata (not binary content) to approved investors. Documents in slots `mgmt`, `fin`, `term` require NDA signature (`gate: 'nda'`); the NDA template itself is `gate: 'public'`. Returns `accessible` boolean per doc based on live NDA state.

**Fix 6 — Marketplace `launch_mode` filter**
- Non-admin users (investors, advisors) now only see deals where `member_visible && stage === 'live' && launch_mode !== 'preview'`. Deals with null/undefined `launch_mode` (older records) are included — the filter only excludes the explicit `'preview'` value. Admins continue to see all live deals unfiltered.

---

## [2026-05-01] — Wizard field IDs, Company Overview, Hurdle Rate, admin platform params UI

### `advisor-portal.html`
- Step 1: Added `id` attributes to all existing fields (`wiz-name`, `wiz-asset-class`, `wiz-structure`, `wiz-geography`, `wiz-thesis`). Added new "Company Overview" textarea (`id="wiz-company-overview"`) between Geography and Deal Thesis with instructional hint text.
- Step 2: Added `id` attributes to all existing fields (`wiz-irr`, `wiz-term`, `wiz-alloc`, `wiz-min-ticket`, `wiz-closing`). Added new "Hurdle Rate (%)" field (`id="wiz-hurdle"`). Rearranged layout into three clean 2-column rows: IRR/Term, Allocation/Min Ticket, Hurdle Rate/Closing Date.
- Added `.field-hint` CSS class for helper text below textareas.

### `admin-portal.html`
- Pending submission cards: Added company overview blurb (`ds-overview`) below card header — shows `company_overview || mk_notes`, clamped to 3 lines.
- Pending submission cards: Renamed "Allocation" stat label to "Capacity" to distinguish advisor-stated capacity from platform allocation.
- Pending submission cards: Added inline "Platform Parameters" admin section (`ds-admin-params`) between stats row and docs row — lets admin set `platform_alloc_usd` and `platform_min_ticket_usd` before sending to Deal Studio, with "Save Parameters" button and confirmation flash.
- Added `savePlatformParams(dealId)` function — POSTs to `resource=admin&op=set-platform-params`, updates local `NEW_SUBMISSIONS` state, shows confirmation toast.
- Added CSS for all new components: `.ds-overview`, `.ds-admin-params`, `.ds-param-*` family.

## [2026-05-01] — Deal wizard field capture fix + platform params op

### `advisor-portal.html`
- Replaced positional `querySelectorAll` selectors in `wizSubmit()` with ID-based reads (`wiz-name`, `wiz-asset-class`, `wiz-structure`, `wiz-geography`, `wiz-company-overview`, `wiz-thesis`, `wiz-alloc`, `wiz-irr`, `wiz-term`, `wiz-hurdle`, `wiz-min-ticket`, `wiz-closing`). Asset class now maps display labels to internal codes (`Infrastructure` → `infra`, etc.) instead of always sending `'credit'`. Geography and all new fields are captured correctly.

### `api/_lib/deal-storage.js`
- `createDeal()`: added `company_overview`, `platform_alloc_usd: null`, `platform_min_ticket_usd: null` to the deal object. `closing_date` now also accepts `data.closing` as fallback. Removed the duplicate `hurdle_rate` (was already present — no change needed).
- `updateDeal()` allowed fields list: added `company_overview`, `platform_alloc_usd`, `platform_min_ticket_usd`, `admin_notes` so these fields can be patched via the standard update path.

### `api/v2.js`
- Added `resource=admin&op=set-platform-params` POST handler (admin auth required). Accepts `dealId`, `platform_alloc_usd`, `platform_min_ticket_usd`, `admin_notes`. Validates admin auth, loads deal, applies non-null positive numbers to platform override fields, sets `admin_notes` if provided, appends audit log entry `'Platform parameters set by admin'`, saves, returns `{ ok, deal: { id, platform_alloc_usd, platform_min_ticket_usd } }`. Placed before `publish-deal` op.
- `deal-detail` op: `enriched` object now explicitly includes `platform_alloc_usd`, `platform_min_ticket_usd`, `company_overview`, `admin_notes` — these were previously only present if they happened to be on the deal record via the `...deal` spread; now they are always returned with safe defaults.

## [2026-05-01] — Review & Launch panel (Deal Studio → Investor Portal)

### `admin-portal.html`
- Added full-screen slide-in `#launch-review-panel` (z-index 300, same pattern as `#deal-detail-panel`). Inserted before `<div class="toast">`.
- Added 50+ CSS rules under `/* LAUNCH REVIEW PANEL */`: `.lr-header` (sticky), `.lr-cols` (60/40 split), `.lr-section`, `.lr-tagline-field`, `.lr-thesis-field`, `.lr-highlight-row`, `.lr-hl-input`, `.lr-add-highlight`, `.lr-stats-grid`, `.lr-stat-chip`, `.lr-preview-card`, `.lr-preview-bar` (per asset class), `.lr-mode-card` / `.lr-mode-card.selected`, `.lr-date-row`, `.lr-cb-list`, `.lr-ticket-wrap`, `.lr-checklist-item`, `.lr-check-ok`, `.lr-check-warn`, `.lr-publish-btn`.
- Added module-level vars `_launchDeal`, `_launchContent`, `_launchMode` at top of script.
- Added JS functions: `openLaunchReview(deal, content)`, `closeLaunchReview()`, `selectLaunchMode(mode)`, `handleAllSegments(cb)`, `buildHighlightRow(text, num)`, `addHighlight()`, `removeHighlight(btn)`, `updateLaunchPreview()`, `buildLaunchChecklist(deal, content)`, `confirmPublish()`.
- `showAIOutput()`: stores `_launchDeal`/`_launchContent` before setting `panel.innerHTML`, so the Review & Launch button closure references the correct deal regardless of subsequent calls.
- Replaced "Apply to Investor Portal →" button with "Review & Launch →" calling `openLaunchReview(_launchDeal, _launchContent)`.
- `confirmPublish()`: reads all editable fields, validates (tagline required, thesis required, min 3 highlights), POSTs to `POST /api/v2?resource=admin&op=publish-deal`, on success updates local DEALS array (stage='live', featured flag), re-renders overview/pipeline/KPIs, shows toast. On API failure falls back to local-only update and shows informational toast.

---

## [2026-05-01] — publish-deal endpoint + ai-generate draft persistence

### `api/v2.js`
- Added `publish-deal` POST op under `resource=admin` (admin auth required). Accepts `dealId`, `tagline`, `thesis`, `highlights`, `stats`, `launch_mode` (`featured`/`listed`/`preview`), `open_date`, `close_date`, `target_segments`, `featured`, `min_ticket`. Sets `stage: 'live'` and `member_visible: true`, merges content fields, de-features all other live deals when `launch_mode === 'featured'`, appends audit log entry, and returns `{ ok, deal: { id, name, stage, launch_mode, featured } }`.
- Updated `ai-generate` op: after a successful Claude response, persists `deal.ai_draft = { tagline, thesis, highlights, stats, generated_at }` to the deal record via `saveDeal` so the Review & Launch panel can reload it without re-running AI.
- Updated `tacc-feed` deal projection to include `tagline`, `thesis`, `stats`, `launch_mode`, `featured`, `target_segments`, `open_date` — all new published fields flow to TACC bridge consumers.
- `deals` and `marketplace` GET handlers already return full deal objects via spread; no additional changes needed — new fields flow through automatically.

---

## [2026-05-01] — Push preview modal redesign (deal brief layout)

### `admin-portal.html`
- Replaced all `.push-preview-*` and `.push-confirm-btn` CSS (9 rules) with 42 new `.pp-*` classes: `pp-modal-box`, `pp-header`, `pp-wordmark`, `pp-wm-*`, `pp-deal-block`, `pp-capital-block`, `pp-breakdown`, `pp-breakdown-col/row/fill`, `pp-confidential`, `pp-next-step`, `pp-already-pushed`, `pp-comment`, `pp-footer`, `pp-cancel-btn`, `pp-confirm-btn`
- Modal container changed from `modal-box` (max-width 480px, padded) to `pp-modal-box` (max-width 680px, padding 0 — sections own their own padding)
- `showPushPreviewModal()` rebuilt: letterhead header with wordmark + date + stage badge, serif italic deal name, gold hero capital amount, two-column composition/geo breakdown with proportional fill bars, confidential strip, recommended-action box, optional-push warning, and comment textarea
- `confirmPushPackage()` now reads `#pp-comment-input` and passes `comment` in POST body alongside `dealId`

## [2026-05-01] — push-package admin comment + polished IOI email template

### `api/v2.js`
- `push-package` op now reads `comment` from `req.body` (line 826: `const { dealId, comment } = req.body || {}`)
- `pkg.admin_comment` set to `comment || ''` — persisted with the package record in KV
- Advisor email notification block now builds `geo_breakdown` array (parallel to existing `type_breakdown`) and fetches `adv.name` / `adv.firm_name`
- `sendIoiPackage` call refactored from 3-arg `(email, name, stats)` to single data object with all fields including `admin_comment`

### `api/_lib/email.js`
- `sendIoiPackage` signature changed to `(data)` — single object, no more positional args
- Full email rebuilt as a standalone HTML document (table-based, all inline styles, no `<style>` block)
  - Dark header: italic "AURUM" wordmark + "PRISM · PRIVATE DEAL PLATFORM" + "IOI PACKAGE" badge + date
  - Deal name in Georgia italic + "Prepared for [name] · [firm]" subtitle
  - Gold-bordered centrepiece block: total indicated capital, approved count, % of target, target allocation
  - Side-by-side composition tables: By Investor Type / By Geography
  - Compliance note (left-border rule)
  - Conditional admin comment section with gold left border (only rendered when `data.admin_comment` is non-empty)
  - CTA: "View in Advisor Portal →" linking to `${SITE}/advisor-portal`
  - Footer: Package ID + boilerplate

---

## [2026-05-01] — Admin deal detail: rich IOI summary + push-package preview modal

### `admin-portal.html`
- **IOI Summary section** in `buildDealDetailHTML()` replaced with a four-part block:
  - Stats bar (4 `.ddp-metric` cards in `ddp-ioi-stats` grid): Total Indicated, Approved Capital, # Investors, Pending — computed live from `deal.iois`
  - Funnel row (`.ddp-funnel`): Views/NDAs shown with `.muted` class and `~` prefix; IOIs, Approved, Pushed use real data and `.real` gold border
  - Breakdown cards (`.ddp-breakdown-row`): By Investor Type and By Geography, grouped + summed client-side; graceful empty state when `deal.iois` is absent
  - Full IOI table (`ddp-ioi-table-full`, 6 columns): Investor · Type/Geo · Amount · Status · Submitted · Actions. Pending rows get Approve + Decline buttons calling existing `actIoi()` then re-calling `openDealDetail()`; settled rows show badge only
- **`pushPackage(dealId)`** — now fetches push-preview first; falls back to local `DEALS` state; guards against zero approved IOIs
- **New `showPushPreviewModal(preview)`** — opens `#push-preview-modal` with deal/advisor, approved capital block, composition, geographies, disclosure note, conditional already-pushed warning
- **New `confirmPushPackage(dealId)`** — actual POST, marks local IOIs pushed, closes modal, refreshes queue/overview/detail panel
- **New `closePushPreviewModal()`** — hides overlay; overlay-click listener wired
- **New CSS block**: `ddp-ioi-stats`, funnel classes, breakdown classes, push-preview classes, `ddp-ioi-table-full`
- **Modal HTML**: `#push-preview-modal` added before `#toast`, reusing `.modal-overlay` / `.modal-box`

---

## [2026-05-01] — IOI seeding, deal-detail iois array, push-preview op, push-package email

### `api/_lib/deal-storage.js`
- **`seedDeals()`** now calls `seedIois()` after deals are written so a single seed run populates both.
- **New export `seedIois()`** — writes 4 IOI records per active deal (2 approved, 1 pending, 1 rejected) using realistic investor names and amounts. Skips any IOI that already exists in Redis. Bridgeford (not member_visible) intentionally excluded. IOI status values use `'rejected'` to match what `reject-ioi` writes, keeping `deal-detail` summary counts correct.

### `api/v2.js`
- **`deal-detail` op** — now returns full `iois` array alongside existing `ioi_summary`. Each row includes `id`, `investor_firm`, `institution_type`, `geo`, `amount`, `status`, `submitted_at`, `pushed`, `data_room_access`.
- **New op `push-preview`** (`GET ?resource=admin&op=push-preview&dealId=xxx`) — returns aggregate push package preview: approved count, total, pct of target, type breakdown, geo breakdown, `alreadyPushed` flag, suggested action. No investor names included (compliance boundary).
- **`push-package` op** — after persisting the package, attempts to email the deal's advisor via new `sendIoiPackage()`. Aggregate stats only (no investor names). Wrapped in try/catch — email failure does not block push success.

### `api/_lib/email.js`
- **New export `sendIoiPackage(advisorEmail, dealName, stats)`** — sends "New IOI Package — [Deal Name]" email to advisor with approved count, indicated total, % of target, and type breakdown table.

## [2026-05-01] — Admin deal detail panel: full-screen tear sheet with Prism economics

### `admin-portal.html`
- **New panel** `#deal-detail-panel` — `position:fixed;inset:0;z-index:300`, slides in from the right on `.ddp-open` (translateX CSS transition, 320ms ease). Sits above all portal views without disrupting existing layout.
- **Panel HTML** inserted between the `view-aitool` section and the existing stage-advance modal.
- **CSS block** `/* ── DEAL DETAIL PANEL ── */` added before mobile media queries: panel, grid, metrics, allocation bar, IOI table, documents, audit log, Prism economics card, deal controls card, advisor card, row hover cursor styles.
- **`renderPipeline()`** — each `.dp-row` now has `onclick="openDealDetail('${d.id}')"`. The actions column uses `event.stopPropagation()` so stage-advance buttons do not also trigger the panel. `dp-row:not(.header)` gets `cursor:pointer` via CSS.
- **New functions (all new):**
  - `openDealDetail(dealId)` — shows panel, fetches `/api/v2?resource=admin&op=deal-detail`, falls back to `buildMockDealDetail()`, calls `buildDealDetailHTML()`, animates allocation bar.
  - `closeDealDetail()` — removes `.ddp-open`, hides panel after 320ms.
  - `buildMockDealDetail(dealId)` — builds a rich detail object from the in-memory `DEALS` array including ioi_summary counts, mock audit log, and computed Prism economics projections.
  - `buildDealDetailHTML(deal)` — returns the two-column HTML string: left (deal header, metrics grid, allocation bar, description, IOI table, documents, audit log) and right (Prism economics card with inline edit, deal controls card, advisor card).
  - `toggleEconEdit()` — toggles between display and edit modes in the economics card.
  - `savePrismEconomics(dealId)` — reads three % inputs, updates local `DEALS` state, POSTs to `op=update-prism-economics`, re-opens panel to reflect saved values.
- **Reused functions (no changes):** `viewDoc()`, `dealAction()`, `pushPackage()`, `openModal()`, `fmU()`, `toast()`, `fetchSilent()`, `STAGE_ORDER`, `STAGE_LABELS`, `STAGE_CHIP`.

## [2026-05-01] — Admin deal-detail API: enriched deal view + Prism economics CRUD

### `api/v2.js`
- **New op** `GET ?resource=admin&op=deal-detail&dealId=xxx` — returns full deal record enriched with IOI summary (total/approved/pending/declined counts, approved total USD, % subscribed), document slot metadata, advisor name/firm/email, computed Prism economics projections, and last 10 audit log entries (newest first).
- **New op** `POST ?resource=admin&op=update-prism-economics` — body `{ dealId, fee_pct, carry_pct, mgmt_fee_pct }`. Validates inputs as numbers, writes `prism_fee_pct` / `prism_carry_pct` / `prism_mgmt_fee_pct` to the deal, appends `prism_economics_updated` audit log entry with before/after values, returns `{ ok: true, deal }`.

### `api/_lib/deal-storage.js`
- Added `prism_fee_pct: 1.5`, `prism_carry_pct: 10`, `prism_mgmt_fee_pct: 0.5` to all five seed deals. Existing Redis records fall back to these same defaults at read time via `??` operator — no migration required.

## [2026-05-01] — Universal brand wordmark rollout across all 5 portals

### `index.html`, `admin-portal.html`, `advisor-portal.html`, `investor-portal.html`, `login.html`
- **Replaced** all Au seal + plain text logo instances with the locked two-line split wordmark: "A TACC Platform" label (6px muted mono) above "AURUM | PRISM" (13px mono, `--text` / 1px gold rule / `--gold`).
- **index.html hero eyebrow** — scaled up from `clamp(26px,3vw,36px)` → `clamp(32px,3.5vw,46px)`, letter-spacing `.28em` → `.26em`, rule height and margin enlarged, `.hero-eyebrow-rule` widened from 40px to 56px.
- **index.html nav** — removed `.n-seal` + `.n-brand`; added `.n-wordmark` block with `margin-right:auto` to hold left alignment against the link group.
- **Admin, advisor, investor portals** — removed `.nav-mark`, `.nav-brand-name`, `.nav-brand-tag`; added `.nav-wordmark` / `.nav-wm-*` classes.
- **login.html** — removed `.ts-seal`, `.ts-brand`; added `.ts-wordmark` / `.ts-wm-*` classes.
- CSS variable used for gold rule: `--goldBd` (index.html, login.html) · `--gold-bd` (admin, advisor, investor portals).

## [2026-05-01] — Hero eyebrow: replace italic serif lockup with mono split-wordmark

### `index.html` — `.hero-eyebrow`, `.hero-eyebrow-presents`, `.hero-eyebrow-name`
- **Removed** italic Cormorant Garamond `.hero-eyebrow-name` — the large italic serif read as letterhead, not product identity.
- **Replaced** with Option B split-wordmark: "AURUM" in `var(--text)` mono caps + 1px gold vertical rule + "PRISM" in `var(--gold)` mono caps. Both sides `clamp(26px,3vw,36px)`, `letter-spacing:.28em`, weight 400. The two-part brand split communicates product identity at a glance.
- **Changed sub-line** from "TACC Presents" to "A TACC Platform" — less ceremony, more category clarity. Rendered in 7.5px muted mono above the wordmark.
- **Added** `.hero-eyebrow-rule` — a 40px × 1px gold rule below the wordmark separating the lockup from the h1, replacing the old `::before` pseudo-element line.
- **Removed** the old `::before` rule decoration from `.hero-eyebrow-presents`.

## [2026-05-01] — Hero prism: fix rogue diagonal particles, align connectors to base vertices

### `index.html` — SVG animated circles, `.hero-prism-scene`, `.hp-side`, `.hp-flow-line`
- **Removed 3 SVG `<circle>` "deal flow particles"** that animated diagonally from (40,10)→(200,130) and (55,0)→(200,130). These read as a random broken diagonal streak; removed entirely.
- **Added base-travel animation** along the prism's bottom edge (52,264)→(348,264): a dashed baseline stroke, a gold arrowhead polyline at the right vertex, and a gold dot that travels left-to-right at 2.8s ease-in with opacity and radius breathing. Communicates "deals enter left → capital exits right" unambiguously.
- **Changed `.hero-prism-scene` `align-items` from `center` to `flex-end`** — side text blocks now hang at the bottom of the flex container, aligning with the prism base vertices rather than floating at mid-height.
- **Added `padding-bottom:14%` to `.hp-side`** — shifts the connector lines down so they meet the prism at vertex height (~56px from bottom of 320px SVG).
- **Updated `.hp-flow-line` gradients** — left line: `rgba(197,165,114,.2)→rgba(197,165,114,.7)` (more opaque at prism edge). Right line: reversed. Both now visually terminate at the prism base corner.

## [2026-05-01] — Hero prism animation overhaul: directionality over float

### `index.html` — `.hero-prism-scene` / `.hp-flow-line` / SVG particles
- **Removed `animation:prismFloat`** from `.hero-prism-scene` — the whole scene no longer bounces. Text labels are now completely static.
- **Removed `@keyframes prismFloat`** entirely.
- **Added `position:relative;overflow:visible`** to `.hp-flow-line` so pseudo-element can escape the 1px line container.
- **Added `.hp-flow-line::after`** — a 5px gold dot (`rgba(197,165,114,.95)`) with a double `box-shadow` glow that animates `left: 0 → calc(100% - 5px)` via `@keyframes dotFlow` (2.6s, ease-in-out, infinite). Fades in at 10% and out at 90% for a clean loop.
- **Added `.hp-side-right .hp-flow-line::after { animation-delay: 1.3s }`** — right connector dot starts 1.3s after the left, reading as "capital flows out after deals flow in."
- **Added `@keyframes dotFlow`** (replaces `prismFloat`).
- **Added 3 SVG `<circle>` beam particles** inside the prism SVG — positioned after the incoming beam `<line>` elements, before the `<polygon>`, so the prism body renders on top as they reach the refraction point. Particles travel `(40,10)→(200,130)` and `(55,0)→(200,130)` at 2.2s / 2.2s+0.85s delay / 2.6s+1.7s delay, with fill-opacity fade in/out. White and gold fills respectively.
- **`prismGlow` on `.hp-prism-wrap` retained** — ambient drop-shadow breathe unchanged.
- **All other SVG animations retained** — `beamPulse`, `raySpectrum`, `vertexGlow`, `particleDrift`, `breatheGlow`.

---

## [2026-05-01] — Admin IOI Queue: deal-grouped view with raise controls and package push

### `admin-portal.html` — IOI Queue tab redesigned
- **Replaced `renderQueue()`** with an async version that calls `GET /api/v2?resource=admin&op=ioi-by-deal`; falls back to building groups from local `DEALS` mock data if the endpoint returns nothing.
- **Added `buildDealGroup(g, gi)`** — renders a three-zone card per deal: header bar (deal name, advisor chip, subscription progress bar with gold fill, raise-status badge), IOI table rows (Investor / Type·Geo / Amount / Status / Approve+Decline), and a footer with Close Raise / Delay / Increase Target controls on the left and a Push Package button on the right.
- **Added `showIncreaseTarget(dealId)` / `commitIncreaseTarget(dealId)`** — toggle an inline input in the footer for entering a new allocation target; calls `dealAction` on confirm.
- **Added `dealAction(dealId, action, params)`** — POST to `deal-action` op; also mutates local `DEALS` state immediately so UI reflects changes before server roundtrip.
- **Added `pushPackage(dealId)`** — POST to `push-package` op; disables the button during the call; marks approved IOIs as `pushed` in local state on success; re-renders queue and overview.
- **Container used:** `id="ioi-queue-content"` (unchanged).
- **`actIoi()` and `actIoiQueue()` preserved** — IOI row actions divs retain `.iqi-actions` class so the existing inline DOM mutation in `actIoiQueue` still works.
- **CSS:** Replaced the old `.ioi-queue-section` / `.iqs-*` / `.iqi-*` block with `.ioi-deal-group`, `.ioi-deal-hd`, `.ioi-sub-bar-track/fill`, `.ioi-table`, `.ioi-row`, `.ioi-deal-footer`, `.ioi-action-btn`, `.ioi-pkg-btn`, `.ioi-raise-status` + badge variants.

---

## [2026-05-01] — Admin IOI workflow: three new backend ops

### `api/v2.js` — added `ioi-by-deal`, `deal-action`, `push-package` ops
- **`GET ?resource=admin&op=ioi-by-deal`** — Returns all deals with their IOIs grouped, including `indicatedTotal`, `pct` of target filled, `approvedCount`, and `approvedTotal`. Fetches all IOIs in one pass and buckets by `deal_id`; resolves advisor display names from KV.
- **`POST ?resource=admin&op=deal-action`** — Applies `close_raise`, `delay`, or `increase_target` mutations to a deal's raise state. Each action appends a typed entry to `deal.audit_log` and persists via `saveDeal()`.
- **`POST ?resource=admin&op=push-package`** — Builds a snapshot package of all approved IOIs for a deal, stores it under `package:{packageId}`, appends the ID to `packages:deal:{dealId}` (JSON array), marks each approved IOI `pushed: true`, and appends a `package_pushed` audit log entry to the deal.
- **Why:** Admin portal deal-grouped IOI queue view and raise-management controls require these ops. Existing per-IOI ops (`approve-ioi`, `reject-ioi`) are untouched.

---

## [2026-05-01]

### Hero-right replaced with animated prism visual
- **What changed:** Removed the two floating preview cards and pill from `.hero-right` on `index.html`. Replaced with a three-column prism scene: left label ("Deals flow in" + deal types), center animated SVG prism (ported from `investor-portal.html` with `lp-` filter ID prefix to avoid cross-page conflicts), right label ("Capital flows on platform" + action verbs). Gold flow-lines connect each label toward the prism edge.
- **CSS added:** `.hero-prism-scene`, `.hp-side`, `.hp-side-right`, `.hp-side-label`, `.hp-side-sub`, `.hp-flow-line`, `.hp-prism-wrap`, `.hp-prism-svg`; keyframes `beamPulse`, `raySpectrum`, `vertexGlow`, `particleDrift`, `breatheGlow`, `prismGlowLP`.
- **CSS removed:** `.preview-stack`, `.preview-card`, `.preview-card::before`, `.preview-pill`, `.preview-pill-dot`, `@keyframes floatA/floatB/floatC`, all `.pv-*` classes (pv-nav, pv-seal, pv-name, pv-tab, pv-body, pv-deal-badge, pv-badge, pv-deal-name, pv-deal-orig, pv-metrics, pv-m, pv-m-l, pv-m-v, pv-alloc, pv-alloc-hdr, pv-bar, pv-fill, pv-foot, pv-foot-cd, pv-ioi-btn, pv-adv-hd, pv-adv-chip, pv-adv-stage, pv-stage-dot, pv-econ-row, pv-econ-lbl, pv-econ-val).
- **Why:** Communicates the Prism value proposition more cleanly — deals enter the prism from the left as a beam, capital flows out on the right as a color spectrum. Removes the template-feeling card mockups in favor of a bespoke branded centerpiece.

---

## [In progress — batch fixes]

### Fix #6 — Pending submission doc badges now open the uploaded file
- **Root cause:** Green doc badges (NDA / Deck / Financials / Term Sheet) in pending submission cards were static `<span>` elements with no click handler.
- **Fix:** Changed present-doc badges to `<button>` elements calling `viewDoc(dealId, slot)`. That function fetches the doc via the existing `deal-docs` endpoint, decodes the base64 to a Blob, and opens it in a new tab via `URL.createObjectURL`. Results are cached per deal so clicking a second doc on the same card skips the network round-trip. Missing-doc badges remain inert grey spans.

### Fix #5 — Real document uploads, admin doc viewer, AI deal profile generation, Active Deals table alignment
- **Root cause:** Advisor wizard used fake upload stubs with no actual file storage. Admin pending submissions showed no docs. AI Doc Tool had 3 slots (missing Term Sheet). Active Deals table columns bled due to `1.4fr` name column with no min-width.
- **Fix — Advisor uploads:** Removed `wizFakeUpload()`. Added `WIZ_DOCS` state and `wizHandleFile(slot, input)` which reads the file via FileReader, base64-encodes it, and POSTs to `/api/upload`. 1.5MB client-side limit enforced. `wizSubmit()` payload now includes `docs` array with slot/name/type metadata.
- **Fix — New `/api/upload` endpoint:** New `api/upload.js` — advisor-authenticated POST. Validates slot (`nda`/`mgmt`/`fin`/`term`), rejects base64 > 2.8M chars. Without a deal ID, stores under `pdoc:${advisorId}:${slot}` (24h TTL) + `pdoc_meta`. With a deal ID, stores directly as `deal_doc:${dealId}:${slot}`. `vercel.json` updated with `/api/upload` rewrite.
- **Fix — Pending doc migration:** `api/_lib/deal-storage.js` `createDeal()` now migrates `pdoc:*` keys to `deal_doc:*` keys after deal creation, so docs uploaded before submission are attached to the deal.
- **Fix — Admin doc viewer:** Pending submission cards now show doc status badges (NDA / Mgmt Pack / Fin Model / Term Sheet) and a "Generate with AI" button that calls `loadDocsAndGenerate(dealId)`.
- **Fix — AI Doc Tool, Term Sheet slot:** Added 4th slot (Term Sheet / `ai-slot-term`) to `AI_DOCS`. `checkAIReady()` requires all 4 before enabling generate. `runAIGenerate(dealId)` auto-fetches docs from `GET /api/v2?resource=admin&op=deal-docs`, calls `POST /api/v2?resource=admin&op=ai-generate`, and renders the Claude-generated profile (tagline/thesis/highlights/stats).
- **Fix — Claude API integration:** `api/v2.js` admin `ai-generate` op fetches all 4 doc slots from Redis, builds PDF document blocks (`anthropic-beta: pdfs-2024-09-25`), calls `claude-sonnet-4-6`, parses JSON from response, returns `{ tagline, thesis, highlights, stats, asset_class, geography }`.
- **Fix — Active Deals table alignment:** `.dp-row` grid changed from `1.4fr 110px 130px 110px 80px auto` to `minmax(160px,1.8fr) 130px 150px 110px 68px 140px` — prevents name column overflow from bleeding into adjacent cells.

### Fix #4 — Hero-right visual overhaul: premium two-card + floating pill layout
- **Root cause:** Card 2 was positioned at `top:200px` — exactly where Card 1 ended — creating a cheap stacked overlap. Both cards were the same width class. Animations (`pf1`/`pf2`) only translated Y on a fixed rotation, no visual depth or contrast between cards.
- **Fix:** Rebuilt the `.hero-right` CSS and HTML entirely.
  - Card 1 (investor marketplace): repositioned to `top:48px; left:0; width:346px; z-index:3; rotate(-1.8deg)` with strong shadow (`0 28px 80px rgba(0,0,0,.8)`) and gold top-edge glow via `::before`. Content updated to real deal: "Clearwater Credit Partners III" with Target IRR 13.5%, 24mo term, $500K min, 68% allocation bar at $19.1M, closes Sep 2026.
  - Card 2 (advisor IOI queue): repositioned to `top:28px; right:0; width:278px; z-index:2; rotate(2.6deg)`, `opacity:.72; filter:blur(.4px)` to push it visually behind. Content replaced with IOI queue — 3 rows (Harrison FO $5M pending, Meridian Capital $8M approved, Alto FO $3.5M approved), $16.5M total footer. Advisor chip shows "Sarah Chen" in purple accent.
  - Added `.preview-pill` floating activity indicator (`z-index:5; top:4px; right:10px`) with pulsing green dot and text "New IOI · $5.0M · Harrison Family Office".
  - Renamed keyframes `pf1`/`pf2` → `floatA`/`floatB`; added `floatC` for the pill (7s, 2s delay, out of phase). Cards maintain their rotation through the full animation cycle.

### Fix #3 — Landing page hero text breaking into 4 lines
- **Root cause:** h1 font-size `clamp(52px,6vw,82px)` was too large for the ~580px hero column. "meet qualified capital." wrapped mid-line, turning 2 intended lines into 4. Also "meet " was white instead of gold — only "qualified capital." was inside the `<em>` tag.
- **Fix:** Reduced h1 to `clamp(42px,4.8vw,64px)`, moved "meet " inside the `<em>` tag, added `display:block` on `em` so line 2 always starts on its own line. Line 1 = white, line 2 = gold.

### Fix #2 — Admin portal completely blank (SyntaxError killed entire script)
- **Root cause:** Stray `)` at end of `adaptDeal()` function (line 451) caused `SyntaxError: Unexpected token ')'`. Browser stops parsing the whole `<script>` block on any syntax error, so zero functions were defined — no KPIs, no views, no tab switching. Nav worked because it's plain HTML.
- **Fix:** Removed the extra `)` from `adaptDeal`. Script now parses fully; mock data renders immediately on load.

### Fix #1 — Admin portal sign-out appears broken
- **Root cause:** On load, if `/api/me` returned unauthenticated, the portal silently kept showing mock data instead of redirecting to `/login`. Sign-out itself worked, but navigating back to `/admin-portal` still rendered the portal — making it look like sign-out did nothing.
- **Fix:** `admin-portal.html` — unauthenticated or wrong-role response now redirects to `/login` instead of falling back to mock data.

---

## 2026-05-01

### Landing page — platform showcase overhaul
- Redesigned platform section with new showcase layout and improved nav structure
- Enhanced landing page visual design (typography, spacing, colour)
- Fixed duplicate "Platform" nav link
- Fixed "Member Login" nav button to route to `/login` instead of apply form

### Auth & routing fixes
- Fixed sign-out 404 — logout now correctly redirects
- Fixed dead login redirects after session expiry
- Auth flow: all portals now redirect to `/login` when session is missing or expired
- After login, users land on their correct portal by role (admin/advisor/investor)

### Portal fixes
- Admin portal blank page fix — mock data rendered synchronously at top level
- Advisor portal: deal scoping fixed (advisors only see their own deals)
- All portals: theme toggles restored, dark mode set as advisor default
- Added Sign Out to both advisor and admin portals
- Fixed theme icon display

### Mobile
- Responsive breakpoint audit across all portals
- Touch targets enlarged, overflow scroll fixed

### Infrastructure
- Removed dead/unused files
- Cleaned up `vercel.json` routing
- Renamed HTML files to portal-named convention (`advisor-portal.html`, `admin-portal.html`, etc.)
- Updated `vercel.json` rewrites to match new filenames

### Test data
- Updated test investor credential to `jwc@theaurumcc.com` / `1234`
- Updated `TESTING.md` with correct URLs, flows, credentials, and env vars

---

## 2026-04-30

### Initial platform build
- Full backend: `api/v2.js` unified handler (auth, deals, IOIs, advisor/investor/admin resources)
- Supporting modules: `auth.js`, `storage.js`, `deal-storage.js`, `email.js`, `http.js`
- Upstash Redis data layer with in-memory fallback
- JWT-based auth with three cookie types: `prism_admin`, `prism_advisor`, `prism_inst`
- Deal lifecycle: review → live/ioi → dd → terms → close → realized/killed
- IOI submission and approval flow with dedup keys
- Advisor password reset via 6-digit code (30-min TTL)
- Email delivery via Resend (`prism@theaurumcc.com`)
- Auto-seeding of test advisors, investors, and deals

### Portals launched
- `login.html` — unified entry point, role-based routing
- `advisor-portal.html` — deal submission wizard, stage tracking, IOI review
- `admin-portal.html` — deal pipeline, IOI queue, institution approvals
- `investor-portal.html` — deal discovery grid, NDA + IOI flow
- `forgot-password.html` / `reset-password.html` / `setup-password.html`
- `index.html` — marketing landing page

### Config
- `vercel.json` — routing rewrites, security headers (CORS, X-Frame-Options, etc.)
- `.env.example` documenting all required env vars
- `TESTING.md` — full test playbook with credentials and pre-launch checklist
