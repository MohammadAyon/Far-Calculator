# FAR Calculator

A Bangladesh plot assessment app built with Next.js, TypeScript, Leaflet/OpenStreetMap, and a SQLite-compatible database. When no imported ruleset is active, it uses the bundled DAP 2022–2035 / Dhaka Metropolitan Building Construction Rules, 2025 transcription.

## Run locally

Requirements: Node.js 20.19+ and npm.

```powershell
npm install
npm run dev
```

Open http://localhost:3000. The local database is created at `data/far-calculator.db` on first use. Local data files and secrets are excluded from version control.

Run checks:

```powershell
npm run lint
npm run typecheck
npm run build
```

## Loading planning data

The bundled ruleset is [`public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json`](./public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json). It is loaded automatically when the database has no active ruleset. The **Rules & sources** panel also links to the two saved reference pages used for the transcription. You can import a replacement using [`public/templates/ruleset.template.json`](./public/templates/ruleset.template.json); valid imports are saved as versioned records and become active. A token-protected `POST /api/rules/revert` restores the previous imported ruleset.

The `dap-2025` calculation mode uses the selected Appendix 3.6 Area FAR and the Table 5 Road FAR for the occupancy and DAP zone. It interpolates between road-width steps, averages existing and proposed Road FAR when a widening proposal is entered, uses the lower index as the unconditional base, and limits eligible incentives to the higher index. It applies the Rule 47(12) 0.1 gap exception, the conditional 0.5 FAR exceptional allowance under Rule 47(3), Rule 47(7) road widening requirement and exception, and DAP Article 3.6.4.2 floor-area compensation. The older `min-area-road-plus-bonus-cap` mode remains supported for imported datasets.

### Dataset fields

- `schemaVersion`: must be `1`; `name`, `jurisdiction`: dataset identification.
- `calculationMode`: `null`, `min-area-road-plus-bonus-cap`, or `dap-2025`.
- `areaUnitSqft`: optional conversion factors for `katha`, `decimal`, `chatak`, `bigha`, `acre`, and `hectare`. Square meters use the standard unit conversion; no local land-unit value is assumed.
- `roadFarCombination`: `existing` (default), `proposed`, `minimum`, or `average`.
- `plotAreaBasis`: `gross` (default) or `net-after-surrender`.
- `mixedOccupancyCapMethod`: optional `minimum` or `weighted-average`. Mixed occupancy remains unavailable unless this is configured.
- `blocks`: `id`, `label`, `areaFar`; optional `zone`, `typeCode`, `buildable`, `areaFarByZone`, `densityPerAcre`, and GeoJSON `geometry`.
- `roadFar`: `minRoadWidthFt`, nullable `far`, and optional `occupancyCode`, `zone`, and `unrestrictedPlotAreaMinSqft`. Thresholds must be unique per occupancy and zone.
- `occupancies`: `code`, `label`; optional `group`, `farCap`, `maxGroundCoveragePercent`, and `farTreatment` (`area-road` or `road-only`).
- `incentives`: `id`, `label`; optional `group`, `automatic`, `minPlotAreaSqft`, `occupancyCodes`, `blockTypeCodes`, `exclusiveGroup`, and either fixed `farBonus` or a `calculation`:
  - `fixed`: one nonnegative `farBonus`.
  - `plot-area-tier`: `minPlotAreaSqft`, optional exclusive `maxPlotAreaSqft`, and bonus per tier.
  - `road-width`: threshold, FAR per foot above it, and maximum bonus.
  - `distance-tier`: design input ID and maximum-distance tiers.
  - `input`: design input ID and optional maximum bonus.
- `designInputs`: optional project fields with `id`, `label`, `section` (`incentives`, `layout`, or `parking`), unit/hint, default/min/max/step, and `hardLockable`. A locked input is passed to report formulas as `hardLock:<id>` (`1` or `0`); the calculator does not automatically optimize or alter that input.
- `reportFields`: optional displayed result fields with `id`, `label`, `section` (`far`, `groundCoverage`, `setbacks`, `layout`, `parking`, or `stairsElevator`), optional `unit` and `precision`, and a safe formula expression.
- `siteCoverage`: optional plot-size tiers and occupancy-specific ground-coverage overrides.
- `roadWidening`: optional required road width range and target width; proposed widening can require surrendered land.
- `surrenderedAreaCompensationFactor`: the additional land-area multiplier for surrendered land, converted to floor area using the applied FAR (for example, `3` means `surrendered area × 3 × applied FAR`).
- `sources`: source document names, gazette references, or relevant sections.
- `notes`: plain-language notes displayed with the active ruleset.

Report formulas use only `constant`, `input`, and arithmetic `operation` expressions (`add`, `subtract`, `multiply`, `divide`, `min`, `max`, `floor`, `ceil`); they are evaluated without `eval`. Core input keys include `plotAreaSqft`, `netPlotAreaSqft`, `surrenderedAreaSqft`, `existingRoadWidthFt`, `existingRoadFar`, `areaFar`, `roadFar`, `baseFar`, `automaticBonusFar`, `selectedBonusFar`, `totalBonusFar`, `calculatedFar`, `appliedFar`, and `floorAreaSqft`. `proposedRoadWidthFt`, `proposedRoadFar`, and `farCap` are only available when supplied by the assessment. Occupancy shares are available as `occupancyShare:<code>`, and design inputs by their `id`; lock states are available as `hardLock:<id>`. A formula referring to missing data returns an explicit calculation error rather than a fabricated zero.

FAR, block Area FAR, Table 5 Road FAR, selected Table 3.28 incentives, and Rule 45 coverage/open-space values are bundled from the supplied reference pages. Detailed setbacks, parking, stairs, and lifts are not included in the calculation model. The 2025 reference has no numeric Table 5 rows for occupancy groups L and M; those uses are not offered for calculation.

Each block may include GeoJSON `Polygon` or `MultiPolygon` geometry using standard `[longitude, latitude]` coordinates. Boundary clicks select a block; map clicks also mark a coordinate. A coordinate alone does not determine zoning when no matching boundary is loaded. Area and road width units are convertible only when the app or dataset defines the conversion.

## Database and deployment

The app uses `@libsql/client`: local development falls back to a file-backed SQLite database, while production requires a remote Turso/libSQL database. Copy `.env.example` to `.env.local` for local secrets, or configure the variables in your hosting provider:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `DATA_IMPORT_TOKEN`
- Optional: `RESEND_API_KEY`, `ENQUIRY_EMAIL_TO`, `ENQUIRY_EMAIL_FROM` to email Foundrio when a customer requests a review. Without them, requests are saved but not emailed.

Every customer calculation is saved as an assessment with a reference such as `FAR-7K2MQ9XD`, together with its inputs, result, engine version (`ENGINE_VERSION` in `src/lib/rules.ts`) and a hash-keyed snapshot of the ruleset it used, so it can be reproduced later. The public `/api/calculate` accepts only customer inputs; manual FAR, zone override and incentive inputs are rejected there.

For local development, set `DATA_IMPORT_TOKEN` before importing or reverting a ruleset. Generate it with `openssl rand -base64 48`. Production requires both Turso variables and the import token; the app never falls back to a local database in production. The browser asks for the import token only when importing and sends it to the server as a request header. Never commit it or share it publicly.

The map uses OpenStreetMap raster tiles with visible attribution. Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/), including its caching and attribution requirements; the public tile service is not an unlimited production CDN. Printing the assessment supports the browser's **Save as PDF** option.

## Deploy for free

Free-tier limits and terms change; check the providers' current pricing and usage policies before deploying.

### Turso database

1. Create a free account at [Turso](https://turso.tech/) and install the [Turso CLI](https://docs.turso.tech/cli/installation).
2. Create the database and retrieve its URL and token:

   ```sh
   turso db create far-calculator
   turso db show far-calculator --url
   turso db tokens create far-calculator
   ```

   Save the URL and token securely; do not commit them.

### Vercel Hobby app

1. Push the repository to GitHub and import it at [vercel.com](https://vercel.com/) using the **Hobby** plan and **Next.js** framework preset.
2. Add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and a generated `DATA_IMPORT_TOKEN` in Vercel's environment-variable settings for both **Production** and **Preview**. Generate the import token with `openssl rand -base64 48`.
3. Deploy the project.

### Verify the deployment

1. Open `/api/health`; it should return `{"status":"ok","database":"connected"}`.
2. Open the site and run a calculation.
3. Send `POST /api/rules/import` without `x-data-import-token`; it should return `401` or `503` if the token is not configured. Repeat with the valid token and a valid ruleset JSON body.
4. Add a Vercel Firewall rate-limit rule for `/api/rules/import`; optionally add one for `/api/calculate`. The app's in-memory import limit is best-effort only on serverless instances.

### Other hosting options

Netlify, Cloudflare (using OpenNext), and free Render/Koyeb web services are alternatives; free services may have cold starts. In every case the database must be Turso, not a local file. Check current provider pricing pages because free-tier quotas and terms can change.

## Important limitations

- The bundled ruleset is a transcription of the supplied reference tool, not an independent gazette audit. Confirm final values and eligibility with RAJUK.
- The Table 3.28 road-width incentive wording is ambiguous in the supplied reference and is a manual, user-confirmed input.
- DAP block rows have no parcel geometry; selecting a block is user input, not an automatic location determination. Mixed-use shares must match the Master Plan.
- The import and calculation APIs validate data and return explicit errors; they do not infer missing rules.
- The map is a visualization and user-assisted location picker, not an official parcel or zoning lookup.
- Results and generated reports are informational only; confirm them with RAJUK and do not treat them as approval or a substitute for professional review.
- User accounts and cloud-saved project records are not included in this starter.
