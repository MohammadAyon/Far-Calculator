# Session summary: 25 November 2026

Foundrio FAR Calculator: customer redesign (Milestone 1 audit + Milestone 2 customer calculator).
The full approved plan is in [`redesign-plan.md`](./redesign-plan.md).

**Status:** Milestone 2 is built and tested locally. **Nothing is committed or deployed yet.**
Milestone 3 (architect workspace) has not started; it waits on the database decision below.

---

## 1. What was asked

A master brief to turn the public FAR calculator into two products on one calculation engine:

- **Customer FAR Calculator:** simple, public, mobile-first, and a lead source for Foundrio.
- **Architect FAR Workspace:** internal and detailed: overrides, scenarios, audit trail, reports.

The brief asked for an audit first, then a plan, then a step-by-step build without inventing regulations or treating missing data as zero.

## 2. Decisions made today

| Topic | Decision |
|---|---|
| Customer accounts | None. Customers use the calculator and request a review without signing up. |
| Architect access | The workspace goes on a **separate subdomain**. Staff still log in there, because a hidden URL alone is not security and overrides must record who made them. |
| Visual style | The brief's palette (warm white, deep forest green, muted grey) with the **Century Gothic / Didact Gothic** brand font kept. |
| Enquiries | Saved for the architect dashboard **and** emailed to Foundrio (through Resend, once configured). |
| Database | Kept as is for now. **Supabase vs Turso is to be discussed later** (see section 7). |
| Pace | Build milestone by milestone, with a check-in after each. |

## 3. Audit findings (Milestone 1)

- **Stack:** Next.js 16.4, React 19.3, zod, Leaflet maps, lucide icons, hand-written CSS. Database is **Turso/libSQL**, not Supabase. Hosted on Vercel. CI runs lint, typecheck, tests and build.
- **Calculation engine:** `calculateFar()` in `src/lib/rules.ts` is already a clean, separate function implementing DAP 2022–2035 and Building Rules 2025 (Area/Road FAR, Rule 47 exceptions, road widening, surrendered-land compensation, coverage, and the A3 apartment layout/parking). It was **kept untouched**.
- **Data:** the bundled ruleset has 70 DAP blocks, 459 road-FAR rows, 39 building uses and 12 incentives. The only database table was `rule_sets`.

**Problems found**
1. "No DAP blocks are loaded yet" and "No incentive rules…" showed **while the data was still loading**, not because data was missing. There was no retry.
2. The public API accepted architect-only settings (manual FAR, zone override, incentive values).
3. Results weren't reproducible: no record of the ruleset version, engine version or time.
4. "Plot FAR" was the wrong label for Road FAR.
5. Katha was hard-coded as 720 in several places instead of read from the ruleset.
6. The surrendered-land field showed "0" before anything was entered.
7. Raw technical error details could reach customers.
8. The printed disclaimer wrongly called the ruleset "user-provided".

All 8 are fixed in Milestone 2.

## 4. What was built (Milestone 2)

### Customer experience (`src/app/page.tsx`)
- **New headline:** "Discover what you can build on your land."
- **Three guided steps:**
  1. **Location & plot:** area/DAP block search, filters, map, plot size (katha first, with a live conversion line), road width in ft or m, and a "How do I measure the road?" diagram.
  2. **Building use:** a required choice, grouped in plain words (Homes, Shops, Offices…).
  3. **"I have more technical plot information":** proposed road width, plot frontage, land given up for widening, and the widening exception. It **opens by itself and marks fields required** when the road is too narrow for the DAP.
- **Hints** under each technical field, linked for screen readers.
- **Loading states:** placeholder rows while loading; a clear error with a **Retry** button if loading fails; Calculate disabled with the reason shown.
- **Results**, with buildable floor area as the headline:
  - Applicable FAR and plot area used.
  - Storeys, apartments and car parking, shown **only for flats & apartments** (the only use the engine estimates); other uses get an explanation instead.
  - **FAR breakdown:** Area FAR → Road FAR → Base FAR → incentives → Maximum FAR → Final FAR.
  - **Development restrictions:** footprint and open space.
  - **"How was this calculated?"**, grouped as what was entered / from the regulations / calculated / assumptions, plus a "not checked by this calculator" list.
- **Actions:**
  - **Download report (PDF)** through the browser print dialog: reference, date, inputs, breakdown, calculation steps, ruleset and engine version, disclaimer.
  - **Share calculation:** link with the inputs.
  - **"Get your plot feasibility reviewed by Foundrio":** an inline form (name, phone, optional email and message, hidden spam trap). Call and email buttons stay.
- **Removed from the customer page** (they move to the architect workspace): CSV download, interactive layout tool, manual FAR, zone override, mixed use and incentive inputs.

### Shared engine and data (used by both products)
- `src/lib/rules.ts` (additions only, no formula changes):
  - `ENGINE_VERSION` to stamp every result.
  - A **calculation trace** listing every step, its value, its source and the rule reference.
  - A strict **customer input schema** that rejects architect-only fields.
- `src/lib/database.ts`:
  - The active ruleset now has an identity (SHA-256 hash).
  - New tables, created automatically and **additive only**: `ruleset_snapshots`, `assessments`, `assessment_revisions` (insert-only, so the customer's original is never overwritten), `enquiries`, `audit_log`, `users`, `sessions`.
- `src/lib/assessments.ts`: one `runCalculation()` used by every API, plus saving customer assessments with a phone-friendly reference (e.g. `FAR-ZP4MRU6A`) and recording enquiries.
- `src/components/far-result.tsx`: FAR breakdown and calculation-trace components shared with the future workspace.

### APIs
- `POST /api/calculate`: customer-only inputs. Saves the assessment and returns the reference, ruleset hash, engine version and time. If saving fails, the customer still gets the result.
- `POST /api/enquiries` (new):
  - validates the input;
  - drops spam-trap submissions;
  - links the enquiry to the saved calculation and marks it **New**;
  - emails Foundrio when `RESEND_API_KEY`, `ENQUIRY_EMAIL_TO` and `ENQUIRY_EMAIL_FROM` are set.

### Look and feel (`src/app/globals.css`, `src/app/layout.tsx`)
- Re-themed through the colour tokens: warm white background, deep forest green header, hero and result card, green step badges.
- Softer corners (8–12 px) and hairline borders.
- Contrast checked: primary green is 9.6:1 on white.

### Docs
- `.env.example` and `README.md`: the three optional email settings and how assessments are saved.

## 5. How it was verified

- **Tests:** 41 passing (was 28). The 28 original engine tests pass **unchanged**, which shows the formulas are preserved. New tests cover:
  - architect fields rejected from the public API;
  - customer and full-engine paths giving identical results;
  - trace values matching the result;
  - a failed save still returning a result;
  - enquiry validation, spam trap, unknown reference, and email sent or skipped.
- Lint, typecheck and production build are clean.
- **Live run** against the local dev server:
  - calculation → saved with a reference;
  - override attempt → rejected (400);
  - enquiry → saved, status `new`, audit entry written.
- **Visual check** in headless Edge (Chrome isn't installed): desktop 1280 px and mobile 390 px, full result, narrow-road case (step 3 auto-opens), data-load failure (Retry shown), and the print/PDF view. No sideways scrolling.

**Not verified yet**
- A real email through Resend (only tested with a mocked request).
- The production deploy.

## 6. Things to know

- **Not committed.** The changes are in the working tree only.
- **Local test data:** the local database (`data/far-calculator.db`, not in git) holds test assessments and one test enquiry from "Test Customer" (`FAR-ZP4MRU6A`), useful for testing the dashboard in Milestone 3.
- **First deploy:** the new tables are created automatically on the first request. Existing ruleset data is not touched.
- The build logs a Turso warning for `/api/health` and `/api/rules` when env vars are missing locally. This was already there before today and doesn't affect Vercel.

## 7. Open question: database (Turso vs Supabase)

**What we know**
- The live site at `far-calculator-eta.vercel.app` reports `"database": "connected"` and serves rules, so **a Turso database exists and production is using it**.
- If you don't see a Turso account, the database was most likely created through **Vercel's Storage / Marketplace integration**, which can create a Turso database under the Vercel account without a separate Turso login.
- **To find it:**
  - Vercel → Project → **Storage** tab, or **Settings → Integrations**;
  - or check **Settings → Environment Variables** for `TURSO_DATABASE_URL`, whose hostname shows the database name.

**Options to discuss**

| | Stay on Turso | Move to Supabase |
|---|---|---|
| Work now | None | Port the schema (small SQL changes, e.g. `json_extract` → `->>`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`), swap the database client, copy the `rule_sets` data |
| Architect login | Built-in login as planned (no new dependency) | Use Supabase Auth plus database row-level security instead |
| Ownership | Need to confirm who owns the Turso database | Foundrio-owned project with a dashboard and table editor |
| Matches the brief | Partly (brief assumed Supabase) | Yes |

**Recommendation:** decide this **before Milestone 3**, because the architect login (the first part of M3) is built differently on Supabase. Today's code only touches the database through `src/lib/database.ts` and `src/lib/assessments.ts`, so either choice is a contained change.

## 8. Next steps

1. **You:** find where the production database lives (section 7) and choose Turso or Supabase.
2. **You (optional):** create a Resend account, verify the foundrio-bd.com domain and add the three email env vars in Vercel.
3. Review the customer page locally, then commit and deploy Milestone 2.
4. **Milestone 3 + 4:** architect workspace on a subdomain:
   - staff login;
   - dashboard of enquiries;
   - assessment pages (Site & Plot, Regulatory, Building, Parking & Compliance, Calculation Engine, Scenarios, Reports & Audit);
   - overrides with reasons and reviewer sign-off;
   - insert-only revisions.
5. **Milestone 5:** full QA of both products together.

## 9. Files changed today

| File | Change |
|---|---|
| `src/lib/rules.ts` | Engine version, calculation trace, customer input schema |
| `src/lib/database.ts` | Ruleset identity, new tables |
| `src/lib/assessments.ts` | **New:** shared calculation runner, assessments, enquiries |
| `src/app/api/calculate/route.ts` | Customer-only inputs, saves assessment |
| `src/app/api/enquiries/route.ts` | **New:** review requests and email |
| `src/components/far-result.tsx` | **New:** shared breakdown and trace components |
| `src/app/page.tsx` | Customer calculator redesign |
| `src/app/globals.css`, `src/app/layout.tsx` | Green retheme and new component styles |
| `src/lib/rules.test.ts`, `src/app/api/calculate/route.test.ts`, `src/app/api/enquiries/route.test.ts` | Tests (13 new) |
| `.env.example`, `README.md` | Email settings and assessment notes |
| `docs/redesign-plan.md`, `docs/2026-11-25-session-summary.md` | **New:** this plan and summary |
