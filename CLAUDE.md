# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Aurum — Command Center

Two platforms in parallel:
- **Aurum Prism**: invite-only deal-flow platform connecting deal advisors with institutional investors. Operated by TACC Pte Ltd, Singapore. Roles: operator (admin), advisor, investor. Lifecycle: review → live/ioi → dd → terms → close → realized/killed.
- Platform 2: TBD

Non-technical operator. Always summarize in plain English. Bias toward action.

## Agents + default routing

Feature build → spawn @build AND @ui in parallel (backend + frontend simultaneously)
API/external service → @connect
Bug, test, broken thing → @review
Strategy, research, decisions → @strategy
Investor comms, copy, decks → @write

## Rules
- Parallel is the DEFAULT for feature work. Don't ask, just spawn both.
- Each agent is self-sufficient. No handoffs. No waiting for specs.
- Report back in plain English: what was built, what to verify.
- Flag decisions that need operator input. Everything else: make the call.
- **After every change to any HTML, API, or config file, append an entry to `CHANGELOG.md`** — date, what changed, why. One section per session/feature, reverse-chronological order.

---

## Dev Commands

```bash
vercel dev          # local dev server (requires Vercel CLI + .env.local)
git push            # deploys to Vercel automatically (main branch)
```

No build step. HTML/JS files are deployed as-is. `/api/*.js` files become Vercel Functions.

**Health check:** `GET /api/health` → `{ ok: true, kv: "connected" }`

---

## Architecture

**Stack:** Vanilla JS frontend (9 HTML SPAs) + Vercel Functions backend + Upstash Redis

### Frontend

Six role-specific HTML portals — no framework, no build, inline JS+CSS:

| File | Role |
|---|---|
| `login.html` | Entry point for all users |
| `advisor-portal.html` | Deal advisors |
| `admin-portal.html` | Platform operator |
| `investor-portal.html` | Institutional investors |
| `forgot-password.html` / `reset-password.html` / `setup-password.html` | Auth flows |
| `index.html` | Landing page |

After login, users are routed by role: admin → `/admin-portal`, advisor → `/advisor-portal`, investor → `/investor-portal`.

### Backend

**Single unified handler:** `api/v2.js` (all business logic). Routes via query string: `?resource=X&op=Y`.

Resources handled: `advisor`, `advisor/deals`, `inst`, `deals`, `admin`, `marketplace`, `member`

Supporting modules in `api/_lib/`:
- `auth.js` — JWT signing/verification, password reset codes
- `storage.js` — Upstash Redis wrapper with in-memory fallback
- `deal-storage.js` — Deal CRUD, stage transitions, seeding, audit log
- `email.js` — Resend templates for all notification types
- `http.js` — Response helpers, cookie parsing

### Data Layer

Upstash Redis (falls back to in-memory Map on cold start if KV env vars are missing).

Key patterns:
```
deal:{id}                          — deal record
advisor:{id}  /  advisor_email:{email}
inst:{id}     /  inst_email:{email}
ioi:{id}      /  ioi_exists:{dealId}:{investorId}   — dedup key
reset_token:advisor:{email}        — 30-min TTL
deals:index                        — sorted set for deal ordering
```

### Auth

Three JWT cookie types (HttpOnly, SameSite=Lax, Secure in prod):

| Cookie | Role | TTL |
|---|---|---|
| `prism_admin` | Operator | 12h |
| `prism_advisor` | Advisor | 7d |
| `prism_inst` | Investor | 30d |

- **Admin:** credentials in `ADMIN_USERS` env var (`email:password` pairs), no KV lookup
- **Advisor:** KV-stored bcrypt hashes (cost 12)
- **Investor:** access code + optional password

### Deal Lifecycle

```
review → live/ioi → dd → terms → close → realized / killed
```

Every stage transition appends to `deal.audit_log` with actor, timestamp, action, metadata.

### Email (Resend)

From: `prism@theaurumcc.com`. Triggers:
- Advisor created → welcome + temp password
- Deal submitted → advisor confirmation + operator alert (NOTIFY_EMAILS)
- Deal stage change → advisor notified
- IOI approved → investor gets data room access
- Investor approved → access code sent

---

## Environment Variables

Required in Vercel Dashboard → Environment Variables (or `.env.local` for local dev):

| Variable | Notes |
|---|---|
| `PRISM_SECRET` | JWT key — `openssl rand -base64 32` |
| `ADMIN_USERS` | `email:password,email2:password2` |
| `RESEND_API_KEY` | resend.com |
| `KV_REST_API_URL` | Upstash Redis |
| `KV_REST_API_TOKEN` | Upstash Redis |
| `SITE_URL` | No trailing slash (e.g. `https://prism.theaurumcc.com`) |
| `NOTIFY_EMAILS` | Optional — comma-separated operator alert emails |
| `PRISM_TACC_BRIDGE_SECRET` | Optional — HMAC for `/api/deals/tacc-feed` |
| `BOT_MODE` | Optional — set to `1` on bot-test deploys to suppress emails, mock AI scoring, allow rate-limit bypass for admin-driven bot loops |

Missing `KV_*` → data stored in-memory only, lost on cold restart.
Missing `RESEND_API_KEY` → emails logged to console.

---

## Test Credentials

Seed test data first: log in as operator → open `/bot-driver` → click "Reset" → confirm. The button calls `admin&op=sandbox-reset` which wipes and reseeds the platform with bot accounts + sample data.

| Role | Email | Credential |
|---|---|---|
| Operator | set via `ADMIN_USERS` env | password in env |
| Advisor | `sarah@capitalgroup.sg` | `Advisor123!` |
| Investor | `jwc@theaurumcc.com` | `1234` |

Full test flows are in `TESTING.md`.
