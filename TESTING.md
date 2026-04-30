# Aurum Prism · Testing Playbook

## Quick Start

### 1. Demo Mode (no deploy needed)
Add `?demo` to the login URL: `https://prism.theaurumcc.com/login?demo`
Click credential buttons to pre-fill. No seed data required.

### 2. Load Test Data
1. Log in as operator (see credentials below)
2. Go to Control Panel
3. Click **"Load Test Data"** — seeds 5 deals, 3 advisors, 5 investors

---

## Test Credentials

### Operator
- **URL:** `/login` → expand Operator bar
- **Email:** set via `ADMIN_USERS` env var
- **Default test:** `ops@theaurumcc.com` / your password

### Advisor
- **Email:** `sarah@capitalgroup.sg`
- **Password:** `Advisor123!`
- **Firm:** SG Capital Group

### Investor (Access Code)
- **Email:** `james@meridianfund.com`
- **Code:** `INST-K7MQ2WXN`

---

## Test Flows

### Flow 1: Advisor Login → Submit Deal
1. Go to `/login`, enter advisor credentials
2. First login triggers setup-password page
3. After password set, land on advisor portal
4. Click "+ Submit Deal"
5. Fill wizard (3 steps)
6. Deal appears in pipeline as "review"
7. Check operator control panel — deal shows in Under Review

### Flow 2: Operator → Publish Deal
1. Log in as operator at `/control`
2. Find deal in Deals tab, stage = review
3. Change stage dropdown to "live"
4. Click "○ DRAFT" to toggle to "● LIVE"
5. Deal now visible on marketplace
6. Advisor receives email notification (if RESEND_API_KEY set)

### Flow 3: Investor → Submit IOI
1. Log in as investor at `/login`
2. Browse marketplace
3. Click a deal card
4. Go to IOI tab
5. Enter amount (min: $50,000)
6. Check all 3 acknowledgments
7. Submit
8. IOI appears in operator control panel IOI Queue tab
9. Portfolio tab shows submitted IOI

### Flow 4: Operator → Grant Data Room
1. In control panel, go to IOI Queue tab
2. Find pending IOI
3. Click "Grant Access"
4. Investor receives email with data room notification
5. Investor's Documents tab unlocks

### Flow 5: Password Reset (Advisor)
1. Go to `/forgot-password`
2. Enter advisor email
3. Check email for 6-digit code
4. Enter code + new password
5. Redirected to login

---

## API Health Check
```
GET https://prism.theaurumcc.com/api/health
```
Returns `{ ok: true, kv: "connected" }` if KV is connected.

---

## TACC Feed Endpoint
```
GET https://prism.theaurumcc.com/api/v2?resource=deals&op=tacc-feed
Header: x-tacc-signature: YOUR_PRISM_TACC_BRIDGE_SECRET
```
Returns published deals in TACC-compatible JSON envelope.

---

## Pre-Launch Checklist
- [ ] `PRISM_SECRET` set (run `openssl rand -base64 32`)
- [ ] `ADMIN_USERS` set with secure password
- [ ] `RESEND_API_KEY` set, `prism@theaurumcc.com` domain verified
- [ ] `KV_REST_API_URL` + `KV_REST_API_TOKEN` set (Upstash)
- [ ] `SITE_URL` set to `https://prism.theaurumcc.com`
- [ ] `NOTIFY_EMAILS` set
- [ ] Test email delivery end-to-end (register investor, approve, verify code email)
- [ ] Test password reset flow
- [ ] Load test data, verify all 5 deals show on marketplace
- [ ] Test IOI submission + data room grant flow
- [ ] Verify `/api/health` returns `kv: connected`
- [ ] Remove or disable seed endpoint before real launch
