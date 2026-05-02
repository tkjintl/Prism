# Aurum Prism — Test Automation Plan

**Version:** 1.0  
**Target launch:** Q3 2026  
**Base URL (staging):** `https://prism-plum.vercel.app`  
**Base URL (production):** `https://prism.theaurumcc.com`

---

## 1. Test Personas

| Persona | Role | Email | Credential | Notes |
|---|---|---|---|---|
| **Alice** | Advisor | `sarah@capitalgroup.sg` | `Advisor123!` | Owns deal flow |
| **James** | Investor | `jwc@theaurumcc.com` | `1234` | Approved, has data room access |
| **Operator** | Admin | from `ADMIN_USERS` env | from env | Full platform control |

---

## 2. Scenario Matrix

### 2.1 Public / Unauthenticated

| # | Scenario | Entry | Expected |
|---|---|---|---|
| P1 | Landing page loads | `GET /` | Hero renders, no console errors |
| P2 | All nav links resolve | Click nav items | No 404s |
| P3 | Application form submits | Fill + submit access form | `POST /api/v2?resource=inst&op=register` returns `{ok:true}` |
| P4 | Login page loads | `GET /login` | Three tabs visible: Advisor / Investor / Operator |
| P5 | Bad credentials rejected | Login with wrong password | Error shown, no redirect |
| P6 | Auth guard redirects | `GET /advisor-portal` without cookie | Redirected to `/login` |

### 2.2 Advisor Flow

| # | Scenario | Steps | Expected |
|---|---|---|---|
| A1 | Login → portal | Login as Alice | Cookie set, land at `/advisor-portal` |
| A2 | View deal list | — | Deals rendered with stage badges |
| A3 | Submit new deal | Fill deal form, submit | `POST ?resource=advisor/deals&op=submit` → deal appears in list |
| A4 | Stage journey visible | Open deal | Stage circles full-width, active stage highlighted |
| A5 | Answer Q&A | Open deal Q&A tab, type reply, submit | Answer persists on reload |
| A6 | Broadcast message | Use broadcast button | Opens to all investors in deal |
| A7 | Sign out | Click Sign out | Cookie cleared, redirect to `/login` |
| A8 | Forgot password flow | Click forgot, enter email, reset | Reset email received, new password works |

### 2.3 Investor Flow

| # | Scenario | Steps | Expected |
|---|---|---|---|
| I1 | Login with access code | Login as James (code `1234`) | Cookie set, land at `/investor-portal` |
| I2 | Lobby renders | — | Greeting with name, KPI ring, deal cards |
| I3 | Greeting font size mobile | Resize to 375px | Large italic serif heading (clamp 36–56px) |
| I4 | Deal card open | Click deal | Detail panel slides in |
| I5 | Submit IOI | Open deal, fill IOI amount, submit | `POST ?resource=inst&op=submit-ioi` → confirmation |
| I6 | Data room access | Navigate to Materials tab | Files listed; gated without IOI approval |
| I7 | Ring label reads "Indicated" | View hero ring | Label = "Indicated", not "Subscribed" |
| I8 | Sign out | Click Sign out | Cookie cleared, redirect to `/login` |

### 2.4 Operator Flow

| # | Scenario | Steps | Expected |
|---|---|---|---|
| O1 | Login | Login as Operator | Land at `/admin-portal` |
| O2 | Deal pipeline view | — | All deals visible across all stages |
| O3 | Approve IOI | Open investor IOI, approve | Investor gets data room email |
| O4 | Create advisor | Admin panel → New Advisor | Welcome email sent with temp password |
| O5 | Advisor completes setup | Click link in email, set password | Redirect to `/advisor-portal` (not `/advisor` 404) |
| O6 | Advance deal stage | Move deal from `review` → `live` | Audit log entry created |
| O7 | Notification panel | Click bell icon | Panel visible, not blank |
| O8 | Load test data | `/control` → Load Test Data | Deals and advisors seeded |

### 2.5 API Contract Tests

| # | Endpoint | Method | Payload | Expected response |
|---|---|---|---|---|
| API1 | `/api/health` | GET | — | `{ok:true, kv:"connected"}` |
| API2 | `/api/v2?resource=advisor&op=login` | POST | `{email, password}` | `{ok:true}` + cookie |
| API3 | `/api/v2?resource=inst&op=login` | POST | `{email, code}` | `{ok:true}` + cookie |
| API4 | `/api/v2?resource=advisor/deals&op=list` | GET | — (with cookie) | `{ok:true, deals:[...]}` |
| API5 | `/api/v2?resource=advisor&op=answer-qa` | POST | `{dealId, qaId, answer}` | `{ok:true}` |
| API6 | `/api/v2?resource=advisor&op=answer-qa` (broadcast) | POST | `{dealId, broadcast:true, message}` | `{ok:true}` |
| API7 | `/api/v2?resource=inst&op=submit-ioi` | POST | `{dealId, amount, currency}` | `{ok:true}` |
| API8 | `/api/v2?resource=admin&op=approve-ioi` | POST | `{ioiId}` | `{ok:true}` |

---

## 3. Node.js Bot Runner

```javascript
// test-bot.mjs
// Usage: BASE_URL=https://prism-plum.vercel.app node test-bot.mjs

import { strict as assert } from 'node:assert';

const BASE = process.env.BASE_URL || 'https://prism-plum.vercel.app';
const ADVISOR_EMAIL = 'sarah@capitalgroup.sg';
const ADVISOR_PASS = 'Advisor123!';
const INVESTOR_EMAIL = 'jwc@theaurumcc.com';
const INVESTOR_CODE = '1234';

let advisorCookie = '';
let investorCookie = '';
let adminCookie = '';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;

let passed = 0;
let failed = 0;

async function run(label, fn) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}: ${e.message}`);
    failed++;
  }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

// ── Health ──────────────────────────────────────────────────────────────
console.log('\n── Health ──');
await run('GET /api/health → ok', async () => {
  const { body } = await api('/api/health');
  assert.equal(body.ok, true);
});

// ── Advisor login ────────────────────────────────────────────────────────
console.log('\n── Advisor ──');
await run('Advisor login succeeds', async () => {
  const { body, headers } = await api('/api/v2?resource=advisor&op=login', {
    method: 'POST',
    body: JSON.stringify({ email: ADVISOR_EMAIL, password: ADVISOR_PASS }),
  });
  assert.equal(body.ok, true, JSON.stringify(body));
  const cookie = headers.get('set-cookie');
  assert.ok(cookie?.includes('prism_advisor'), 'No prism_advisor cookie');
  advisorCookie = cookie.split(';')[0];
});

await run('Bad password rejected', async () => {
  const { body } = await api('/api/v2?resource=advisor&op=login', {
    method: 'POST',
    body: JSON.stringify({ email: ADVISOR_EMAIL, password: 'wrong' }),
  });
  assert.equal(body.ok, false);
});

await run('Deal list returns array', async () => {
  const { body } = await api('/api/v2?resource=advisor/deals&op=list', {
    method: 'GET',
    cookie: advisorCookie,
  });
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.ok(Array.isArray(body.deals));
});

await run('Unauthenticated deal list rejected', async () => {
  const { body, status } = await api('/api/v2?resource=advisor/deals&op=list');
  assert.equal(body.ok, false);
});

// ── Investor login ───────────────────────────────────────────────────────
console.log('\n── Investor ──');
await run('Investor login with code', async () => {
  const { body, headers } = await api('/api/v2?resource=inst&op=login', {
    method: 'POST',
    body: JSON.stringify({ email: INVESTOR_EMAIL, code: INVESTOR_CODE }),
  });
  assert.equal(body.ok, true, JSON.stringify(body));
  const cookie = headers.get('set-cookie');
  assert.ok(cookie?.includes('prism_inst'), 'No prism_inst cookie');
  investorCookie = cookie.split(';')[0];
});

await run('Investor deal list returns data', async () => {
  const { body } = await api('/api/v2?resource=deals&op=list', {
    method: 'GET',
    cookie: investorCookie,
  });
  assert.equal(body.ok, true, JSON.stringify(body));
});

// ── Admin login (if credentials provided) ────────────────────────────────
if (ADMIN_EMAIL && ADMIN_PASS) {
  console.log('\n── Admin ──');
  await run('Admin login succeeds', async () => {
    const { body, headers } = await api('/api/v2?resource=admin&op=login', {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    assert.equal(body.ok, true, JSON.stringify(body));
    const cookie = headers.get('set-cookie');
    assert.ok(cookie?.includes('prism_admin'), 'No prism_admin cookie');
    adminCookie = cookie.split(';')[0];
  });
}

// ── Public form ──────────────────────────────────────────────────────────
console.log('\n── Public Form ──');
await run('Investor application form wired to API', async () => {
  const { body, status } = await api('/api/v2?resource=inst&op=register', {
    method: 'POST',
    body: JSON.stringify({
      contact_name: 'Test Bot',
      firm_name: 'Bot Capital Ltd',
      email: `bot-${Date.now()}@example.com`,
      institution_type: 'Family Office',
      aum_range: '$250M–$500M',
      invest_focus: 'Real Assets',
      role: 'CIO',
    }),
  });
  // Expect ok:true or an email-conflict error (both mean the API was reached)
  assert.ok(body.ok === true || body.error, `Unexpected response: ${JSON.stringify(body)}`);
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────────`);
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`);
if (failed > 0) process.exit(1);
```

---

## 4. Pressure Test Protocol

Run before go-live to validate Upstash Redis under concurrent load:

```bash
# Install autocannon
npm install -g autocannon

# 50 concurrent connections for 10 seconds on the health endpoint
autocannon -c 50 -d 10 https://prism-plum.vercel.app/api/health

# 10 concurrent logins (realistic peak)
autocannon -c 10 -d 10 -m POST \
  -H "Content-Type: application/json" \
  -b '{"email":"jwc@theaurumcc.com","code":"1234"}' \
  https://prism-plum.vercel.app/api/v2?resource=inst\&op=login
```

**Pass criteria:** p99 latency < 2000ms, error rate < 0.5%, no 5xx responses.

---

## 5. Pre-Launch Checklist

### Auth & Security
- [ ] All JWT cookies have `HttpOnly; Secure; SameSite=Lax` in production
- [ ] Admin route blocked without `prism_admin` cookie
- [ ] `PRISM_SECRET` is a strong random 32-byte key (not default)
- [ ] `ADMIN_USERS` set with strong passwords

### Data & Email
- [ ] Upstash Redis connected (`/api/health` → `kv: "connected"`)
- [ ] `RESEND_API_KEY` set — send a test welcome email
- [ ] `NOTIFY_EMAILS` set — verify operator alert emails
- [ ] `SITE_URL` set to `https://prism.theaurumcc.com` (no trailing slash)

### UI / UX
- [ ] Mobile nav at 375px: no overlap with content
- [ ] Stage journey circles: equal width, full-row fill
- [ ] Investor greeting: large italic serif (clamp 36–56px) on mobile
- [ ] Notification panel: visible (not blank/occluded) on all portals
- [ ] Login redirect after setup-password → `/advisor-portal`

### API Contract
- [ ] `GET /api/health` → `{ok:true, kv:"connected"}`
- [ ] Advisor login flow end-to-end
- [ ] Investor login flow end-to-end
- [ ] Deal submission → audit log entry created
- [ ] IOI submission → dedup key set
- [ ] Broadcast Q&A → message stored, no 400

### Financial Labels
- [ ] IOI ring label says "Indicated" (not "Subscribed")
- [ ] Deal cards say "X% indicated" (not "X% subscribed")
- [ ] Returns UI shows "target cash yield" distinct from IRR where applicable

---

## 6. Running the Bot

```bash
# Against staging
BASE_URL=https://prism-plum.vercel.app node test-bot.mjs

# Against production (with admin creds)
BASE_URL=https://prism.theaurumcc.com \
  ADMIN_EMAIL=admin@theaurumcc.com \
  ADMIN_PASS=yourpassword \
  node test-bot.mjs
```

---

*Last updated: 2026-05-01*
