# Prism Master Dev v1 — Execution Plan

## Architecture Decision
Single unified HTML file (`Prism-Master-Dev-v1.html`) with:
- Portal switcher bar (fixed top, always visible)
- Shared JS state object (`STATE`) — single source of truth
- Three portal sections (advisor/admin/investor) shown/hidden by portal router
- State mutations trigger cross-portal re-renders
- Investor portal has its own dark/light theme scope (CSS variable isolation)

---

## Shared State Schema

```
STATE.deals[]          — approved deals visible to investors
STATE.pendingDeals[]   — advisor-submitted, awaiting admin approval  
STATE.advisors[]       — advisor profiles
STATE.investors[]      — investor profiles
STATE.notifications[]  — email notification log
STATE.currentAdvisor   — active advisor in demo (switcher)
STATE.currentInvestor  — active investor in demo (switcher)
```

Key mutations (each fires notifications + re-renders active portals):
- submitNewDeal() → advisor → goes to pendingDeals → admin email
- approveDeal() → admin → deal goes live on investor portal → advisor email
- submitIOI() → investor → admin IOI queue → admin email
- approveIOI() → admin → investor email
- pushIOI() → admin → advisor gets IOI Review → advisor email ⚡
- acceptIOI() → advisor → deal stage = dd → admin + investor email
- advanceDeal() → admin → stage gate → notifications
- releaseClosingPackage() → admin → investor email
- submitWire() → investor → admin + advisor email
- confirmWire() → admin → investor email (funded confirmation)

---

## Deal Portfolio (4 Live + 1 Pending)

| Deal | Type | Advisor | Primary Metric | Stage |
|---|---|---|---|---|
| Pacific Bridge Infrastructure | Infra Debt | Sarah Chen | 11% Coupon | live (97.5%) |
| Clearwater Credit Partners II | Private Credit | Marcus Chen | 13% Yield | live (70%) |
| Vantage Analytics Series C | Growth Equity | Priya Mehta | 3.5× MOIC | dd |
| SunBelt Residential Fund IV | Real Estate Pref | Thomas Kim | 9% Pref Return | live (37%) |
| Meridian Financial Corp | Private Credit | David Park | — | pending_approval |

NO funds-of-funds. All direct investments.

---

## Deal-Type Metric Mapping (CRITICAL FIX)

### Growth Equity (pe)
- Primary: MOIC target (e.g., 3.5×)
- Secondary: Target IRR (22%)
- Metrics: ARR, YoY Growth, Net Revenue Retention, Entry Valuation, Stage
- Return chart: MOIC exit scenarios (Bear 2.0× / Base 3.5× / Bull 5.5×) at exit date
- NO yield, NO $/yr income framing

### Private Credit (credit)
- Primary: Coupon/Yield % (13%)
- Secondary: LTV (65%)
- Metrics: DSCR, Security Type (First Lien), Term, Distribution Freq, # Borrowers
- Return chart: Quarterly income bars + principal return at maturity

### Real Estate (re)
- Primary: Preferred Return % (9%)
- Secondary: Cap Rate (5.8%)
- Metrics: LTV, Occupancy %, Hold Period, Total Target IRR, Distribution Freq
- Return chart: Annual preferred distributions (bars) + exit equity distribution (final tall bar)

### Infrastructure Debt (infra)
- Primary: Coupon Rate % (11%)
- Secondary: Coverage Ratio (4.2×)
- Metrics: LTV, Asset Type, Credit Rating, Term, Distribution Freq
- Return chart: Annual coupon income (7 bars) + principal return (terminal bar)

---

## Complete Deal Flow (end-to-end)

```
1. Advisor submits deal + docs (wizard: 4 steps, min docs required)
   → STATE.pendingDeals.push(deal)
   → EMAIL: admin — "New deal submission: [name] from [advisor]"

2. Admin reviews in Deal Pipeline > Pending Submissions
   → clicks "Approve & Publish"
   → approveDeal() → deal moves to STATE.deals, stage = 'live'
   → EMAIL: advisor — "[deal] is now live on investor portal"

3. Investors browse, sign NDA, submit IOI
   → submitIOI() → deal.iois.push(ioi), status = 'pending'
   → EMAIL: admin — "New IOI: [investor] — $XM in [deal]"

4. Admin reviews IOI queue → Approve or Decline
   → approveIOI() → ioi.status = 'approved'
   → EMAIL: investor — "Your IOI for [deal] has been approved"

5. Admin selects ONE approved IOI, clicks "Push to Advisor →"
   → pushIOI() → deal.stage = 'ioi_review', ioi.pushed = true
   → EMAIL: advisor — "IOI forwarded: [investor_type] — $XM — [deal]"

6. Advisor sees IOI Review card → clicks "Accept"
   → acceptIOI() → deal.stage = 'dd'
   → EMAIL: admin — "IOI accepted, advancing to DD"
   → EMAIL: investor — "Your allocation accepted, moving to due diligence"

7. DD stage (advisor manages):
   - Data room: upload/manage files with folder structure
   - Q&A: advisor answers investor questions
   - DD access: tracked per investor

8. Admin advances deal to Close
   → advanceDeal(dealId, 'close')
   → EMAIL: investors with approved allocations — "Closing package available"

9. Admin releases closing package
   → releaseClosingPackage() → closing_package_released = true
   → Wire instructions available to approved investors

10. Investor views closing package:
    - Fund Documents (PDF)
    - Subscription Agreement (PDF)
    - PPM (PDF)
    - Wire Instructions (bank details, reference)
    → Investor submits wire confirmation (amount, reference, date)
    → EMAIL: admin + advisor — "Wire submitted: [investor] — $XM"

11. Admin confirms wire per investor
    → ioi.wire_confirmed = true
    → EMAIL: investor — "Wire confirmed — allocation complete"

12. When all target raised, admin marks deal Realized
    → deal.stage = 'realized'
    → Portfolio shows final allocation with confirmed status
```

---

## Portal Structure

### Portal Switcher Bar (fixed, z:300)
- Aurum Prism logo
- [Advisor Portal] [Admin Portal] [Investor Portal] tabs
- Demo user selector (changes currentAdvisor / currentInvestor)
- Notification bell with count

### Advisor Portal (light theme)
**Views:** Dashboard | Deal Detail | Submit New Deal

Dashboard:
- Welcome header (advisor name + firm)
- My Active Deals cards (filtered to currentAdvisor only)
- My Pipeline (pending approval, live, DD, close)
- Recent activity

Deal Detail (per deal):
- Stage journey (7 stages)
- Tabs: Overview | Materials | Due Diligence* | Closing*
  (* = conditional on stage)
- Overview: stats, IOI push card (if ioi_review), activity feed
- Materials: core docs, data room
- Due Diligence: DD access list, Q&A thread management, data room analytics
- Closing: closing doc upload, wire tracking, investor list

Submit New Deal:
- 4-step wizard: Identity → Terms → Documents (min required) → Review

### Admin Portal (light theme)
**Views:** Overview | IOI Queue | Deal Pipeline | Closing Management | AI Doc Tool

Overview: KPIs + attention cards + activity
IOI Queue: approve/decline/push per deal
Deal Pipeline: pending submissions + active deals + stage gates
Closing Management: NEW — release packages, track wires per investor
AI Doc Tool: 3 docs → Claude → investor content

### Investor Portal (dark theme, toggleable to light)
**Views:** Discover | Portfolio | Closing (conditional)

Discover: prism SVG, deal grid (approved deals only), deal detail overlay
- Deal overlay shows type-specific metrics and return chart
- NDA gate → IOI submission

Portfolio: active IOIs with pipeline status
- Shows DD status when applicable
- Closing tab when stage = close/realized

Closing view:
- Deal-specific closing package
- Fund docs, subscription agreement, PPM downloads (mock)
- Wire instructions (displayed clearly)
- Wire confirmation submission form
- Confirmation status

---

## Email Notification Points

1. Advisor submits deal → Admin
2. Admin approves deal → Advisor  
3. Investor submits IOI → Admin
4. Admin approves IOI → Investor
5. Admin pushes IOI to advisor → Advisor ⚡
6. Advisor accepts IOI → Admin + Investor
7. Admin advances to Close → Investors (all approved)
8. Investor submits wire → Admin + Advisor
9. Admin confirms wire → Investor

---

## Code Reuse Strategy

CSS:
- One :root with shared tokens (light theme)
- #portal-investor overrides to dark, [data-theme="light"] overrides back
- Shared: nav, buttons, badges, forms, modals, toast, activity feed
- Portal-specific: deal grid (investor), pipeline table (admin), wizard (advisor)

JS:
- fmU() — format USD (shared)
- fmDate() — format date (shared)
- toast() — action toast (shared)
- sendEmail() — notification + email toast (shared)
- showPortal() — portal router (shared)
- Prefix: adv_ (advisor), adm_ (admin), inv_ (investor)

---

## Build Sequence (Code Order)

1. Head + CSS (design tokens, shared, portal-specific)
2. HTML (portal switcher, 3 portal sections, modals, toasts)
3. STATE object + 4 deals + advisors + investors
4. State mutation functions
5. Portal router
6. Shared utilities
7. Advisor portal JS (dashboard, deal detail, wizard)
8. Admin portal JS (overview, IOI queue, pipeline, closing, AI tool)
9. Investor portal JS (discover, deal overlay, portfolio, closing)
10. Return chart JS (type-specific SVG charts)
11. Notification system
12. Init (render all portals, set defaults)

---

## Post-Build Audit Checklist

- [ ] Every button either mutates state, navigates, or is marked "Demo only"
- [ ] Cross-portal state syncs: approve deal → investor grid updates
- [ ] Theme toggle works in investor portal only (advisor/admin unaffected)
- [ ] Advisor sees ONLY their deals (filter by currentAdvisor)
- [ ] Deal-type metrics are correct (no IRR for credit primary, no yield for PE)
- [ ] Return charts show correct type (MOIC for PE, income for credit/infra/RE)
- [ ] No funds-of-funds in deal data
- [ ] All 11 stages of deal flow reachable and functional
- [ ] Email notifications fire at all 9 key points
- [ ] DD: Q&A functional, data room accessible
- [ ] Closing: wire instructions shown, confirmation submittable
- [ ] Admin: can confirm wires, mark deal realized
- [ ] Mobile: investor portal deal cards stack, advisor portal responsive
- [ ] No $ /yr labels on equity deals
