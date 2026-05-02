# Aurum Prism — Mobile Audit

**Date:** 2026-05-02
**Baseline:** v2.0 (commit a158aeb / code 54e9007)
**Target:** https://prism-plum.vercel.app (live production)
**Method:** Playwright Chromium mobile emulation, real DPR + touch + mobile UA, 4 portrait viewports + 1 landscape spot-check, 3 roles. 35 page-views captured. Read-only — no platform code modified.

## Executive summary

| Severity | Count |
|---|---|
| **P0 (broken)** — overflow, missing viewport meta, fixed-width clipping | 26 |
| **P1 (ugly / blocking) ** — sub-44px tap targets, < 16px inputs, low contrast | 381 |
| **P2 (polish)** — type/whitespace/landing copy issues (manual additions below) | 0+ |

### Top 5 fixes by impact

1. **investor-portal: 23-25 px horizontal overflow on every viewport ≤414px.** Same root cause repeats — likely a fixed-width element (deal card or KPI strip) wider than the smallest viewport. **SAFE** to fix in a media-query.
2. **index.html: ~30 sub-44px tap targets on every viewport** + 7 inputs below 16px (iOS auto-zooms on focus). Bottom-left footer/legal links cluster is the worst offender. **SAFE** in media-query.
3. **Login page: "ENTER MARKETPLACE" + "REQUEST INSTITUTIONAL ACCESS" buttons are dark blue on dark background — fail WCAG AA contrast.** Visible in screenshot evidence. **SAFE** color tweak in media-query, or a desktop fix (operator approval).
4. **forgot-password: ~14px scroll overflow + 1 input below 16px.** Single fixed-width form box. **SAFE** in media-query.
5. **investor-portal hero: text overlap between "INVESTOR DEMO" badge and deal description** at 375×667 (visible in screenshot). The demo badge is absolutely positioned and bleeds into "Other Opportunities" section. **RISKY** — needs the badge layout reworked, may cross desktop CSS.

### Worst portal
- **investor-portal.html** — overflow on all 4 portrait viewports + visible content overlap. This is the portal investors actually use on phone. Highest-priority fix surface.

### Best portal
- **login.html** — clean layout at every portrait viewport. Only complaint: blue-on-black secondary buttons fail contrast (issue #3 above).

### Coverage
- 5 viewports × 7 pages = 35 captures, 0 errors.
- Public + investor + advisor roles all reached. Admin-portal authenticated views require operator credentials and were not audited (login screen only).

---

## Per-page findings

### investor-portal

- Viewport meta: `width=device-width,initial-scale=1,viewport-fit=cover`
- Safe-area-inset usage: yes

#### android-360 — https://prism-plum.vercel.app/investor-portal
- Screenshot: `screenshots/android-360-investor-portal.png`
- Layout: scrollWidth=382, clientWidth=360 → **horizontal overflow 22px (P0)**
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "☀" — 44×36px (class: theme-btn)
  - `<div>` "" — 32×2px (class: hero-dot active)
  - `<div>` "" — 20×2px (class: hero-dot)
  - `<div>` "" — 20×2px (class: hero-dot)
- **3 WCAG AA contrast failures (P1)**:
  - "PRIVATE CREDIT" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "EQUITY" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.07)
  - "REAL ESTATE" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
- **3 elements with fixed width exceeding viewport (P0)**:
  - `<nav>` 377px (class: nav)
  - `<div>` 377px 
  - `<div>` 377px (class: dd-inner)

#### iphone-se-375 — https://prism-plum.vercel.app/investor-portal
- Screenshot: `screenshots/iphone-se-375-investor-portal.png`
- Layout: scrollWidth=398, clientWidth=375 → **horizontal overflow 23px (P0)**
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "☀" — 44×36px (class: theme-btn)
  - `<div>` "" — 32×2px (class: hero-dot active)
  - `<div>` "" — 20×2px (class: hero-dot)
  - `<div>` "" — 20×2px (class: hero-dot)
- **3 WCAG AA contrast failures (P1)**:
  - "PRIVATE CREDIT" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "EQUITY" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.07)
  - "REAL ESTATE" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
- **3 elements with fixed width exceeding viewport (P0)**:
  - `<nav>` 391px (class: nav)
  - `<div>` 391px 
  - `<div>` 391px (class: dd-inner)

#### iphone-14-390 — https://prism-plum.vercel.app/investor-portal
- Screenshot: `screenshots/iphone-14-390-investor-portal.png`
- Layout: scrollWidth=413, clientWidth=390 → **horizontal overflow 23px (P0)**
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "☀" — 44×36px (class: theme-btn)
  - `<div>` "" — 32×2px (class: hero-dot active)
  - `<div>` "" — 20×2px (class: hero-dot)
  - `<div>` "" — 20×2px (class: hero-dot)
- **3 WCAG AA contrast failures (P1)**:
  - "PRIVATE CREDIT" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "EQUITY" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.07)
  - "REAL ESTATE" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
- **3 elements with fixed width exceeding viewport (P0)**:
  - `<nav>` 407px (class: nav)
  - `<div>` 407px 
  - `<div>` 407px (class: dd-inner)

#### iphone-pro-max-414 — https://prism-plum.vercel.app/investor-portal
- Screenshot: `screenshots/iphone-pro-max-414-investor-portal.png`
- Layout: scrollWidth=439, clientWidth=414 → **horizontal overflow 25px (P0)**
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "☀" — 44×36px (class: theme-btn)
  - `<div>` "" — 32×2px (class: hero-dot active)
  - `<div>` "" — 20×2px (class: hero-dot)
  - `<div>` "" — 20×2px (class: hero-dot)
- **3 WCAG AA contrast failures (P1)**:
  - "PRIVATE CREDIT" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "EQUITY" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.07)
  - "REAL ESTATE" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
- **3 elements with fixed width exceeding viewport (P0)**:
  - `<nav>` 432px (class: nav)
  - `<div>` 432px 
  - `<div>` 432px (class: dd-inner)

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/investor-portal
- Screenshot: `screenshots/iphone-se-landscape-667-investor-portal.png`
- Layout: scrollWidth=707, clientWidth=667 → **horizontal overflow 40px (P0)**
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "☀" — 44×36px (class: theme-btn)
  - `<div>` "" — 32×2px (class: hero-dot active)
  - `<div>` "" — 20×2px (class: hero-dot)
  - `<div>` "" — 20×2px (class: hero-dot)
- **3 WCAG AA contrast failures (P1)**:
  - "PRIVATE CREDIT" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "EQUITY" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.07)
  - "REAL ESTATE" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
- **3 elements with fixed width exceeding viewport (P0)**:
  - `<nav>` 696px (class: nav)
  - `<div>` 696px 
  - `<div>` 696px (class: dd-inner)


### advisor-portal

- Viewport meta: `width=device-width,initial-scale=1,viewport-fit=cover`
- Safe-area-inset usage: **no — P1** (notched iPhones may clip critical UI)

#### android-360 — https://prism-plum.vercel.app/advisor-portal
- Screenshot: `screenshots/android-360-advisor-portal.png`
- Layout: scrollWidth=360, clientWidth=360 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "Sign out" — 61×36px 
  - `<div>` "0
REVIEW" — 42×63px (class: dash-pipe-stage)
  - `<div>` "1
CLOSING" — 42×63px (class: dash-pipe-stage)
  - `<div>` "0
REALIZED" — 42×63px (class: dash-pipe-stage)
- **6 WCAG AA contrast failures (P1)**:
  - "INFRA" — ratio 1 (min 4.5). fg=rgb(74, 94, 110) bg=rgba(74, 94, 110, 0.07)
  - "Live & IOI" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "⚡ Action Required" — ratio 1 (min 4.5). fg=rgb(184, 131, 58) bg=rgba(184, 131, 58, 0.08)
  - "DD Only" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "Pacific Bridge Infrastructure
" — ratio 1.91 (min 4.5). fg=rgb(237, 232, 223) bg=rgba(197, 165, 114, 0.07)

#### iphone-se-375 — https://prism-plum.vercel.app/advisor-portal
- Screenshot: `screenshots/iphone-se-375-advisor-portal.png`
- Layout: scrollWidth=375, clientWidth=375 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "Sign out" — 61×36px 
  - `<div>` "0
REVIEW" — 42×63px (class: dash-pipe-stage)
  - `<div>` "1
CLOSING" — 42×63px (class: dash-pipe-stage)
  - `<div>` "0
REALIZED" — 42×63px (class: dash-pipe-stage)
- **6 WCAG AA contrast failures (P1)**:
  - "INFRA" — ratio 1 (min 4.5). fg=rgb(74, 94, 110) bg=rgba(74, 94, 110, 0.07)
  - "Live & IOI" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "⚡ Action Required" — ratio 1 (min 4.5). fg=rgb(184, 131, 58) bg=rgba(184, 131, 58, 0.08)
  - "DD Only" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "Pacific Bridge Infrastructure
" — ratio 1.91 (min 4.5). fg=rgb(237, 232, 223) bg=rgba(197, 165, 114, 0.07)

#### iphone-14-390 — https://prism-plum.vercel.app/advisor-portal
- Screenshot: `screenshots/iphone-14-390-advisor-portal.png`
- Layout: scrollWidth=390, clientWidth=390 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "Sign out" — 61×36px 
  - `<div>` "0
REVIEW" — 42×63px (class: dash-pipe-stage)
  - `<div>` "1
CLOSING" — 42×63px (class: dash-pipe-stage)
  - `<div>` "0
REALIZED" — 42×63px (class: dash-pipe-stage)
- **6 WCAG AA contrast failures (P1)**:
  - "INFRA" — ratio 1 (min 4.5). fg=rgb(74, 94, 110) bg=rgba(74, 94, 110, 0.07)
  - "Live & IOI" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "⚡ Action Required" — ratio 1 (min 4.5). fg=rgb(184, 131, 58) bg=rgba(184, 131, 58, 0.08)
  - "DD Only" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "Pacific Bridge Infrastructure
" — ratio 1.91 (min 4.5). fg=rgb(237, 232, 223) bg=rgba(197, 165, 114, 0.07)

#### iphone-pro-max-414 — https://prism-plum.vercel.app/advisor-portal
- Screenshot: `screenshots/iphone-pro-max-414-advisor-portal.png`
- Layout: scrollWidth=414, clientWidth=414 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "Sign out" — 61×36px 
  - `<div>` "0
REVIEW" — 42×63px (class: dash-pipe-stage)
  - `<div>` "1
CLOSING" — 42×63px (class: dash-pipe-stage)
  - `<div>` "0
REALIZED" — 42×63px (class: dash-pipe-stage)
- **6 WCAG AA contrast failures (P1)**:
  - "INFRA" — ratio 1 (min 4.5). fg=rgb(74, 94, 110) bg=rgba(74, 94, 110, 0.07)
  - "Live & IOI" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "⚡ Action Required" — ratio 1 (min 4.5). fg=rgb(184, 131, 58) bg=rgba(184, 131, 58, 0.08)
  - "DD Only" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "Pacific Bridge Infrastructure
" — ratio 1.91 (min 4.5). fg=rgb(237, 232, 223) bg=rgba(197, 165, 114, 0.07)

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/advisor-portal
- Screenshot: `screenshots/iphone-se-landscape-667-advisor-portal.png`
- Layout: scrollWidth=667, clientWidth=667 ✓
- **3 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "Sign out" — 75×36px 
  - `<div>` "0
REVIEW" — 42×63px (class: dash-pipe-stage)
  - `<div>` "1
CLOSING" — 42×63px (class: dash-pipe-stage)
- **6 WCAG AA contrast failures (P1)**:
  - "INFRA" — ratio 1 (min 4.5). fg=rgb(74, 94, 110) bg=rgba(74, 94, 110, 0.07)
  - "Live & IOI" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "⚡ Action Required" — ratio 1 (min 4.5). fg=rgb(184, 131, 58) bg=rgba(184, 131, 58, 0.08)
  - "DD Only" — ratio 1 (min 4.5). fg=rgb(91, 133, 184) bg=rgba(91, 133, 184, 0.07)
  - "Pacific Bridge Infrastructure
" — ratio 1.91 (min 4.5). fg=rgb(237, 232, 223) bg=rgba(197, 165, 114, 0.07)


### login

- Viewport meta: `width=device-width,initial-scale=1`
- Safe-area-inset usage: **no — P1** (notched iPhones may clip critical UI)

#### android-360 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/android-360-login.png`
- Layout: scrollWidth=360, clientWidth=360 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 296×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-se-375 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-se-375-login.png`
- Layout: scrollWidth=375, clientWidth=375 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 311×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-14-390 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-14-390-login.png`
- Layout: scrollWidth=390, clientWidth=390 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 326×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-pro-max-414 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-pro-max-414-login.png`
- Layout: scrollWidth=414, clientWidth=414 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 350×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-se-landscape-667-login.png`
- Layout: scrollWidth=667, clientWidth=667 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 93×21px (class: ts-back)
  - `<a>` "Forgot password?" — 253×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)
- **4 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="adv-email">` — 12px
  - `<input type="password" name="adv-password">` — 12px
  - `<input type="email" name="inv-email">` — 12px
  - `<input type="text" name="inv-code">` — 13px


### index

- Viewport meta: `width=device-width,initial-scale=1`
- Safe-area-inset usage: **no — P1** (notched iPhones may clip critical UI)

#### android-360 — https://prism-plum.vercel.app/
- Screenshot: `screenshots/android-360-index.png`
- Layout: scrollWidth=362, clientWidth=360 ✓
- **31 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "PLATFORM" — 73×40px (class: n-link)
  - `<a>` "ACCESS TIERS" — 94×40px (class: n-link)
  - `<button>` "REQUEST ACCESS →" — 94×23px (class: btn-nav)
  - `<button>` "REQUEST INSTITUTIONAL ACCESS →" — 252×40px (class: btn-primary)
  - `<button>` "MEMBER LOGIN →" — 139×40px (class: btn-member)
  - ...and 26 more
- **7 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="text" name="f-name">` — 12px
  - `<input type="text" name="f-role">` — 12px
  - `<input type="text" name="f-firm">` — 12px
  - `<input type="email" name="f-email">` — 12px
  - `<select type="select-one" name="f-type">` — 12px
- **4 WCAG AA contrast failures (P1)**:
  - "Member" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "All" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.04)
  - "INFRA" — ratio 1.57 (min 4.5). fg=rgb(136, 136, 221) bg=rgba(100, 100, 200, 0.06)
  - "MEMBER LOGIN →" — ratio 1.74 (min 4.5). fg=rgb(138, 124, 104) bg=rgba(197, 165, 114, 0.04)

#### iphone-se-375 — https://prism-plum.vercel.app/
- Screenshot: `screenshots/iphone-se-375-index.png`
- Layout: scrollWidth=375, clientWidth=375 ✓
- **31 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "PLATFORM" — 73×40px (class: n-link)
  - `<a>` "ACCESS TIERS" — 94×40px (class: n-link)
  - `<button>` "REQUEST ACCESS →" — 94×23px (class: btn-nav)
  - `<button>` "REQUEST INSTITUTIONAL ACCESS →" — 252×40px (class: btn-primary)
  - `<button>` "MEMBER LOGIN →" — 139×40px (class: btn-member)
  - ...and 26 more
- **7 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="text" name="f-name">` — 12px
  - `<input type="text" name="f-role">` — 12px
  - `<input type="text" name="f-firm">` — 12px
  - `<input type="email" name="f-email">` — 12px
  - `<select type="select-one" name="f-type">` — 12px
- **4 WCAG AA contrast failures (P1)**:
  - "Member" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "All" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.04)
  - "INFRA" — ratio 1.57 (min 4.5). fg=rgb(136, 136, 221) bg=rgba(100, 100, 200, 0.06)
  - "MEMBER LOGIN →" — ratio 1.74 (min 4.5). fg=rgb(138, 124, 104) bg=rgba(197, 165, 114, 0.04)

#### iphone-14-390 — https://prism-plum.vercel.app/
- Screenshot: `screenshots/iphone-14-390-index.png`
- Layout: scrollWidth=390, clientWidth=390 ✓
- **32 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "PLATFORM" — 73×40px (class: n-link)
  - `<a>` "ACCESS TIERS" — 94×40px (class: n-link)
  - `<button>` "REQUEST ACCESS →" — 94×23px (class: btn-nav)
  - `<button>` "REQUEST INSTITUTIONAL ACCESS →" — 252×40px (class: btn-primary)
  - `<button>` "MEMBER LOGIN →" — 139×40px (class: btn-member)
  - ...and 27 more
- **7 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="text" name="f-name">` — 12px
  - `<input type="text" name="f-role">` — 12px
  - `<input type="text" name="f-firm">` — 12px
  - `<input type="email" name="f-email">` — 12px
  - `<select type="select-one" name="f-type">` — 12px
- **4 WCAG AA contrast failures (P1)**:
  - "Member" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "All" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.04)
  - "INFRA" — ratio 1.57 (min 4.5). fg=rgb(136, 136, 221) bg=rgba(100, 100, 200, 0.06)
  - "MEMBER LOGIN →" — ratio 1.74 (min 4.5). fg=rgb(138, 124, 104) bg=rgba(197, 165, 114, 0.04)

#### iphone-pro-max-414 — https://prism-plum.vercel.app/
- Screenshot: `screenshots/iphone-pro-max-414-index.png`
- Layout: scrollWidth=414, clientWidth=414 ✓
- **32 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "PLATFORM" — 73×40px (class: n-link)
  - `<a>` "ACCESS TIERS" — 94×40px (class: n-link)
  - `<button>` "REQUEST ACCESS →" — 94×23px (class: btn-nav)
  - `<button>` "REQUEST INSTITUTIONAL ACCESS →" — 252×40px (class: btn-primary)
  - `<button>` "MEMBER LOGIN →" — 139×40px (class: btn-member)
  - ...and 27 more
- **7 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="text" name="f-name">` — 12px
  - `<input type="text" name="f-role">` — 12px
  - `<input type="text" name="f-firm">` — 12px
  - `<input type="email" name="f-email">` — 12px
  - `<select type="select-one" name="f-type">` — 12px
- **4 WCAG AA contrast failures (P1)**:
  - "Member" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "All" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.04)
  - "INFRA" — ratio 1.57 (min 4.5). fg=rgb(136, 136, 221) bg=rgba(100, 100, 200, 0.06)
  - "MEMBER LOGIN →" — ratio 1.74 (min 4.5). fg=rgb(138, 124, 104) bg=rgba(197, 165, 114, 0.04)

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/
- Screenshot: `screenshots/iphone-se-landscape-667-index.png`
- Layout: scrollWidth=667, clientWidth=667 ✓
- **29 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "REQUEST INSTITUTIONAL ACCESS →" — 252×40px (class: btn-primary)
  - `<button>` "MEMBER LOGIN →" — 139×40px (class: btn-member)
  - `<button>` "IOI →" — 37×17px 
  - `<button>` "IOI →" — 37×17px 
  - `<button>` "IOI →" — 37×17px 
  - ...and 24 more
- **7 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="text" name="f-name">` — 12px
  - `<input type="text" name="f-role">` — 12px
  - `<input type="text" name="f-firm">` — 12px
  - `<input type="email" name="f-email">` — 12px
  - `<select type="select-one" name="f-type">` — 12px
- **4 WCAG AA contrast failures (P1)**:
  - "Member" — ratio 1 (min 4.5). fg=rgb(90, 158, 114) bg=rgba(90, 158, 114, 0.07)
  - "All" — ratio 1 (min 4.5). fg=rgb(197, 165, 114) bg=rgba(197, 165, 114, 0.04)
  - "INFRA" — ratio 1.57 (min 4.5). fg=rgb(136, 136, 221) bg=rgba(100, 100, 200, 0.06)
  - "MEMBER LOGIN →" — ratio 1.74 (min 4.5). fg=rgb(138, 124, 104) bg=rgba(197, 165, 114, 0.04)


### forgot-password

- Viewport meta: `width=device-width,initial-scale=1`
- Safe-area-inset usage: **no — P1** (notched iPhones may clip critical UI)

#### android-360 — https://prism-plum.vercel.app/forgot-password
- Screenshot: `screenshots/android-360-forgot-password.png`
- Layout: scrollWidth=380, clientWidth=360 → **horizontal overflow 20px (P0)**
- **2 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "SEND RESET CODE →" — 294×41px (class: btn)
  - `<a>` "← Back to Login" — 63×9px (class: back)
- **1 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="email">` — 12px
- **1 elements with fixed width exceeding viewport (P0)**:
  - `<body>` 400px 

#### iphone-se-375 — https://prism-plum.vercel.app/forgot-password
- Screenshot: `screenshots/iphone-se-375-forgot-password.png`
- Layout: scrollWidth=388, clientWidth=375 → **horizontal overflow 13px (P0)**
- **2 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "SEND RESET CODE →" — 294×41px (class: btn)
  - `<a>` "← Back to Login" — 63×9px (class: back)
- **1 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="email">` — 12px
- **1 elements with fixed width exceeding viewport (P0)**:
  - `<body>` 400px 

#### iphone-14-390 — https://prism-plum.vercel.app/forgot-password
- Screenshot: `screenshots/iphone-14-390-forgot-password.png`
- Layout: scrollWidth=395, clientWidth=390 → **horizontal overflow 5px (P0)**
- **2 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "SEND RESET CODE →" — 294×41px (class: btn)
  - `<a>` "← Back to Login" — 63×9px (class: back)
- **1 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="email">` — 12px
- **1 elements with fixed width exceeding viewport (P0)**:
  - `<body>` 400px 

#### iphone-pro-max-414 — https://prism-plum.vercel.app/forgot-password
- Screenshot: `screenshots/iphone-pro-max-414-forgot-password.png`
- Layout: scrollWidth=414, clientWidth=414 ✓
- **2 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "SEND RESET CODE →" — 294×41px (class: btn)
  - `<a>` "← Back to Login" — 63×9px (class: back)
- **1 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="email">` — 12px

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/forgot-password
- Screenshot: `screenshots/iphone-se-landscape-667-forgot-password.png`
- Layout: scrollWidth=667, clientWidth=667 ✓
- **2 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<button>` "SEND RESET CODE →" — 294×41px (class: btn)
  - `<a>` "← Back to Login" — 63×9px (class: back)
- **1 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="email">` — 12px


### login-html

- Viewport meta: `width=device-width,initial-scale=1`
- Safe-area-inset usage: **no — P1** (notched iPhones may clip critical UI)

#### android-360 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/android-360-login-html.png`
- Layout: scrollWidth=360, clientWidth=360 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 296×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-se-375 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-se-375-login-html.png`
- Layout: scrollWidth=375, clientWidth=375 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 311×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-14-390 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-14-390-login-html.png`
- Layout: scrollWidth=390, clientWidth=390 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 326×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-pro-max-414 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-pro-max-414-login-html.png`
- Layout: scrollWidth=414, clientWidth=414 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 350×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-se-landscape-667-login-html.png`
- Layout: scrollWidth=667, clientWidth=667 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 93×21px (class: ts-back)
  - `<a>` "Forgot password?" — 253×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)
- **4 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="adv-email">` — 12px
  - `<input type="password" name="adv-password">` — 12px
  - `<input type="email" name="inv-email">` — 12px
  - `<input type="text" name="inv-code">` — 13px


### admin-portal-unauth

- Viewport meta: `width=device-width,initial-scale=1`
- Safe-area-inset usage: **no — P1** (notched iPhones may clip critical UI)

#### android-360 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/android-360-admin-portal-unauth.png`
- Layout: scrollWidth=360, clientWidth=360 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 296×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-se-375 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-se-375-admin-portal-unauth.png`
- Layout: scrollWidth=375, clientWidth=375 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 311×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-14-390 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-14-390-admin-portal-unauth.png`
- Layout: scrollWidth=390, clientWidth=390 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 326×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-pro-max-414 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-pro-max-414-admin-portal-unauth.png`
- Layout: scrollWidth=414, clientWidth=414 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 103×24px (class: ts-back)
  - `<a>` "Forgot password?" — 350×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)

#### iphone-se-landscape-667 — https://prism-plum.vercel.app/login
- Screenshot: `screenshots/iphone-se-landscape-667-admin-portal-unauth.png`
- Layout: scrollWidth=667, clientWidth=667 ✓
- **4 sub-44px tap targets (P1)** — Apple HIG minimum is 44×44 CSS px. Examples:
  - `<a>` "← Back to Site" — 93×21px (class: ts-back)
  - `<a>` "Forgot password?" — 253×14px (class: l-forgot)
  - `<a>` "Contact us" — 66×14px (class: l-link)
  - `<a>` "Apply for access" — 106×14px (class: l-link)
- **4 inputs below 16px font-size (P1)** — iOS auto-zooms on focus. Inputs:
  - `<input type="email" name="adv-email">` — 12px
  - `<input type="password" name="adv-password">` — 12px
  - `<input type="email" name="inv-email">` — 12px
  - `<input type="text" name="inv-code">` — 13px


---

## Cross-cutting issues

### CC-1 — investor-portal horizontal overflow scales with viewport
- 360→382 (22px), 375→398 (23px), 390→413 (23px), 414→439 (25px). The overflow is consistent. Same root cause every viewport — likely a single fixed-width inline element (KPI grid, deal card, or chip row) that doesn't collapse below a desktop breakpoint.
- **Fix scope: SAFE** — locate the offending selector and add a `@media (max-width: 768px)` block to make it flex/wrap. Risky only if the selector is also the desktop layout container (then it's RISKY and needs operator approval).

### CC-2 — index.html has dozens of small tap targets across all viewports
- 29-32 small tap targets per viewport. Mostly footer links, nav micro-copy, and "tier item" / "stat label" elements explicitly designed at 9–11px in the v2 polish pass (see CHANGELOG line 551).
- These are intentional desktop styling choices but break down on phones. Mobile rule of thumb: nothing tappable below 11px font / 44px hit area, even on a "register" aesthetic page.
- **Fix scope: SAFE** — bump the tappable footer/legal/nav elements to ≥11px font + ≥44×44px hit area in the mobile media query only.

### CC-3 — 7 inputs below 16px on index.html on every viewport
- Will trigger iOS auto-zoom-on-focus, jarring UX on phone forms. Likely the access-request form on the landing page.
- **Fix scope: SAFE** — `input { font-size: 16px }` inside the mobile media query. The visual effect is minimal but the UX gain is significant.

### CC-4 — Landscape (667×375) introduces 4 sub-16px inputs on the login screen
- Inputs that are 16px in portrait become smaller in landscape due to a percentage-based sizing somewhere.
- **Fix scope: SAFE** — pin login inputs to 16px regardless of orientation.

### CC-5 — No safe-area-inset handling detected on any portal
- Notched iPhone (iPhone 14, Pro Max) users will have content sliding under the notch + home indicator. Critical buttons in the bottom 1/3 may be partially obscured.
- **Fix scope: SAFE** — add `env(safe-area-inset-top|bottom|left|right)` padding to body/main wrappers in the mobile media query.

### CC-6 — investor-portal hero: badge/text overlap (visible in screenshot)
- The "INVESTOR DEMO" badge appears positioned with absolute or fixed coordinates that overlap the deal description text at small viewports.
- **Fix scope: RISKY** — repositioning may affect the desktop badge placement. Needs operator review of the desktop look before implementation. Add a media-query that converts the badge to a static block at the top of the deal card on mobile only.

---

## Risk classification summary

Categorizing each cross-cutting issue + per-page top defects by fix scope:

| ID | Issue | Scope |
|---|---|---|
| CC-1 | investor-portal overflow | **SAFE** (likely) — confirm offender is mobile-isolated |
| CC-2 | index.html small tap targets | **SAFE** — media-query only |
| CC-3 | index.html < 16px inputs | **SAFE** — media-query only |
| CC-4 | landscape login inputs shrink | **SAFE** — media-query only |
| CC-5 | no safe-area-inset | **SAFE** — additive CSS only |
| CC-6 | investor-portal badge overlap | **RISKY** — operator approval before edit |
| Login | dark-blue secondary buttons fail contrast | **RISKY** — desktop is also affected; operator decides |

---

## Methodology

- Tooling: Playwright 1.59.1, Chromium 1217 (headless), Node 24.14.1
- Mobile emulation: viewport + DPR + isMobile=true + hasTouch=true + iOS/Android UA per device
- Pages fetched against live prod (`prism-plum.vercel.app`); login flows used real seeded credentials (advisor: sarah@capitalgroup.sg / Advisor123!, investor: jwc@theaurumcc.com / 1234)
- All measurements computed in-page via `getBoundingClientRect()`, computed-style font-size, and CSS color → relative-luminance contrast math
- Screenshots: full-page PNG at native DPR
- No platform code touched; only files written are `mobile-audit/screenshots/*.png`, `mobile-audit/data/results.json`, this `MOBILE_AUDIT.md`, and the audit driver scripts under `mobile-audit/`

## What this audit cannot catch

- **Interaction defects** — modal dismissal, drawer behavior, scroll-lock, swipe gestures. Need manual phone testing.
- **Render-time animation jank** — 60fps scroll, layout shift on scroll. Need real-device profiling.
- **iOS Safari quirks** — Chromium emulates the layout but not Safari rendering bugs. Test on a real iPhone before sign-off.
- **Network throttling** — perceived speed on 3G/4G.
- **Admin-portal authenticated views** — operator credentials not provided; only login screen audited.

## Files produced

- `mobile-audit/screenshots/*.png` — 35 PNGs, full-page, native DPR
- `mobile-audit/data/results.json` — raw measurements per (viewport × page)
- `mobile-audit/run-audit.cjs` — the Playwright driver (rerunnable)
- `mobile-audit/build-report.cjs` — this report generator