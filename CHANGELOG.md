# Changelog

All website and platform changes are logged here in reverse-chronological order.

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
