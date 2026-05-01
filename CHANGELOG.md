# Changelog

All website and platform changes are logged here in reverse-chronological order.

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
