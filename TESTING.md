# Aurum Prism · Testing Playbook

## Portals (live URLs)

| Portal | URL | Who |
|---|---|---|
| Advisor | `https://prism-plum.vercel.app/advisor-portal` | Deal advisors |
| Admin / Operator | `https://prism-plum.vercel.app/admin-portal` | Platform operator |
| Investor | `https://prism-plum.vercel.app/investor-portal` | Institutional investors |
| Login | `https://prism-plum.vercel.app/login` | All users — entry point |

All portals redirect to `/login` if session is missing or expired.

---

## First-Time Setup (do this before anything else)

1. Log in as **Operator** at `/login` → expand the Operator bar at the bottom
2. You land on `/admin-portal`
3. Open the old control panel at `/control` — click **"Load Test Data"**
4. This seeds: 4 advisor accounts, 5 investor accounts, 5 live deals into Redis
5. Now all test credentials below will work

---

## Test Credentials

### Operator
- **Login:** `/login` → click the Operator bar at the bottom to expand
- **Email:** set via `ADMIN_USERS` Vercel env var (format: `email:password,email2:password2`)
- **Lands on:** `/admin-portal`

### Advisor
- **Email:** `sarah@capitalgroup.sg`
- **Password:** `Advisor123!`
- **Firm:** SG Capital Group
- **Lands on:** `/advisor-portal` (shows Sarah's deals only)
- **Note:** First login may trigger `/setup-password` — set a password then log in again

### Investor
- **Email:** `james@meridianfund.com`
- **Access Code:** `INST-K7MQ2WXN`
- **Firm:** Meridian Family Office
- **Lands on:** `/investor-portal`

### Additional test accounts (seeded by Load Test Data)
| Role | Email | Credential |
|---|---|---|
| Advisor | `tkj@theaurumcc.com` | `1234` |
| Advisor | `jtan@meridiancap.com` | `Advisor123!` |
| Investor | `skim@pacificavc.com` | `INST-Q3PX7KMN` |
| Investor | `dliu@egf.com` | `INST-B8WZK4LR` |

---

## Test Flows

### Flow 1: Advisor → Submit a Deal
1. Log in as advisor at `/login`
2. Land on `/advisor-portal` — dashboard shows your active deals
3. Click **"Submit New Deal"** tab
4. Fill 4-step wizard: Identity → Terms → Documents → Review
5. Click **"Submit for Review"** — deal POSTs to `/api/advisor/deals`
6. Check `/admin-portal` → Pipeline tab — deal appears under **Pending Submissions**

### Flow 2: Operator → Approve & Publish Deal
1. Log in as operator at `/login`
2. Land on `/admin-portal` → go to **Deal Pipeline** tab
3. Find the pending deal under **Pending Submissions**
4. Click **"Approve & Publish"** — deal goes live on investor portal
5. Advisor receives email notification (requires `RESEND_API_KEY` set)
6. Deal now appears in `/investor-portal` discovery grid

### Flow 3: Investor → Browse & Submit IOI
1. Log in as investor at `/login`
2. Land on `/investor-portal` — browse deal cards
3. Click a deal card → deal overlay opens
4. Sign NDA → IOI form appears
5. Enter amount (min ticket varies by deal), check 3 acknowledgments
6. Click **"Confirm Expression of Interest"** — POSTs to `/api/marketplace/ioi`
7. Check `/admin-portal` → IOI Queue tab — IOI appears as pending

### Flow 4: Operator → Approve IOI & Push to Advisor
1. In `/admin-portal` → **IOI Queue** tab
2. Find the pending IOI → click **"Approve"**
3. Investor receives approval email
4. Click **"Push →"** on an approved IOI → confirm modal
5. Advisor receives email with IOI details
6. Advisor sees IOI Review card in `/advisor-portal` deal overview

### Flow 5: Advisor → Accept IOI (advances to Due Diligence)
1. Log in as the relevant advisor
2. In `/advisor-portal` — deal with forwarded IOI shows **"IOI Review · Action Required"** stage
3. Click **"Accept IOI"** on the IOI Review card
4. Deal stage advances to **Due Diligence**
5. Admin and investor both receive email notifications

### Flow 6: Password Reset (Advisor)
1. Go to `/forgot-password`
2. Enter advisor email
3. Receive 6-digit code by email
4. Enter code + new password at `/reset-password`
5. Log in normally

---

## API Health Check
```
GET https://prism-plum.vercel.app/api/health
```
Returns `{ ok: true, kv: "connected" }` — if `kv` is not `"connected"` check Upstash env vars.

---

## Required Vercel Environment Variables

| Variable | Description |
|---|---|
| `PRISM_SECRET` | JWT signing key — run `openssl rand -base64 32` |
| `ADMIN_USERS` | Operator credentials — format: `email:password` |
| `RESEND_API_KEY` | Email delivery — get from resend.com |
| `KV_REST_API_URL` | Upstash Redis URL |
| `KV_REST_API_TOKEN` | Upstash Redis token |
| `SITE_URL` | `https://prism-plum.vercel.app` |
| `NOTIFY_EMAILS` | Comma-separated emails for admin alerts |

---

## Pre-Launch Checklist
- [ ] All env vars set in Vercel (table above)
- [ ] `RESEND_API_KEY` set, `prism@theaurumcc.com` sender domain verified
- [ ] `/api/health` returns `kv: connected`
- [ ] Load Test Data seeded — deals visible on `/investor-portal`
- [ ] Advisor login works, lands on `/advisor-portal`
- [ ] Investor login works, lands on `/investor-portal`
- [ ] Operator login works, lands on `/admin-portal`
- [ ] IOI submission end-to-end: investor submits → appears in admin queue
- [ ] Email delivery verified (IOI approval triggers investor email)
- [ ] Mobile tested on iOS Safari and Android Chrome
- [ ] Vercel Deployment Protection **disabled** (Settings → Deployment Protection)
