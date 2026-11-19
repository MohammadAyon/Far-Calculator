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

The bundled ruleset is [`public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json`](./public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json). It is loaded automatically when the database has no active ruleset. The **Rules & sources** panel also links to the two saved reference pages used for the transcription. You can import a replacement using [`public/templates/ruleset.template.json`](./public/templates/ruleset.template.json); valid imports are saved as versioned records and become active.

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

Report formulas use only `constant`, `input`, and arithmetic `operation` expressions (`add`, `subtract`, `multiply`, `divide`, `min`, `max`); they are evaluated without `eval`. Core input keys include `plotAreaSqft`, `netPlotAreaSqft`, `surrenderedAreaSqft`, `existingRoadWidthFt`, `existingRoadFar`, `areaFar`, `roadFar`, `baseFar`, `automaticBonusFar`, `selectedBonusFar`, `totalBonusFar`, `calculatedFar`, `appliedFar`, and `floorAreaSqft`. `proposedRoadWidthFt`, `proposedRoadFar`, and `farCap` are only available when supplied by the assessment. Occupancy shares are available as `occupancyShare:<code>`, and design inputs by their `id`; lock states are available as `hardLock:<id>`. A formula referring to missing data returns an explicit calculation error rather than a fabricated zero.

FAR, block Area FAR, Table 5 Road FAR, selected Table 3.28 incentives, and Rule 45 coverage/open-space values are bundled from the supplied reference pages. Detailed setbacks, parking, stairs, and lifts are not included in the calculation model. The 2025 reference has no numeric Table 5 rows for occupancy groups L and M; those uses are not offered for calculation.

Each block may include GeoJSON `Polygon` or `MultiPolygon` geometry using standard `[longitude, latitude]` coordinates. Boundary clicks select a block; map clicks also mark a coordinate. A coordinate alone does not determine zoning when no matching boundary is loaded. Area and road width units are convertible only when the app or dataset defines the conversion.

## Database and deployment

The app uses `@libsql/client`: local development falls back to a file-backed SQLite database, while hosted deployments can use a Turso/libSQL database. Copy `.env.example` to `.env.local` for local secrets, or configure the variables in your hosting provider:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `DATA_IMPORT_TOKEN`

When using hosted Turso, both database variables are required. Set `DATA_IMPORT_TOKEN` to a long random secret; the production import endpoint is disabled until it is configured. The browser asks for this token only when importing and sends it to the server as a request header. Never commit it or share it publicly.

The app can be deployed to a Next.js host such as Vercel and connected to a free-tier hosted libSQL-compatible database, subject to the provider's current quotas and terms. OSM tiles are used without a proprietary map API key; follow the OpenStreetMap tile usage policy for production traffic. Printing the assessment supports the browser's **Save as PDF** option.

## Important limitations

- The bundled ruleset is a transcription of the supplied reference tool, not an independent gazette audit. Confirm final values and eligibility with RAJUK.
- The Table 3.28 road-width incentive wording is ambiguous in the supplied reference and is a manual, user-confirmed input.
- DAP block rows have no parcel geometry; selecting a block is user input, not an automatic location determination. Mixed-use shares must match the Master Plan.
- The import and calculation APIs validate data and return explicit errors; they do not infer missing rules.
- The map is a visualization and user-assisted location picker, not an official parcel or zoning lookup.
- Generated reports are informational and do not constitute RAJUK approval or replace professional review.
- User accounts and cloud-saved project records are not included in this starter.
