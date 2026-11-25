"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { solveLayout, type LayoutField } from "@/lib/layout";
import { feetPerMeter as FEET_PER_METER, sqftPerSqm as SQFT_PER_SQM } from "@/lib/rules";

type Props = {
  farAreaSqft: number;
  plotAreaSqft: number;
  minMgcPercent: number | null;
  maxMgcPercent: number;
  unitsPerKatha: number;
  roadWidthFt: number;
  targetUnitSqft?: number;
  referenceUnitSqft?: number;
  initialFrontLengthFt?: number;
};

export default function LayoutEngine(props: Props) {
  const { farAreaSqft, plotAreaSqft, minMgcPercent, maxMgcPercent, unitsPerKatha, roadWidthFt, targetUnitSqft, referenceUnitSqft, initialFrontLengthFt } = props;
  const initialValues: Partial<Record<LayoutField, number>> = targetUnitSqft ? { avgUnitSqft: targetUnitSqft } : {};
  const initialLocks: LayoutField[] = targetUnitSqft ? ["avgUnitSqft"] : [];
  const [metric, setMetric] = useState(false);
  const [values, setValues] = useState(initialValues);
  const [locked, setLocked] = useState(initialLocks);
  const [frontLengthFt, setFrontLengthFt] = useState(initialFrontLengthFt);

  const r = useMemo(
    () => solveLayout({ farAreaSqft, plotAreaSqft, minMgcPercent, maxMgcPercent, unitsPerKatha, roadWidthFt, frontLengthFt, values, locked }),
    [farAreaSqft, plotAreaSqft, minMgcPercent, maxMgcPercent, unitsPerKatha, roadWidthFt, frontLengthFt, values, locked],
  );

  const area = (sqft: number) => (metric ? sqft / SQFT_PER_SQM : sqft);
  const areaUnit = metric ? "m²" : "ft²";
  const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const fmtArea = (sqft: number) => `${fmt(area(sqft), metric ? 1 : 0)} ${areaUnit}`;

  function edit(field: LayoutField, raw: string, isArea: boolean) {
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n < 0) return;
    setValues((current) => ({ ...current, [field]: isArea && metric ? n * SQFT_PER_SQM : n }));
    setLocked((current) => (current.includes(field) ? current : [...current, field])); // typing a value locks it
  }
  function toggle(field: LayoutField) {
    if (!locked.includes(field)) setValues((current) => ({ ...current, [field]: r[field] }));
    setLocked((current) => (current.includes(field) ? current.filter((f) => f !== field) : [...current, field]));
  }
  function reset() {
    setValues(initialValues);
    setLocked(initialLocks);
    setFrontLengthFt(initialFrontLengthFt);
  }

  const field = (id: LayoutField, label: string, unit: string, hint?: string, isArea = false) => {
    const isLocked = locked.includes(id);
    const shown = isArea ? area(r[id]) : r[id];
    return (
      <div className={`design-input-card layout-field ${isLocked ? "is-locked" : ""}`}>
        <div className="layout-field-head">
          <input aria-label={`Lock ${label}`} checked={isLocked} onChange={() => toggle(id)} type="checkbox" />
          <label htmlFor={`layout-${id}`}>{label}</label>
        </div>
        {hint && <small className="design-hint">{hint}</small>}
        <div className="input-with-unit">
          <input
            id={`layout-${id}`}
            min={0}
            onChange={(event) => edit(id, event.target.value, isArea)}
            step={isArea ? "any" : 1}
            type="number"
            value={Number(shown.toFixed(isArea && metric ? 1 : 0))}
          />
          <span>{unit}</span>
        </div>
      </div>
    );
  };
  const readout = (label: string, value: string, hint: string, badge?: string) => (
    <div className="design-input-card layout-field layout-readout">
      <div className="layout-field-head">
        <span>{label}</span>
        {badge && <span className="layout-badge">{badge}</span>}
      </div>
      <small className="design-hint">{hint}</small>
      <strong>{value}</strong>
    </div>
  );

  const perBldgUnits = r.totalUnits / r.floors / r.buildings;
  const pct = Math.min(100, r.utilization * 100);

  return (
    <section className="layout-engine" aria-labelledby="layout-engine-title">
      <div className="layout-engine-head">
        <div className="layout-title">
          <h3 id="layout-engine-title">Building layout &amp; constraint engine</h3>
          <span className="layout-badge">Regular building</span>
        </div>
        <div className="layout-tools">
          <div className="layout-toggle" role="group" aria-label="Units">
            <button aria-pressed={!metric} onClick={() => setMetric(false)} type="button">ft² / ft</button>
            <button aria-pressed={metric} onClick={() => setMetric(true)} type="button">m² / m</button>
          </div>
          <button className="layout-reset" onClick={reset} type="button"><RotateCcw size={14} /> Reset</button>
        </div>
        <div className="layout-total">
          <span>Total FAR included area</span>
          <strong>{fmtArea(farAreaSqft)}</strong>
          <small>{metric ? `${fmt(farAreaSqft)} ft²` : `${fmt(farAreaSqft / SQFT_PER_SQM, 1)} m²`}</small>
        </div>
      </div>

      <div className="layout-summary">
        <div className="layout-summary-top">
          <div>
            <p className="layout-units"><b>{r.totalUnits}</b> units <span>(max {r.maxUnits} units)</span></p>
            <small>Average unit size: <b>{fmtArea(r.avgUnitSqft)}</b></small>
          </div>
          <div className="layout-floors">
            <b>G+{r.floors}</b>
            <small>
              {r.highestFloors !== null
                ? `Highest G+${r.highestFloors} at min MGC · lowest G+${r.lowestFloors} at max MGC`
                : `Lowest G+${r.lowestFloors} at max MGC`}
            </small>
          </div>
        </div>
        <div className="layout-util">
          <span>FAR utilisation: <b>{fmt(r.utilization * 100, 1)}%</b> ({fmt(area(r.farUsedSqft))} / {fmt(area(farAreaSqft))} {areaUnit})</span>
          <div className="utilization-bar" role="progressbar" aria-label="FAR utilisation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="layout-summary-foot">
          <span>Units/floor: {fmt(r.totalUnits / r.floors, 1)} (across {r.buildings} building{r.buildings > 1 ? "s" : ""})</span>
          <span>Circulation: {fmtArea(r.circulationSqft)} per floor per building</span>
        </div>
      </div>

      {r.issues.length > 0 && (
        <ul className="layout-issues" role="status">
          {r.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}

      <p className="design-hint">Tick a box to <b>hard-lock</b> a value. Unlocked fields adjust to use 100% of the FAR area.</p>

      <div className="design-input-grid layout-grid">
        {field("floors", "Dwelling floors", "flr", r.highestFloors !== null ? `Highest G+${r.highestFloors} (min MGC) · lowest G+${r.lowestFloors} (max MGC)` : undefined)}
        {field("unitsPerFloor", "Total units per floor", "units")}
        {field("buildings", "Building count", "bldg")}
        {field("totalUnits", `Total units (max ${r.maxUnits})`, "units", "Appendix 3.6 units per katha × katha + 10%, DAP 3.6.4.1(ঘ)")}
        {field("avgUnitSqft", "Average unit size", areaUnit, referenceUnitSqft ? `Appendix 3.6 block average ${fmtArea(referenceUnitSqft)} (reference)` : undefined, true)}
        {readout("Gross unit size", fmtArea(r.grossUnitSqft), "Unit + front + side balcony + core share", "Reference only")}
        {field("circulationSqft", "Circulation area / bldg", areaUnit, "Stair, lift & lobby per typical floor — counted in FAR", true)}
        {field("gfCirculationSqft", "GF circulation / bldg", areaUnit, "Ground-floor (parking) core — outside FAR, Rule 49(গ)", true)}
        <div className="design-input-card layout-field layout-readout">
          <div className="layout-field-head"><span>Circulation area / bldg (auto)</span></div>
          <dl className="layout-sll">
            <dt>Base core &amp; lobby</dt><dd>{fmtArea(r.baseCoreSqft)}</dd>
            <dt>Lobby allowance ({fmt(perBldgUnits, 1)} units/floor)</dt><dd>{fmtArea(r.lobbyAllowanceSqft)}</dd>
            <dt>Auto total</dt><dd>{fmtArea(r.baseCoreSqft + r.lobbyAllowanceSqft)}</dd>
          </dl>
          <small className="design-hint">Planning defaults, not gazette values. Lock the field to use your own.</small>
        </div>
        {field("fireStairSqft", "Fire stair / bldg", areaUnit, "Extra fire-safe stair per floor — outside FAR unless it is the only stair, Rule 49", true)}
        <div className="design-input-card layout-field">
          <div className="layout-field-head"><label htmlFor="layout-front">Front length (of the site)</label></div>
          <small className="design-hint">Road-side plot width, used for the front balcony</small>
          <div className="input-with-unit">
            <input
              id="layout-front"
              min={0}
              onChange={(event) => {
                const n = Number(event.target.value);
                setFrontLengthFt(event.target.value === "" || !Number.isFinite(n) ? undefined : metric ? n * FEET_PER_METER : n);
              }}
              placeholder="e.g. 50"
              step="any"
              type="number"
              value={frontLengthFt === undefined ? "" : Number((metric ? frontLengthFt / FEET_PER_METER : frontLengthFt).toFixed(1))}
            />
            <span>{metric ? "m" : "ft"}</span>
          </div>
        </div>
        {readout(
          "Front balcony / bldg",
          frontLengthFt ? fmtArea(r.frontBalconySqft) : "—",
          frontLengthFt ? "30% of road-side building width × 1 m (Table 2) — outside FAR and MGC" : "Enter the front length to calculate",
          "FAR excluded",
        )}
        {readout(
          "Side balcony / bldg",
          fmtArea(r.sideBalconySqft),
          `2.5% of units + circulation + fire stair + front balcony (${fmtArea(r.sideBalconySqft / perBldgUnits)} per unit), Rule 49(ণ)`,
          "FAR excluded",
        )}
      </div>
    </section>
  );
}
