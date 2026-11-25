import type { CalculationResult, TraceStep } from "@/lib/rules";

// Shared by the customer calculator and the architect workspace, so both explain results the same way.

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

const unitLabel: Record<string, string> = { sqft: "sq ft", sqm: "sq m" };

function traceValue(step: TraceStep) {
  if (typeof step.value === "string") return step.value;
  const unit = step.unit ? unitLabel[step.unit] ?? step.unit : "";
  const digits = unit === "sq ft" || unit === "sq m" ? 0 : 2;
  return `${formatNumber(step.value, digits)}${unit ? ` ${unit}` : ""}`;
}

export function FarBreakdown({ result }: { result: CalculationResult }) {
  const bonuses = [...result.automaticBonuses, ...result.selectedBonuses];
  return (
    <table className="far-breakdown">
      <caption className="visually-hidden">FAR calculation breakdown</caption>
      <tbody>
        <tr><th scope="row">Area FAR <small>set by the DAP for this block</small></th><td>{formatNumber(result.areaFar)}</td></tr>
        <tr><th scope="row">Road FAR <small>set by the width of the road</small></th><td>{formatNumber(result.roadFar)}</td></tr>
        <tr><th scope="row">Base FAR <small>what every plot here gets</small></th><td>{formatNumber(result.baseFar)}</td></tr>
        {bonuses.map((bonus) => (
          <tr key={bonus.label}><th scope="row">Incentive <small>{bonus.label}</small></th><td>+{formatNumber(bonus.farBonus)}</td></tr>
        ))}
        <tr>
          <th scope="row">Maximum FAR <small>incentives cannot go above this</small></th>
          <td>{result.maxFarCap === null ? (result.uncappedFarEligible ? "No cap" : "Not defined") : formatNumber(result.maxFarCap)}</td>
        </tr>
        <tr className="far-breakdown-total">
          <th scope="row">{result.manualFar === null ? "Final FAR" : "Final FAR (manual override)"}</th>
          <td>{formatNumber(result.appliedFar)}</td>
        </tr>
        {result.manualFar !== null && (
          <tr><th scope="row">Calculated by the rules</th><td>{formatNumber(result.calculatedFar)}</td></tr>
        )}
      </tbody>
    </table>
  );
}

const traceGroups: Array<{ kind: TraceStep["kind"]; title: string }> = [
  { kind: "input", title: "What was entered" },
  { kind: "regulatory", title: "From the regulations" },
  { kind: "derived", title: "Calculated" },
  { kind: "assumption", title: "Assumptions" },
];

export function CalculationTrace({ trace, order = "grouped" }: { trace: TraceStep[]; order?: "grouped" | "sequence" }) {
  if (order === "sequence") {
    return (
      <table className="trace-table">
        <thead><tr><th scope="col">Step</th><th scope="col">Value</th><th scope="col">Type</th><th scope="col">Reference</th></tr></thead>
        <tbody>
          {trace.map((step, index) => (
            <tr key={`${step.label}-${index}`}>
              <th scope="row">{step.label}</th>
              <td>{traceValue(step)}</td>
              <td><span className={`trace-kind trace-${step.kind}`}>{step.kind}</span></td>
              <td>{step.ref ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div className="trace-groups">
      {traceGroups.map(({ kind, title }) => {
        const steps = trace.filter((step) => step.kind === kind);
        if (!steps.length) return null;
        return (
          <section key={kind}>
            <h4>{title}</h4>
            <dl>
              {steps.map((step, index) => (
                <div key={`${step.label}-${index}`}>
                  <dt>{step.label}{step.ref && <small>{step.ref}</small>}</dt>
                  <dd>{traceValue(step)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
