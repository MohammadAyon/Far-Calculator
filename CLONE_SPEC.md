# CLONE_SPEC — farcalculator.com (black-box study)

Studied 2026-11-25. Sources:

- **Saved page**: `5.0 Katha বসুন্ধরা আবাসিক _ (FAR 4.10) _ ….html` and its `_files/` folder (rendered DOM after a logged-in calculation).
- **Bundle**: `_files/index-zDuvJRPT.js.download` (3.5 MB, minified Vite/React). The live site serves the same file name, `/assets/index-zDuvJRPT.js`, so the saved bundle is the current build.
- **Live HTTP**: `curl` of `/`, `/sitemap.xml`, `/api/rajuk-rules`.
- **Live session**: Brave driven over the Chrome DevTools Protocol while signed in with Google. All network traffic was recorded while entering inputs and switching tabs. Results are in section 8.

Evidence tags: **SEEN** = in DOM, bundle or HTTP response. **LIVE** = observed in the signed-in session. **INFERRED** = deduced from adjacent code. **UNKNOWN** = not verified.

---

## 1. Stack and hosting

| Item | Finding | Tag |
|---|---|---|
| Frontend | React SPA built by Vite, Tailwind classes, react-router | SEEN |
| Server | Express behind Google Frontend / Firebase Hosting (`X-Powered-By: Express`, `Server: Google Frontend`) | SEEN |
| Auth + data | Firebase Auth and Firestore (named database), Firebase Storage | SEEN |
| Maps | Google Maps JS API via `@vis.gl/react-google-maps`; Leaflet also bundled | SEEN |
| Analytics | GA4 (page views sent manually on route/tab change), Meta Pixel | SEEN |
| Export | html2canvas, pdfkit, spreadsheet export with live formulas | SEEN |
| AI | Server routes `/api/gemini/optimize-layout`, `/api/gemini/search-location` | SEEN (names) / UNKNOWN (payloads) |

## 2. Routes

SEEN in bundle and sitemap: `/`, `/guide/far-calculation`, `/guide/setback-rules`, `/guide/mgc`, `/guide/dap-zones`, `/faq`, `/privacy`, `/terms`. Server re-renders SEO head per route (title becomes e.g. "5.0 Katha বসুন্ধরা আবাসিক * (FAR 4.10) | …" after a calculation).

## 3. User-visible features

### 3.1 Header
- Brand "FAR Calculator · RAJUK DAP 2025", links to the guide routes. SEEN
- Tabs: **Calculator**, **RAJUK Guidelines**, **Detailed Calculation** (badge NEW). SEEN
- Share App, Feedback, session timer ("39m session"), signed-in user name, **Export**. SEEN
- Light/dark theme stored in `localStorage.far_theme_mode`. SEEN

### 3.2 Location / block picker
- Search box over 68 DAP density blocks (Bangla name, English name, keywords). SEEN
- Filters: type (All / Planned P / Spontaneous S) and zone (Z1 Central / Z2 Outer / Z3 Suburban). SEEN. Type codes N and O also exist in data. SEEN
- Each card: block id, name, type letter, ward list, **DAP aFAR**, **Density p/ac**. SEEN
- Block record fields: `id, btype, name, area, zone, ppa, avgSqft, upk, aFar, lat, lng, enName, enKeywords`. SEEN
- Google Map with MRT-6 station markers, tap to drop a pin, shows "COORDINATES OF THE POINT YOU TAPPED" with Copy, link to masterplan.rajuk.gov.bd to confirm block. SEEN
- Whether a map tap auto-selects the block: UNKNOWN.

### 3.3 Plot and road inputs
- Plot area with units: Katha, Sft, Sqm, Shotangsho/Decimal, Chatak, Bigha/Paki, Acre, Hectare. Live hint "≈ 5.00 Katha (3,600 Sft)". SEEN. Katha = 66.8903 sqm = 720 sft. SEEN
- Existing road width (ft or m), DAP proposed road width (ft or m). SEEN
- Surrendered land for road widening, "Easement Deed 3× Bonus". SEEN. Exact 3× formula: UNKNOWN.

### 3.4 Occupancy
- Single / Mixed occupancy toggle. SEEN
- Bidhimala 2025 Appendix 3 list, A1–A6 residential and B1–M non-residential (40 codes). SEEN
- Mixed mode needs a valid commercial FAR area, else message "Mixed Occupancy: enter a valid Commercial FAR Area …". SEEN

### 3.5 Zone override
- Auto from block zone, or force Z1 / Z2 / Z3. SEEN

### 3.6 FAR incentives (DAP Table 3.28)
- **Group 1 plot amalgamation**, auto from plot size: 3–6 katha +0.20, 6–10 +0.35, 10–15 +0.50, 15–20 +0.65, >20 +0.75. Active tier highlighted. SEEN
- **Road > 30 ft** auto bonus `min((road_ft − 30) × 0.02, 1.0)`. SEEN
- A6 (ক) +0.50 needs ≥10 katha. A6 (খ) +0.75 needs ≥20 katha. Only one Group 3 item applies, never for A6 itself. SEEN
- Green building +0.50. Public open space +0.50 needs ≥10 katha. SEEN
- **TOD (MRT-6)**: distance in metres, ≤300 m +1.00, 300–500 m +0.75, 500–800 m +0.50. SEEN
- Manual-value items: TDR purchase, FAR purchase from RAJUK, new school, playground, park. SEEN
- Non-residential occupancy disables all incentives; pFAR alone governs. SEEN

### 3.7 FAR assessment card
- Shows Approved FAR, Calculated FAR, Base FAR, Max FAR Cap, aFAR, Saroni 5 pFAR. SEEN
- Manual FAR override with validation ("Enter a Manual FAR val…"). SEEN
- Rule, SEEN in `oh()`:
  - `base = aFar > 0 ? min(aFar, pFar) : pFar`, `max = max(aFar, pFar)`.
  - If `max − base ≤ 0.10`, FAR = max. Otherwise FAR = `min(base + incentives, max)`.
- pFAR comes from Saroni 5 by zone and occupancy over 9 road-width bands, with interpolation. SEEN (table `Om`). Exact band edges `bd`: UNKNOWN.
- Reserved blocks (btype N or aFar 0) block calculation with a prohibition note. SEEN
- Upsell "Want More FAR? +0.50 with Green Building / EDGE → Check Eligibility" posts to `/api/edge-enquiry`. SEEN (route) / UNKNOWN (payload)

### 3.8 Ground coverage (Saroni 3)
Band table SEEN (`ax`): e.g. 268–402 sqm (4–6 katha) min 46.5%, max 62.5%, open 37.5%, rain 18.75%. A6 has its own row.
- Max basement footprint = max MGC + ½ open space. SEEN
- Rainwater permeable = `rain`%. SEEN

### 3.9 Setbacks (Saroni 8)
Storey tiers SEEN: ≤7 storeys side 1.0 m (0.8 m if plot < 3 katha) rear 1.25 m; 8–10 side 1.25 rear 2.0; 11–15 3.0/3.0; 16–20 3.25/3.25; 21–30 3.5/3.5; >30 4.5/4.5. Multi-building adds 5 m between buildings. Front setback is road-dependent. Front rule details: UNKNOWN.

### 3.10 Building layout engine
- Total FAR area, units, max units, G+n range (highest at min MGC, lowest at max MGC), "AI Preferred", FAR utilisation %. SEEN
- **Max units** = `ceil(katha × upk × 1.1)` for regular plots. SEEN
- Hard-lock checkboxes; unlocked fields auto-solve to 100% FAR. SEEN
- Circulation (SLL) by katha: ≤10 → 218 ft², ≤20 → 300, ≤30 → 435, else 570. Plus UPF lobby allowance: 1–2 units/floor 0, 3–4 +40, 5–6 +80, 7–8 +120, then +20 each. SEEN
- Side balcony = 2.5% of (unit + circulation + fire stair + front balcony). SEEN
- Front balcony needs site front length. SEEN. Formula: UNKNOWN.
- "AI Optimize" calls `/api/gemini/optimize-layout`. SEEN (route) / UNKNOWN (contract)

### 3.11 Floor heights
Defaults SEEN: plinth 0.75 m, GF 3.6 m, mezzanine 2.4 m, typical 3.0 m, rooftop allowance 4.65 m. Total height shown in m and ft. Mezzanine can be excluded.

### 3.12 Parking (Rule 40)
Unit-size bands SEEN (`She`): ≥200 sqm 1 car / 200 sqm + 5% guest, 140–200 sqm 2 cars / 3 units, 90–140 1 car / 2 units, 60–90 1 car / 4 units, ≤60 motorcycle only. Max allowed = 2× required. Car stall counted in FAR at 114 sft. SEEN. How "6 cars" arises for 7 flats of 148 sqm: UNKNOWN (plain rule gives 5).

### 3.13 Stairs and lifts
SEEN:
- 1 main stair per building, plus 1 fire stair when required.
- Main stair width by occupancy: A1/A2/A6 1.0 m, A3 1.15 m, other A 1.25 m, B 1.25 m (2.25 m if > 300), C 1.5, D 2.25, E 1.5, F 1.5 (F2 or > 300 → 2.0), G/H 1.5, I 2.0, else 1.25.
- Parking connecting stair 1.15 m.
- Lifts per building: 0 below 6 storeys, 1 for 6–10, 2 above 10.
- Peak 5-min demand = `max(1, ceil(round(units × 3.5) × 0.12))`. Lift model = smallest of 4P/320, 6P/450, 8P/630, 10P/800, 13P/1000, 16P/1250 kg with persons ≥ ceil(peak ÷ lifts).

### 3.14 Aviation height
"Preliminary" panel from a separate CAAB obstacle-surface engine (HSIA / Tejgaon overlap, regulatory date window). SEEN (names). Surface geometry and limits: UNKNOWN.

### 3.15 Other
- Tutorial video (YouTube nocookie embed), WhatsApp "Chat with Expert", feedback, payment/subscription flows. SEEN
- Detailed Calculation tab exports a spreadsheet with formulas. SEEN

## 4. State transitions

1. **Boot**: loader `#app-loading-screen` removed when `#root` gets children. SEEN
2. **No block** → results hidden. INFERRED
3. **Block selected** → aFAR, zone, density loaded. Reserved block → prohibited state. SEEN
4. **Plot + road entered** → FAR, MGC, setbacks, layout, parking, stairs recompute on every change. No "Calculate" button seen. INFERRED
5. **Occupancy non-residential** → incentives panel greyed out. SEEN
6. **Mixed occupancy** without valid commercial area → residential layout replaced by error. SEEN
7. **Manual FAR on** → Approved FAR shows override after validation. SEEN
8. **Plot crosses katha tier** → amalgamation tier and locked incentives change. SEEN
9. **Storey count crosses 6 / 10** → lift requirement changes. SEEN
10. **Signed in** → session timer, name, Export. SEEN. Signed-out limits: UNKNOWN.

## 5. Network requests

| Request | When | Tag |
|---|---|---|
| `GET /assets/index-zDuvJRPT.js`, CSS | load | SEEN |
| Google Maps JS + tiles (`maps.googleapis.com`) | map shown | SEEN |
| GA4 `gtag` events, Meta Pixel `PageView` | load, route/tab change | SEEN |
| Firebase Auth (`securetoken.google.com`, identity toolkit) | sign-in, token refresh | SEEN |
| Firestore listen/write channels | user data, submissions | SEEN (client) / UNKNOWN (collections) |
| `GET /api/rajuk-rules` | RAJUK Guidelines tab | SEEN: returns a separate HTML "Reference Tool" page based at `rajuk-rules.web.app` |
| `POST /api/gemini/search-location` | location search | SEEN (route) / UNKNOWN (body) |
| `POST /api/gemini/optimize-layout` | AI Optimize | SEEN (route) / UNKNOWN (body) |
| `POST /api/edge-enquiry` | Check Eligibility | SEEN (route) / UNKNOWN (body) |
| `POST /api/send-email`, `/api/send-receipt`, `/api/send-rejection`, `/api/notify-admin-payment`, `/api/notify-admin-subscription-request`, `/api/resend/status` | payments, admin | SEEN (route) / UNKNOWN (body) |
| `/api/cron/send-daily-drip` | server cron | SEEN (route) |

Share links read `?b=` and `?r=` query params, and `?id=`. SEEN. Their meaning: UNKNOWN.

localStorage keys SEEN: `far_theme_mode`, `user_gmaps_api_key`, `rajuk_project_submission_meta`, `dap_sender_name`, `dap_sender_email`, `dap_saved_msg_templates`.

## 6. Edge cases

- Reserved / non-buildable block → no FAR. SEEN
- Plot or road missing → "No FAR data — enter plot size and road width." SEEN
- Saroni 5 cell −1 → "Road too narrow for this building type." or a data-gap message for unlisted types. SEEN
- Max − Base ≤ 0.10 → max applied directly, incentives ignored. SEEN
- Group 3 incentives mutually exclusive and blocked for A6. SEEN
- Amalgamation thresholds use `katha + 0.01` to absorb rounding. SEEN
- Plot < 3 katha → 0.8 m side setback up to 7 storeys. SEEN
- Old Dhaka blocks get a 10–20 katha amalgamation tier. SEEN
- Floor-height input 0 allowed only for plinth and mezzanine. SEEN
- Parking above 2× required consumes FAR at 114 sft per stall. SEEN

## 7. This repo versus the target

The Next.js app here already covers 3.2–3.7, 3.8 (except basement), 3.9, 3.10 (density cap, balcony, circulation), and 3.12. Reference case Block-03, 5 katha, 25 ft road, A3:

| Output | This repo | farcalculator.com | Note |
|---|---|---|---|
| pFAR | 3.375 | 3.39 | Same Saroni 5 table, different interpolation. UNKNOWN which matches RAJUK practice |
| Approved FAR | 3.575 | 3.59 | Follows pFAR |
| Min MGC | 56.5% | 46.5% | Site table row 268–402 sqm says 46.5. Check against the gazette |
| Cars / bikes | 3 / 0 | 6 / 2 | Repo uses Rule 53 Table 8, site uses Rule 40 bands |
| Circulation / floor | 8 ft² | 218 ft² | Site uses fixed SLL table |
| Stairs, lifts | missing | 1 stair, 1 lift 4P | **Added in this change** |
| Basement footprint | missing | 81.25% | **Added in this change** |

The live site also accepts a 12 ft road with pFAR 2.00 and no error. This repo instead stops and asks for a DAP widening to at least 19.69 ft.

Deliberately not cloned: aviation engine, Firebase auth and payments, Gemini routes, EDGE enquiry, email/drip, video and WhatsApp widgets. The statutory numbers above were left as they are: they differ from the site and need a gazette check first, not a copy.

## 8. Live session results (signed in, 2026-11-25)

### 8.1 Access and session
- **Sign-in wall.** A signed-out visit to `/` redirects at once to Google sign-in via Firebase Auth (`firebaseapp.com/__/auth/handler`). No calculator is shown before sign-in. LIVE
- **Session counter.** The header shows "Nm session". It read 41m about 5 minutes after sign-in, so it most likely counts down from 45 minutes. INFERRED. What happens at zero: UNKNOWN.
- **Nag dialog.** A "One small favour … Like our Facebook page" dialog appears during use. LIVE
- **Detailed Calculation tab** is a paywall titled "Unlock Detailed Calculation · PREMIUM". It offers ৳500/month for the first 3 months (normally ৳1,000) or ৳8,000/year (normally ৳12,000). Payment is by manual bKash verification, valid for A3 only, and single-user. It promises saved projects, a floor-wise unit mix, NOC and RAJUK reports, and "no timeouts". LIVE
- **RAJUK Guidelines tab** embeds `/api/rajuk-rules` in an iframe. LIVE
- **Export** showed no dialog, print or download for a signed-in free user. Its real effect: UNKNOWN.
- **Share App** opens the operating-system share sheet, which waits for a person. INFERRED from the script stalling. Its payload: UNKNOWN.

### 8.2 Network during calculation
- **No calculation API.** All maths runs in the browser. Changing inputs sends no request to the site's own server. LIVE
- **Every recalculation saves to Firestore.** Each input change that produces a result sends a write to the collection `calculations/<auto-id>` over the Firestore Write channel. 9 writes were sent for 11 probe steps. LIVE
- Document fields, LIVE: `userId, userEmail, userName, userPhoto, projectName, blockId, blockName, roadWidthMeters, roadWidthFt, dapProposedRoadMeters, dapProposedRoadFt, plotAreaSqm, plotAreaKatha, far, maxMpaSqm, calculatedFar, isOverrideActive, occupancyCode, occupancyName, activeScheme, details.groundCoverageSqm, details.groundCoveragePct, details.totalFloors, details.carsRequired`.
- One Firestore Listen channel stays open. Its collection: UNKNOWN.
- A clone does not need to copy this logging. It is analytics on the site owner's side.

### 8.3 Reference case, confirmed live
Block-03, 5 katha, 25 ft road, A3 gives exactly the saved-page values: approved FAR 3.59, MGC 46.5–62.5%, 7 units (max 11), G+7, 6 cars, 2 bikes, 1 lift 4P/320 kg, peak demand 3. LIVE

### 8.4 Edge cases, observed live (Block-03, A3 unless noted)

| Input change | Approved FAR | Other outputs | Note |
|---|---|---|---|
| 2 katha, 25 ft | 3.39 | MGC 52.5/70%, 5 units (max 5), G+5, 1 lift | No amalgamation bonus below 3 katha |
| 10 katha | 3.89 | MGC 45/60%, 16 units (max 22), G+8, 12 cars | +0.50 tier |
| 21 katha | 4.10 | no min MGC, max 45%, 32 units (max 47), 2 lifts | Community built space "REQUIRED (residential FAR exceeds 3,000 sqm, Rule 57(f)(1))" |
| 5 katha, 12 ft road | 2.20 | pFAR 2.00, G+4, 0 cars, no lift row | No "too narrow" error for A3 |
| 5 katha, 40 ft road | 4.10 | pFAR 4.01, bonus +0.40 | "Max FAR 4.10 applied directly (Max−Base ≤ 0.10)" |
| TOD 250 m | 4.10 | bonus +1.20 | ≤300 m tier, capped at max |
| TOD 650 m | 4.09 | bonus +0.70 | 500–800 m tier |
| TOD 900 m | 3.59 | bonus +0.20 | Beyond 800 m, no TOD bonus |
| Occupancy G1 factory | 3.54 | pFAR only, no units shown | "Non-residential occupancy (G1): DAP FAR Incentives … do not apply" |
| Plot 0 | 3.39 shown | "No FAR data — enter plot size and road width." | Quirk: old FAR values stay on screen |
| Block-01 reserved | 0.00 | "Reserved / Non-Buildable area (btype: N) … strictly prohibited" | Quirk: incentive total still shows +0.20 |

The lift rule matches the bundle in every case: 1 lift from 6 storeys, 2 above 10 storeys.
