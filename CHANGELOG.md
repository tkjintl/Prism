# Changelog

All website and platform changes are logged here in reverse-chronological order.

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
