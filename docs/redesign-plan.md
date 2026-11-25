# Foundrio FAR Calculator: customer redesign + architect workspace

## Context

Foundrio wants the public FAR calculator to become (A) a simple customer tool that also brings in leads, and (B) an internal workspace for architects. Both must run on the same calculation engine and the same versioned rulesets. The brief asks for an audit first, then a plan, then a step-by-step build. This file covers both.

User decisions (2026-11-25):
- **No accounts for customers.** The architect workspace lives on a **separate subdomain**. Staff still log in there, because a hidden URL is not security and every override has to record who made it. There is no public sign-up.
- **Visual:** the brief's warm-white + deep forest green palette, keeping the **Century Gothic / Didact Gothic** brand font.
- **Enquiries:** saved to the dashboard **and** emailed to Foundrio.
- **Stack stays as is:** Next 16.4 + Turso/libSQL (the brief assumed Supabase, but the app doesn't use it). No migration.

---

## Milestone 1: Audit (done; findings)

**Architecture.** Next 16.4 App Router, React 19.3, zod 4, Leaflet, lucide, Tailwind 4 (mostly hand-written CSS in `src/app/globals.css`, 2,392 lines). Data is in Turso/libSQL (`@libsql/client`), with a local file DB in dev. Hosted on Vercel. CI runs lint, typecheck, vitest and build.

**Engine (keep as is).** `calculateFar(dataset, input)` in `src/lib/rules.ts` is already a pure function, separate from the UI: DAP-2025 Area/Road FAR, interpolation, averaging of existing and proposed road FAR, lower-of base and higher-of cap, the Rule 47(12) 0.1 gap, the Rule 47(3) +0.5 exception, Rule 47(7) widening, Art. 3.6.4.2 ×3 compensation for surrendered land, coverage tiers, and the A3 layout/parking/lift program through `src/lib/layout.ts`. Missing data throws `CalculationError`; it is never treated as zero. Tests are in `src/lib/rules.test.ts`, `layout.test.ts`, `mrt.test.ts` and `api/rules/import/route.test.ts`.

**Data.** The bundled ruleset `public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json` has 70 blocks (69 with polygons), 459 road-FAR rows, 39 occupancies, 12 incentives (2 automatic, 10 "enter approved FAR" inputs) and conversions for katha 720 / decimal 435.6 sq ft. Imported rulesets go into the `rule_sets` table (token-protected import and revert). That table is the only one; there are no users or saved assessments.

**UI.** `src/app/page.tsx` (1,964 lines) is a single client component with 5 sections. It already exposes architect-level controls to the public: manual FAR, hard locks, every incentive input, mixed occupancy, and the interactive layout engine. The PDF is `window.print()` plus a `.print-report` block, with CSV and share-by-query-string links (`?b=&a=&u=&r=…`).

**Bugs and gaps found**
1. **"No DAP blocks are loaded yet" / "No incentive rules…" show while loading.** The state starts as `emptyRuleDataset`, so the empty-state messages render before `/api/rules` returns. There is no retry on failure.
2. **Customers can change architect-only parameters.** Public `POST /api/calculate` accepts `manualFar`, `zoneOverride`, `lockedInputs` and any incentive values.
3. **Calculations aren't reproducible.** Results don't record the ruleset, engine version or time. `activateRuleDataset` deletes all but 9 inactive rulesets, and the bundled fallback has no identity at all.
4. The result card labels Road FAR as "Plot FAR".
5. Katha is hard-coded as `/720` in the summary, title, share text and mailto. It should use `dataset.areaUnitSqft.katha`.
6. Surrendered land defaults to `"0"`, so a zero shows before the user enters anything.
7. Raw zod issue paths reach customers (`resultErrorMessage`).
8. The print disclaimer says "user-provided ruleset", which is wrong for the bundled transcription.
9. Basement configuration, unit mix and non-A3 parking are **not modelled** by the engine. They must not be shown as calculated.

**Things that must not break:** existing share links, the `rules.test.ts` expectations, the ruleset import/revert API and the `DATA_IMPORT_TOKEN` flow, and `/api/health`.

---

## Shared foundations (built first, used by both UIs)

`src/lib/rules.ts` (additions only; no existing formula changes):
- `export const ENGINE_VERSION = "2026.11.1"`. Bump it whenever a formula changes.
- Add `trace: TraceStep[]` to `CalculationResult`, built inside `calculateFar` from values it already computes: `{ label, value, unit?, kind: "input" | "regulatory" | "derived" | "assumption", ref? }`. Examples: plot area entered → converted sq ft (input/derived), Area FAR for block (regulatory, Appendix 3.6), existing/proposed Road FAR for each occupancy (regulatory, Table 5), base = min (derived, Rule 47), automatic incentives, cap, the 0.1 gap or 47(3) exception when used, floor area with compensation, and the assumptions the engine actually uses (square plot when no frontage is entered, units/katha from the block, default floor heights, 25 m² per car). Both the "How was this calculated?" panel and the architect Calculation Engine view render this list.
- `customerCalculationInputSchema`: a strict subset (block, area and unit, existing/proposed road, widening exception, surrender, single occupancy, frontage). The server then fills the engine defaults (`zoneOverride: null`, `manualFarEnabled: false`, `incentiveIds: []`, `designValues: {}`, `lockedInputs: []`). Any architect field sent by a customer gets a 400.

`src/lib/database.ts`:
- `getActiveRuleDataset()` also returns `sha256` (bundled = hash of the JSON computed at load).
- New tables in `initializeDatabase` (same `CREATE TABLE IF NOT EXISTS` pattern):
  - `ruleset_snapshots(sha256 PK, dataset_json, created_at)`: `INSERT OR IGNORE` on every saved calculation, so every assessment can be re-run against the exact rules it used. `rule_sets` pruning stays as it is.
  - `assessments(id PK "FAR-XXXXXX", source customer|architect, status new|in_review|verified|closed, title, assigned_to, created_by, created_at, updated_at)`
  - `assessment_revisions(id, assessment_id, scenario, parent_id, input_json, result_json, baseline_result_json, overrides_json, ruleset_sha, engine_version, created_by, created_at)`. This table is **insert-only**: the customer's original is revision 1, and architect edits add new rows.
  - `enquiries(id, assessment_id, name, phone, email, message, email_sent, created_at)`
  - `audit_log(id, assessment_id, user_id, action, detail_json, created_at)` holds notes, status changes, overrides and assignments.
  - `users(id, email UNIQUE, name, role architect|admin, password_hash, disabled, created_at)` and `sessions(token_hash PK, user_id, expires_at)`.

New `src/lib/assessments.ts` (server-side): `runCalculation(input)` loads the ruleset, stores the snapshot, calls `calculateFar` and returns `{ result, rulesetSha, engineVersion, calculatedAt }`. Both APIs call it, so equivalent inputs give identical results. It also holds `createAssessment`, `addRevision`, `listAssessments` (summary columns come from `json_extract` on the latest revision), `getAssessment` and `addAudit`.

---

## Milestone 2: Customer calculator (`src/app/page.tsx`)

1. **Loading states.** Use `status: loading | error | ready` instead of the empty dataset. Show skeleton rows for the block list and occupancy, and on failure a friendly message with a **Retry** button (the fetch moves into a `loadRules()` function). The Calculate button stays disabled with a reason until rules are ready.
2. **Three guided steps** (reusing the current markup and CSS classes where possible):
   - **Step 1, Location & plot:** the existing block search and list plus the map `<details>`, plot area with unit (katha, decimal, sq ft and sq m first, the rest kept) and a live conversion line ("1 katha = 720 sq ft, ruleset standard"), and widest road width (ft/m), with a small inline SVG showing how to measure it.
   - **Step 2, Building use:** a required single-occupancy select, grouped by `occupancy.group`, with plain labels from the dataset. No default is applied.
   - **Step 3, "I have more technical plot information"** (`<details>`): frontage, proposed road width, surrendered land and the Rule 47(7) exception. It **opens automatically and marks fields required** when the rules need them (the existing `mandatoryWideningRequired` / `narrowRoadOutsideOldDhaka` logic). Surrender starts empty.
   - **Removed from customers:** zone override, manual FAR, hard locks, incentive inputs, layout/parking design inputs, mixed occupancy and the interactive LayoutEngine. Automatic incentives still apply and appear in the breakdown.
3. **Field help:** a short hint under each technical field, plus a lucide `CircleHelp` icon tied to its input with `aria-describedby`.
4. **Results:**
   - The hero is **Estimated total buildable floor area**, then applied FAR and the plot area used (net if land was surrendered).
   - Secondary results: storeys, apartments and car parking appear only when `buildingSummary` exists (A3); otherwise the card says why they aren't estimated. Max ground coverage and open space are listed as restrictions.
   - A **FAR breakdown** (Area FAR → Road FAR → base → automatic incentives → cap/exception → final) and **"How was this calculated?"** rendered from `trace`, grouped by kind.
   - The reference ID, ruleset name and date are shown.
   - Fix bugs 4–8.
5. **Saving:** `/api/calculate` saves every successful customer calculation as assessment + revision 1 and returns `reference`. If saving fails, the result is still returned, without a reference.
6. **Actions:**
   - **Download PDF:** keep `window.print()` (no new dependency), extend `.print-report` with the reference, inputs, breakdown, assumptions, ruleset and engine version, date and disclaimer.
   - **Share:** keep the query link.
   - **"Get your plot feasibility reviewed by Foundrio":** an inline form (name and phone required; email and message optional; hidden honeypot field) → `POST /api/enquiries` (zod-validated, `assessmentId` must exist) → saved, the assessment status is set to `new`, and an email goes out through `src/lib/email.ts` (plain `fetch` to the Resend API, no SDK). Email is skipped and logged if the env var isn't set. The call and mailto buttons stay.
7. **Visual:** retheme the `:root` tokens in `globals.css`: warm white background (~`#FAF8F4`), forest green primary (~`#1F4D3A`, checked for ≥4.5:1), muted greys, 8–12 px radius, result card in deep green instead of black, and `themeColor` in `layout.tsx`. The font stays.
8. Check mobile at 360, 768 and 1280 px: no horizontal scroll, and the existing `mobile-action-bar` keeps working.

**Checkpoint:** after M2 I stop and show you the customer UI before starting M3.

---

## Milestones 3 + 4: Architect workspace and integration

**Subdomain and access.** A new `src/proxy.ts` (Next 16's name for middleware):
- If `host === WORKSPACE_HOST`, rewrite `/…` to `/workspace/…`.
- On any other host, `/workspace*` and `/api/workspace*` return 404.
- In development, `WORKSPACE_HOST=workspace.localhost:3000` (browsers resolve `*.localhost`).
- On Vercel, add a domain such as `workspace.foundrio-bd.com` (or a second `*.vercel.app` alias) to the same project.

The proxy only hides the routes. The real check is `requireUser(role?)` inside every workspace route handler and page.

**Auth (`src/lib/auth.ts`, no new dependencies):**
- `node:crypto` scrypt password hashes and 32-byte random session tokens; only their SHA-256 is stored.
- `HttpOnly; Secure; SameSite=Lax` cookie on the workspace host, 7-day expiry.
- Login is rate-limited with the same pattern as `src/lib/data-import-auth.ts`.
- The first admin and further staff are created with `scripts/create-user.mjs` (`npm run create-user -- email name role`).

**API (`src/app/api/workspace/…`, each handler calls `requireUser`):**
- `login`, `logout`
- `assessments` (GET list / POST create)
- `assessments/[id]` (GET)
- `assessments/[id]/revisions` (POST: full `calculationInputSchema`, plus a `scenario` name and `overrides: [{ field, reason }]`)
- `assessments/[id]` (PATCH status/assign)
- `assessments/[id]/notes`
- Admin only: a ruleset import that reuses `activateRuleDataset`.

**Overrides:** when `manualFar` or `zoneOverride` is set, a reason is required for each field. The server runs the engine twice, without and with the override, and stores both results (`baseline_result_json`) as the original and overridden values, with the user and timestamp in `overrides_json` and `audit_log`. Overridden results carry an "Overridden" badge everywhere. A revision with overrides can only be set to `verified` by a different architect or an admin.

**UI (`src/app/workspace/…`, desktop-first, collapsible sidebar, denser tokens in a workspace stylesheet):**
- `login/page.tsx`
- **Dashboard** `page.tsx`: new enquiries first, recent assessments, status filter, assignee, "New assessment".
- **Assessment** `a/[id]/page.tsx` with section navigation:
  - **Site & Plot**
  - **Regulatory Parameters:** zone, Area/Road FAR, incentives, exceptions, sources.
  - **Building Configuration:** occupancy, including mixed; the existing `LayoutEngine` for A3. Basement and unit mix are shown as **"not modelled by the engine yet"**, with a notes field, not invented numbers.
  - **Parking & Compliance:** engine parking, coverage, stairs/lifts rows.
  - **Calculation Engine:** the full `trace`, per-occupancy road values, report fields, validation errors.
  - **Scenarios:** "Save as scenario"; a comparison table of the latest revision per scenario (FAR, floor area, storeys, units, cars, coverage, overrides, assumptions), a Δ column against scenario A and CSS bars for floor area (no chart library).
  - **Reports & Audit:** printable detailed report for any revision, revision history, override history, notes, status.
- A customer enquiry opens with revision 1 locked as read-only. "Edit" starts a new revision prefilled from it, so nothing is typed in twice.

**Code shared between the two UIs:** move the input components from `page.tsx` (`Select`, `RoadWidthField`, `DesignInput`, `Metric`, `ReportSectionCard`, block picker, `formatNumber`, `areaToSqft`) and the result pieces (`FarBreakdown`, `CalculationTrace`, `PrintReport`) into `src/components/far/`. The customer page and the workspace import the same pieces; there are no copies of formulas or validation.

---

## Milestone 5: Verification

- **Unit tests (vitest), added next to the existing ones:**
  - `rules.test.ts` passes **unchanged**, which proves the formulas are preserved.
  - Customer schema rejects architect fields.
  - `trace` values match the result fields.
  - The same input through `runCalculation` from the customer and architect paths gives identical results.
  - An override stores the baseline and requires a reason.
  - Password hash/verify works, and expired sessions are rejected.
  - The proxy host check gives 404 off-host and rewrites on-host.
  - Workspace routes return 401 without a session and 403 for the wrong role (same style as `route.test.ts`).
  - Enquiry validation and the honeypot work.
  - Calculation still works when the ruleset fails to load or the DB write fails.
- `npm run lint && npm run typecheck && npm test && npm run build`.
- **Manual run** (`npm run dev` + Chrome DevTools MCP):
  - Customer flow at 375/768/1280: loading skeleton, retry (block `/api/rules`), required-field errors, a widening case that auto-opens step 3, result, print preview, enquiry submit.
  - Then on `workspace.localhost:3000`: login, the enquiry in the dashboard, open it, override FAR with a reason, compare scenarios, print, and check the audit trail.
  - Confirm `/workspace` returns 404 on `localhost:3000`.
- **New env vars**, added to `.env.example` and the README: `WORKSPACE_HOST`, `RESEND_API_KEY`, `ENQUIRY_EMAIL_TO`, `ENQUIRY_EMAIL_FROM` (needs a domain verified with Resend).

## Deliberately skipped (say if you want them)

- An admin user-management UI; staff accounts are created by script.
- Server-side PDF generation; browser Save-as-PDF is used instead.
- Chart libraries.
- Bangla UI.
- Customer-side "my assessments" pages, since there are no customer accounts.
- Modelling basement and unit mix, which needs regulatory source data first.
