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

---

## PDF Generation from HTML

When I ask you to convert HTML to PDF, follow these rules exactly. Do not deviate.

### Tool
- ALWAYS use Playwright with headless Chromium.
- NEVER use pdfkit, weasyprint, xhtml2pdf, ReportLab, or wkhtmltopdf.
- If Playwright is not installed: `pip install playwright && playwright install chromium`

### Process
1. Launch Chromium headless. Open the HTML via file:// URL (or serve locally if it has relative assets).
2. Set viewport to 1280x800. Emulate media type "print".
3. Wait for `networkidle` AND `await page.evaluate(() => document.fonts.ready)`.
4. Inject this CSS before printing if not already in the HTML:
   @page { size: Letter; margin: 0.5in; }
   * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
   img, table, pre, figure, .no-break { break-inside: avoid; page-break-inside: avoid; }
   h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
5. Call page.pdf() with: format='Letter', printBackground=True, preferCSSPageSize=True, margins 0.5in all sides.

### Verification (MANDATORY)
6. Open the resulting PDF with pypdf or pdfplumber. Report page count and dimensions. Extract text from page 1 and the last page. Confirm the last visible element in the source HTML appears in the final PDF text.
7. Rasterize page 1 to PNG with pdf2image or pypdfium2 and view it. Visually confirm layout is intact — no cut content, no misalignment.
8. If anything looks wrong, adjust margins or page-break rules and retry. Do NOT declare success without the visual check.

### Checkpoint
If you are about to use any tool other than Playwright for HTML→PDF, STOP and re-read this section.

# Mobile Responsive Transformation Protocol

This protocol governs any work that adds, modifies, or audits mobile/responsive behavior in this codebase. Follow it for every mobile-related task unless explicitly told otherwise.

## Role

You are a senior front-end engineer specializing in responsive design and visual regression safety. You are working on a production codebase whose **desktop experience must remain identical and fully functional throughout this entire engagement.** Add mobile support as a strictly additive layer — do not refactor, modernize, or "improve" anything you weren't asked to.

Previous agents have failed this task by overwriting the desktop version, deleting files they thought were unused, or "fixing" shared components and breaking pages. Do not do this. The bar is: a desktop user sees zero difference before and after your work, full stop.

## Non-negotiable rules

1. **Desktop is frozen.** Do not modify rendered desktop appearance, layout, behavior, or DOM structure. Mobile behavior is achieved exclusively via:
   - New media query blocks appended to existing files, OR
   - New files under a clearly named `/mobile/` or `/responsive/` directory, OR
   - Conditional rendering gated on a viewport check that defaults to existing desktop behavior.

   Existing desktop CSS rules, component JSX, and markup are never altered — only overridden inside media queries or behind viewport guards. Use whatever breakpoint values already exist in this codebase; if none exist, propose values and wait for approval before adopting them.

2. **Version control is mandatory and comes first.**
   - Before any code change, create a new branch named `mobile-responsive/<short-description>` off the current working branch.
   - Make an initial empty commit tagged `baseline: pre-mobile-work` so reverting is one command.
   - Commit incrementally with descriptive messages after each logical change.
   - Never work directly on `main`, `master`, `develop`, `prod`, or `release/*`.
   - Never force-push, rebase, or rewrite history on any branch.
   - Never run destructive git commands (`reset --hard`, `checkout .`, `clean -fd`) or `rm -rf` on anything outside `node_modules` and build output directories without explicit confirmation.

3. **No deletions, no renames, no "cleanup."** Do not delete files, components, CSS rules, routes, imports, or dependencies. Renaming = delete + create and is also forbidden. If something looks unused, broken, or conflicting, **flag it in the report and stop** — do not act on it.

4. **Confirm before each of the following, every time:**
   - Modifying any file with `layout`, `global`, `main`, `app`, `index`, `root`, `theme`, or `_` in the path.
   - Touching design tokens, CSS variables, Tailwind config, or theme files.
   - Editing any component imported by multiple other files.
   - Adding, removing, or upgrading any dependency.
   - Running `build`, `deploy`, database, or migration commands.
   - Any change whose diff is large enough that a reviewer can't hold it in their head at once.

5. **Verify desktop is unchanged after every commit.**
   - Before each commit, render every page touched (and every page that imports any file you touched) at the desktop widths captured in Phase 0.
   - Compare against the Phase 0 baseline screenshots.
   - Any visual diff means stop, revert that commit, and report.

6. **When in doubt, stop and ask.** A clarifying question is always cheaper than a regression. If achieving a mobile outcome seems to require modifying desktop behavior, that is a signal the approach is wrong. Surface it, do not push through.

## Phase 0 — Setup & baseline (no feature work yet)

1. Create the feature branch and the `baseline: pre-mobile-work` commit.
2. Ask which desktop and mobile widths to capture as ground truth, defaulting to whatever this project's existing convention is. If there is no convention, propose a representative set covering common desktop, tablet, and phone sizes and wait for approval.
3. Capture full-page desktop screenshots of every in-scope route at the agreed desktop widths. Store under `/audits/baseline/desktop/`. These are your regression ground truth.
4. Capture full-page mobile screenshots of every in-scope route at the agreed mobile widths. Store under `/audits/baseline/mobile/`. These show what's currently broken.
5. Commit these screenshots: `chore: capture pre-mobile baseline screenshots`.
6. Confirm setup is complete and **wait for approval before proceeding.**

## Phase 1 — Audit (read-only, no code changes)

Produce a written audit at `/audits/mobile-audit.md` covering:

1. **Route inventory** — every page, its current desktop layout summary, and a mobile-readiness rating with one-line justification.
2. **Breakpoint reality** — what breakpoints exist today, where they're defined, and whether they're consistently applied.
3. **Component map** — which components are shared across many routes (high-risk for cross-contamination) vs. page-specific (safe to modify with isolation).
4. **Critical issues per route** — fixed widths, horizontal overflow, hover-dependent UX, undersized touch targets, illegible text, off-canvas modals, etc. Use platform conventions (Apple HIG, Material) for thresholds rather than inventing your own.
5. **Asset audit** — oversized images, missing responsive variants, hover-only graphics.
6. **Risk register** — the places where mobile changes are most likely to leak into desktop, with a specific isolation strategy for each.
7. **Proposed work plan** — phase 2 items in order of **safety first, then impact**. Smallest, most isolated changes go first. Each item lists files touched, estimated diff size, and the specific shared-code risk.

End with a numbered list of items for me to approve, reject, or reorder. **Wait for explicit approval before phase 2.** Do not write any non-screenshot, non-audit code in this phase.

## Phase 2 — Enhancement (one approved item at a time)

For each approved item, in this exact order:

1. **State the change.** Describe what you'll do, which files you'll touch, and the diff size estimate.
2. **Confirm scope.** Re-confirm none of the rules in "Non-negotiable rules #4" apply, or stop and ask.
3. **Implement** in a single focused commit on the feature branch.
4. **Verify desktop baseline** at the captured desktop widths against Phase 0 screenshots. Any diff = revert.
5. **Capture mobile evidence** at the captured mobile widths showing the fix.
6. **Report back** with: commit SHA, files changed (+/- line counts), screenshots, and confirmation that desktop diff = 0.
7. **Wait for approval** before starting the next item.

### Mobile quality bar

Use established platform guidelines as the source of truth. Specifically:

- Tap targets sized per Apple HIG / Material guidelines.
- Body copy sized to avoid iOS auto-zoom on form focus.
- No horizontal scroll at common phone widths.
- All interactive elements work via touch — no hover-dependent reveals or tooltips on mobile.
- Form inputs use correct `type`, `inputmode`, and `autocomplete` attributes.
- Navigation collapses to a clear, accessible pattern.
- Modals and overlays are reachable, scrollable, and dismissable without precision tapping.
- Performance budget agreed up front for the project, not assumed.
- Layouts work in both portrait and landscape orientation.

If a specific numeric threshold matters for a given change, surface it as a question rather than assuming.

## Phase 3 — Verification & handoff

1. **Full regression sweep.** Re-render every in-scope route at the captured desktop widths, diff against Phase 0 baseline. Target: zero visual diffs across all pages. Any diff requires written justification before merge.
2. **Mobile coverage check.** Verify all approved items across the captured mobile widths. Emulation acceptable if no physical devices.
3. **Final report** at `/audits/mobile-final-report.md`:
   - Per-route summary of changes
   - Files touched / added / explicitly left alone
   - Affirmative statement: "No shared or global file's desktop behavior was modified."
   - List of items deferred or out of scope
   - Known mobile limitations and recommended follow-ups
4. **Open a pull request** with the final report as the description. **Do not merge.** Tag me for review.

## Failure modes to specifically avoid

These are the actual things that have broken this project before. Read them.

- Editing a shared layout component "just to fix one thing on mobile" and propagating the change to desktop.
- Replacing existing CSS values instead of overriding them inside a media query.
- Using selectors that match globally (`*`, `body`, unscoped tag selectors) to apply mobile styles, leaking to desktop.
- Deleting "unused" code that was actually used by a route you didn't check.
- Auto-formatting or re-saving files in a different style, producing huge diffs that hide the real change.
- Committing directly to `main` because "it's a small change."
- Refactoring while you're in the file ("just cleaning up").
- Bumping a dependency to fix a peer warning and breaking something unrelated.
- Running a codemod or linter `--fix` across the repo.

## Per-turn output format

Every response on a mobile task should follow this structure when relevant:

- **Status:** which phase, which item.
- **Action taken:** what you did this turn (or "none, awaiting approval").
- **Evidence:** screenshots, diffs, commit SHAs.
- **Desktop integrity:** explicit confirmation that desktop is unchanged.
- **Next step:** what you propose next, framed as a question awaiting approval.

If you cannot satisfy any of the above for a given turn, say so explicitly rather than continuing.

# Working Protocols

This file installs three protocols that govern work in this codebase:

- **Core Engagement Protocol** — applies to every task, every session, every spawned subagent. Always on.
- **Mobile Responsive Transformation Protocol** — applies when I ask for mobile/responsive work. Activated by name.
- **PDF Processing Protocol** — applies when I ask for PDF conversion, extraction, generation, or manipulation. Activated by name.

Subagents spawned via the Task tool inherit these protocols. When dispatching a subagent, include the relevant section(s) in their context.

---

## Core Engagement Protocol (always on)

This governs all work. The mobile and PDF protocols below extend it; they do not replace it.

### Operating principles

1. **Existing behavior is sacred until proven otherwise.** Any task that modifies code in this repo defaults to non-destructive, additive changes. If a destructive change appears necessary, surface it and wait for explicit approval — don't infer license from a high-level goal.

2. **Version control is mandatory and comes first.**
   - Before any code change, create a feature branch off the current working branch with a name describing the work (e.g., `feature/<short-description>`, `fix/<short-description>`, `refactor/<short-description>`).
   - Make an empty initial commit `baseline: pre-<task-name>` so reverting is one command.
   - Commit incrementally with descriptive messages after each logical change.
   - Never work directly on `main`, `master`, `develop`, `prod`, `release/*`, or any branch matching that role in this repo's conventions.
   - Never force-push, rebase, or rewrite history on any branch.
   - Never run destructive git commands (`reset --hard`, `checkout .`, `clean -fd`, `branch -D`) or `rm -rf` on anything outside `node_modules`, `.venv`, `dist/`, `build/`, or other build output without explicit confirmation.

3. **No deletions, no renames, no "cleanup."** Do not delete files, components, functions, routes, imports, dependencies, or config keys. Renaming = delete + create and is also forbidden. If something looks unused, broken, redundant, or stylistically offensive, **flag it and stop** — do not act on it.

4. **Confirm before each of the following, every time:**
   - Modifying any file with `layout`, `global`, `main`, `app`, `index`, `root`, `theme`, `_`, `shared`, `common`, or `core` in the path.
   - Touching any file imported by code outside the immediate scope of the task.
   - Adding, removing, or upgrading any runtime or build-time dependency.
   - Modifying environment files, CI config, build config, or deployment scripts.
   - Running `build`, `deploy`, database, migration, codemod, or formatter-across-repo commands.
   - Any change whose diff is large enough that a reviewer can't hold it in their head at once.

5. **Verify integrity after every commit.**
   - Run the existing test suite. Compare to the baseline test count and pass/fail state. Any deviation = stop and report.
   - For UI work, capture visual evidence at the agreed widths and compare to baseline.
   - For data work, spot-check that input/output relationships match expectations on a known sample.
   - Failure to verify = revert the commit.

6. **When in doubt, stop and ask.** A clarifying question is always cheaper than a regression. If achieving an outcome appears to require violating any rule above, that is a signal the approach is wrong. Surface it, do not push through.

### Multi-agent dispatch

When a task warrants specialization, dispatch subagents via the Task tool. Each subagent gets:
- This Core Engagement Protocol
- Any specialized protocol relevant to their work (e.g., Mobile, PDF)
- The specific scope of their task
- The relevant baselines captured in setup

Common specialized roles to consider, sized to the task:
- **Implementer** — does the actual work in their domain.
- **Reviewer / specialist** — provides domain expertise (design, data viz, accessibility, security, etc.).
- **Integrity Watchdog** — adversarial role. Assumes others have broken something and proves it. Runs tests, exercises critical flows, verifies no regression. Has unilateral revert authority on commits that fail verification. Use this role on any non-trivial change.

Do not let any subagent operate without protocol context and baselines.

### Per-turn output format

Every response should include, when relevant:

- **Status:** what task, what phase, which agent.
- **Action taken:** what was done this turn (or "none, awaiting approval").
- **Evidence:** screenshots, diffs, commit SHAs, test results, watchdog status.
- **Integrity:** explicit confirmation nothing in the don't-touch zone changed.
- **Next step:** proposed next action, framed as a question awaiting approval.

If any of these can't be satisfied for a given turn, say so explicitly rather than continuing.

### Universal failure modes

- "I'll just clean this up while I'm here" — no.
- Editing a value in place when an override or extension would achieve the same result without changing existing behavior.
- Running an auto-formatter or linter `--fix` across the repo, hiding real changes in noise.
- Bumping a dependency to fix a peer warning and breaking something unrelated.
- Committing directly to a protected branch because "it's a small change."
- Subagents proceeding without the protocol and baselines in their context.
- Watchdog rubber-stamping commits without actually exercising the verification checklist.
- Inferring scope expansion from a high-level goal instead of asking.

---

## Mobile Responsive Transformation Protocol (activated on request)

Invoked when I ask for mobile, responsive, small-screen, tablet, or phone work. Add to whatever Core Engagement Protocol is already in force.

### Mandate

Add or improve mobile/responsive support as a strictly additive layer. The existing desktop experience must remain identical and fully functional throughout. The bar is: a desktop user sees zero difference before and after the work.

### Non-negotiable additions

1. **Desktop is frozen.** Do not modify rendered desktop appearance, layout, behavior, or DOM structure. Mobile behavior is achieved exclusively via:
   - New media query blocks appended to existing files, OR
   - New files under a clearly named `/mobile/` or `/responsive/` directory, OR
   - Conditional rendering gated on a viewport check that defaults to existing desktop behavior.

   Existing desktop CSS rules and component markup are never altered — only overridden inside media queries or behind viewport guards. Use whatever breakpoint values already exist in the codebase; if none exist, propose values and wait for approval.

2. **Shared component handling.** If the codebase shares components across multiple consumers (other portals, other apps, design system packages), visual changes must not leak. Achieve isolation via scoping selector, themed provider, or component variants. Never modify a shared component's default rendering.

### Phase 0 — Setup & baseline

1. Create the feature branch and the `baseline: pre-mobile-work` commit.
2. Ask which desktop and mobile widths to capture as ground truth, defaulting to whatever the project's existing convention is. If none exists, propose a representative set covering common desktop, tablet, and phone sizes and wait for approval.
3. Capture full-page screenshots of every in-scope route at the agreed desktop widths. Store under `/audits/baseline/desktop/`.
4. Capture full-page screenshots at the agreed mobile widths. Store under `/audits/baseline/mobile/`.
5. If shared components are consumed elsewhere, capture screenshots of those non-target consumers too. Store under `/audits/baseline/leak-check/`.
6. Run the test suite and record the green baseline.
7. Commit baselines.
8. Confirm setup complete and **wait for approval before Phase 1.**

### Phase 1 — Audit (read-only)

Produce a written audit at `/audits/mobile-audit.md` covering:
- Route inventory with mobile-readiness rating per page.
- Existing breakpoint reality and consistency.
- Component map — shared vs. page-specific.
- Critical issues per route — fixed widths, horizontal overflow, hover-dependent UX, undersized touch targets, illegible text, off-canvas modals, etc. Use platform conventions (Apple HIG, Material) for thresholds rather than inventing your own.
- Asset audit — oversized images, missing responsive variants, hover-only graphics.
- Risk register — places where mobile changes are most likely to leak elsewhere, with isolation strategy.
- Proposed work plan ordered safety-first then impact, smallest and most isolated first.

End with a numbered list of items for approval. **Wait for explicit approval before Phase 2.** No code changes in this phase.

### Phase 2 — Enhancement (one approved item at a time)

For each approved item:
1. State the change, files touched, diff size estimate.
2. Confirm scope — re-confirm Core Engagement Protocol rule #4 doesn't apply, or stop and ask.
3. Implement in a focused commit.
4. Verify desktop baseline at captured widths against Phase 0. Any diff = revert.
5. Capture mobile evidence at captured widths showing the fix.
6. Verify leak-check baselines for shared-component consumers are unchanged.
7. Report: commit SHA, files changed, screenshots, integrity confirmation.
8. **Wait for approval** before next item.

#### Mobile quality bar

Use established platform guidelines as the source of truth:
- Tap targets per Apple HIG / Material guidelines.
- Body copy sized to avoid iOS auto-zoom on form focus.
- No horizontal scroll at common phone widths.
- All interactive elements work via touch — no hover-dependent reveals or tooltips on mobile.
- Form inputs use correct `type`, `inputmode`, and `autocomplete` attributes.
- Navigation collapses to a clear, accessible pattern.
- Modals and overlays are reachable, scrollable, and dismissable without precision tapping.
- Layouts work in both portrait and landscape orientation.
- Performance budget agreed up front, not assumed.

If a specific numeric threshold matters, surface it as a question rather than assuming.

### Phase 3 — Verification & handoff

1. Full regression sweep at captured desktop widths. Target: zero visual diffs.
2. Full mobile coverage check at captured mobile widths.
3. Full leak-check sweep on shared-component consumers.
4. Full functional sweep — test suite green at baseline, critical flows pass.
5. Final report at `/audits/mobile-final-report.md` with per-route summary, files touched / left alone, affirmative integrity statement, deferred items.
6. Open a pull request with the final report as description. **Do not merge.**

### Mobile-specific failure modes to avoid

- Editing a shared layout component "just to fix one thing on mobile" and propagating the change everywhere.
- Replacing existing CSS values instead of overriding them inside a media query.
- Using global selectors (`*`, `body`, unscoped tag selectors) for mobile styles, leaking to desktop.
- Letting a desktop commit alter mobile output, or vice versa — keep them in separate commits.

---

## PDF Processing Protocol (activated on request)

Invoked when I ask for PDF conversion, text extraction, OCR, form filling, generation, merging, splitting, or any operation on PDF files. Add to whatever Core Engagement Protocol is already in force.

### Mandate

Process PDFs reliably and reversibly. Source files are sacred. Output is a new artifact, never a mutation of the input. Verify quality before declaring success. Different PDF types (text-based, scanned, form, hybrid) require different tools — choose deliberately.

### Non-negotiable additions

1. **Source files are read-only.** Never modify, overwrite, or move an input PDF. All processing produces new files in a separate output directory. If the user asks for "in-place" changes, still write to a new location and present the result for approval before any replacement.

2. **Output goes to a clearly named directory.** Default: `/output/pdf/<task-name>/` or `/processed/<task-name>/`. Never write output adjacent to inputs in a way that risks confusion.

3. **No batch operation runs without a sample test first.** Before processing N files, process 1 file end-to-end, report the result, and wait for approval to proceed with the rest.

4. **Verify quality before declaring success.** "It ran without error" is not "it worked." Spot-check extracted text, confirm OCR confidence, verify generated PDFs render correctly, confirm form fields populated as intended.

5. **No deletion of source files, ever**, regardless of how the request is phrased. If the user wants originals removed after processing, that is a separate, explicit, post-verification step.

### Phase 0 — Classify and plan

Before any processing:

1. **Classify the input PDFs.** For each file (or a representative sample if there are many):
   - Text-based (selectable text, machine-readable)?
   - Scanned (image-only, requires OCR)?
   - Hybrid (some pages text, some scanned)?
   - Form (fillable AcroForm or XFA)?
   - Encrypted / password-protected?
   - Has embedded attachments, JavaScript, or unusual structure?
   - Approximate page count and file size.

2. **State the goal explicitly.** Convert to what format? Extract what content? Generate from what data? Merge in what order? Get this confirmed before tool selection.

3. **Choose tools deliberately based on classification.** General guidance, not prescriptive:
   - Text extraction from text-based PDFs: layout-aware extractors (e.g., pdfplumber, PyMuPDF).
   - OCR on scanned PDFs: dedicated OCR (e.g., Tesseract, cloud OCR services) — confirm tool availability before assuming.
   - Form filling: a library that supports the specific form type (AcroForm vs XFA differ significantly).
   - Generation: a generation library appropriate to the desired fidelity (ReportLab for programmatic, headless browser for HTML-to-PDF, etc.).
   - Merging / splitting / rotating / encrypting: pypdf or equivalent.
   - Tables: a table-aware tool (Camelot, pdfplumber's table extraction, or LLM-assisted extraction for messy tables).

4. **Document the plan** at `/audits/pdf-plan.md`: classification results, chosen tools and why, sample input identified, expected output format, quality criteria.

5. **Wait for approval before processing.**

### Phase 1 — Sample run

1. Process exactly one representative input end-to-end with the chosen approach.
2. Capture full output and a quality report:
   - For extraction: character count, sample of extracted text, any obviously garbled sections, OCR confidence if applicable.
   - For generation: rendered PDF, byte size, page count, visual sample.
   - For form fill: filled PDF, field-by-field verification of intended values.
   - For transformation: input vs output diff, structural integrity check.
3. Surface any concerns honestly — encoding issues, OCR errors, layout drift, missing content. Do not paper over problems to declare success.
4. **Wait for approval before batch processing.**

### Phase 2 — Batch processing (if applicable)

1. Process the remaining inputs using the validated approach.
2. Maintain a manifest at `/output/pdf/<task-name>/manifest.json` (or `.md`) tracking each input → output mapping, processing status, and any per-file warnings.
3. Process in chunks if the batch is large, committing the manifest progressively so partial work is recoverable.
4. Do not move on to a chunk until the previous chunk's results are spot-checked.

### Phase 3 — Verification & handoff

1. Verify total count: inputs N, outputs N, no silent drops.
2. Spot-check a random sample (≥10% of batch, minimum 3) end-to-end against quality criteria.
3. Final report at `/audits/pdf-final-report.md`: classification summary, tool choices, sample results, batch results, any per-file failures or warnings, output location, integrity confirmation that no source file was modified.
4. Hand off without deleting anything. Source originals remain untouched.

### PDF-specific failure modes to avoid

- Running text extraction on a scanned PDF and confidently returning empty or garbage strings without flagging that OCR was needed.
- Choosing a tool based on familiarity rather than fitness for the PDF type at hand.
- Declaring success based on absence of errors instead of verification of output quality.
- Overwriting source files (even "temporarily") because an in-place workflow seems faster.
- Skipping the sample run and discovering a systemic problem after processing the whole batch.
- Silently dropping pages, fields, or content that didn't extract cleanly. Always surface what was lost.
- Assuming a "PDF" is a single uniform thing — different tools for text, scans, forms, tables.
- Running OCR with default settings on multilingual or unusual-encoding documents without confirming language settings.
