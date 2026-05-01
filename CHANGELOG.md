# Changelog

All website and platform changes are logged here in reverse-chronological order.

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
