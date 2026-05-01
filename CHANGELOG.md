# Changelog

All website and platform changes are logged here in reverse-chronological order.

---

## [In progress — batch fixes]

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
