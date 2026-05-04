# Mobile Audit v1 — Aurum Prism
Branch: mobile-responsive/v1
Date: 2026-05-03

---

## 1. Route Inventory

| File | Desktop layout | Mobile-readiness (1–5) | Status |
|---|---|---|---|
| `forgot-password.html` | Centered box 360px, form-only | 4 | Prior mobile-pass applied: box fluid, font 16px, safe-area |
| `reset-password.html` | Centered box 380px, form-only | 4 | Prior mobile-pass applied: same as above |
| `setup-password.html` | Centered box 380px, form-only | 4 | Prior mobile-pass applied: same as above |
| `login.html` | Two-column panel (advisor/investor) + operator bar | 4 | Prior 6-category fix applied: stack, scroll, tap targets, font |
| `index.html` | Fixed nav, hero 2-col, stats, features 3-col, tiers 3-col, form 2-col, footer 5-col | 4 | Prior mobile-pass + landing polish applied: nav collapses, hero stacks, tiers carousel |
| `advisor-portal.html` | Fixed top nav with tabs, deal switcher, tab panels, complex modals | 3 | Prior fixes: nav two-row, tap targets, grids. Gaps remain in nav height var, submit wizard |
| `investor-portal.html` | Fixed top nav with tabs, hero 2-col, deal grid, deal detail slide-in, modals | 3 | Prior fixes: nav two-row, deal stacking, iOS zoom. Gaps in IOI form, portfolio |
| `admin-portal.html` | Fixed top nav with tabs, KPI strip, pipeline table, IOI queue, AI tool | 3 | Prior fixes: nav two-row, KPI grid, pipeline collapse. Gaps in table overflow, modals |

---

## 2. Breakpoint Reality

All files have `<meta name="viewport" content="width=device-width,initial-scale=1">` (portals also include `viewport-fit=cover`).

**Existing media queries by file:**

- `forgot-password.html`: `@media(max-width:768px)` — box fluid, font-size 16px, safe-area. Complete.
- `reset-password.html`: Same as above. Complete.
- `setup-password.html`: Same as above. Complete.
- `login.html`: `@media(max-width:768px)`, `@media(max-width:640px)`, `@media(max-width:480px)` — 6-category fix plus mobile-pass. Substantially complete.
- `index.html`: `@media(max-width:900px)`, `@media(max-width:640px)`, `@media(max-width:768px)` — hero stack, nav collapse, tiers carousel, form stack, footer stack. Substantially complete.
- `advisor-portal.html`: Multiple breakpoints 600px–900px inside main style; plus `<link rel="stylesheet" href="/mobile.css">` and inline style blocks for nav/CAT fixes. Has remaining gaps.
- `investor-portal.html`: Multiple breakpoints 480px–768px. Has remaining gaps in nav height var and some panel layouts.
- `admin-portal.html`: Multiple breakpoints 480px–900px. Has remaining gaps in pipeline table overflow and some modal sizing.

---

## 3. Critical Issues Per Route

### forgot-password.html, reset-password.html, setup-password.html
- **RESOLVED**: Box is fluid, inputs are 16px, safe-area applied.
- **Minor gap**: `.back` / `a` link tap targets are 7px text — tap zone under 44px height. Low risk since `body` is flex-centered.
- **Minor gap**: `.btn` is 11px padding — renders ~38px tall. Fine given luxury aesthetic but could use `min-height:44px`.

### login.html
- **RESOLVED**: Two-column stacks, buttons scale, operator panel stacks.
- **Minor gap**: Operator panel inline `grid-template-columns:1fr 1fr` not overridden for ≤480px — email + password fields remain side-by-side on very small phones.
- **Minor gap**: `forgot-panel` (modal) lacks `role="dialog"` / `aria-modal="true"` but is in scope of JS not CSS.

### index.html
- **RESOLVED**: Nav collapses, hero stacks, tiers carousel, form stacks, footer stacks.
- **Minor gap**: Footer `.foot-top` has `grid-template-columns:2fr 1fr 1fr 1fr 1fr` — overridden to `1fr` at ≤900px which stacks all 5 columns vertically. This is correct behavior but produces a very tall footer.
- **Minor gap**: Stats bar still hidden at mobile (`display:none`) — acceptable per prior decision.

### advisor-portal.html
- **Gap 1**: `--nav-h` CSS variable set to `88px` in two-row mobile style but the outer `<style>` block for CAT-A–F fixes also redeclares it in `@media(max-width:768px)`. Redundant but not harmful.
- **Gap 2**: Deal submission wizard (`wiz-next`, `wiz-back`, `wiz-submit`) — buttons have `letter-spacing` CAT-A fix but no dedicated stacking. At 360px the wizard steps row overflows horizontally.
- **Gap 3**: VDR layout (`.vdr-layout`) stacks at 900px — correct. But `.vdr-section-hd` + upload buttons can still overflow letter-spacing on 360px.
- **Gap 4**: Deal header ring-side (`mini-ring-wrap`) hidden at 640px — correct.
- **Gap 5**: Performance tab `.perf-layout` stacks at 900px — but inside `.perf-ring-wrap` at 120px for 480px — correct.

### investor-portal.html
- **Gap 1**: Lobby hero stats row (`.hero-stats`) compresses but doesn't collapse cleanly at 360px — three stats side-by-side with borders overflow.
- **Gap 2**: IOI slider (`.ioi-slider`) has 44px touch target at 600px — correct.
- **Gap 3**: Deal detail overlay (`#view-deal`) is `transform:translateX(100%)` full-screen slide — on iOS this can cause scroll-locking. Needs `-webkit-overflow-scrolling: touch` inside the overlay.
- **Gap 4**: Allocation ring (`.alloc-ring-wrap`) hidden at 480px — correct.

### admin-portal.html
- **Gap 1**: Pipeline table (`.dp-row`) collapses to `1fr auto` at 640px but some intermediate columns (advisor, amount, bar) are hidden via display:none — correct approach, no gap.
- **Gap 2**: IOI table (`.ioi-row`) collapses at 640px — correct.
- **Gap 3**: Modal box (`.modal-box`) uses `width:90vw` — adequate. But `max-height` not constrained; tall modals may not scroll on iOS.
- **Gap 4**: View-as FAB (if present) — no mobile positioning concern since it's `position:fixed`.
- **Gap 5**: `--nav-h` var properly set to 88px in mobile.css.

---

## 4. Risk Register

| # | Risk | Area | Isolation strategy |
|---|---|---|---|
| 1 | mobile.css `modal-overlay` rule forces `border-radius:12px 12px 0 0 / bottom:0 / top:auto` on ALL `[class*="-panel"]` — this may affect notification panels on desktop | mobile.css, all portals | Rule is inside `@media(max-width:768px)` so desktop (≥769px) is safe |
| 2 | mobile.css `[class*="-row"]:not(...)` flex-wrap rule may cause unintended wrapping of custom row layouts | mobile.css | Rule is inside `@media(max-width:768px)` — monitor `ioi-row`, `dp-row` which are excluded |
| 3 | Adding `min-height:44px` to `.btn` class globally in mobile.css could cause oversized buttons in compact table cells | mobile.css | Already scoped to ≤768px; table-cell buttons are `att-btn` / `dp-btn` not `.btn` |
| 4 | `--nav-h:88px` set in multiple places (mobile.css, inline style blocks) — if one is removed the other maintains correct value | advisor/investor/admin portals | Redundancy is safe; last declaration wins |
| 5 | Index.html form field `select` has custom background-image for dropdown arrow — `font-size:16px` override must not remove the background image | index.html | Existing override only sets font-size, not background. Safe. |

---

## 5. Proposed Work Plan

All three auth pages and login.html and index.html have already received mobile treatment in prior sessions. The portals have partial treatment. The gaps are additive — small targeted additions only.

**Items in order of safety-first:**

1. **forgot-password.html** — Add `min-height:44px` to `.btn` and `.back`. (~8 lines)
2. **reset-password.html** — Same. (~8 lines)
3. **setup-password.html** — Same. (~8 lines)
4. **login.html** — Stack operator panel fields at ≤480px. (~6 lines)
5. **index.html** — Verify completeness; add `overflow-x:hidden` to `html` as belt-and-suspenders. (~4 lines)
6. **advisor-portal.html** — Fix wizard step overflow at 360px; ensure VDR letter-spacing; add modal max-height scroll. (~30 lines)
7. **investor-portal.html** — Fix hero-stats at 360px; add `-webkit-overflow-scrolling` to deal overlay; modal max-height. (~20 lines)
8. **admin-portal.html** — Add modal max-height scroll; verify pipeline table at 360px. (~15 lines)

---

## Changes Applied

_(updated as Phase 2 proceeds)_
