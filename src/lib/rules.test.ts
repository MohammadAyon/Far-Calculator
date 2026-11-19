import bundled from "../../public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json";
import { describe, expect, it } from "vitest";
import {
  CalculationError,
  calculateFar,
  calculationInputSchema,
  ruleDatasetSchema,
} from "./rules";

const dataset = ruleDatasetSchema.parse(bundled);

function input(overrides: Record<string, unknown> = {}) {
  return calculationInputSchema.parse({
    blockId: "Block-03",
    plotArea: 2000,
    plotAreaUnit: "sqft",
    existingRoadWidthFt: 20,
    proposedRoadWidthFt: null,
    roadWideningNotPossible: false,
    surrenderedArea: 0,
    surrenderedAreaUnit: "sqft",
    occupancyMode: "single",
    occupancyShares: [{ code: "A1", sharePercent: 100 }],
    zoneOverride: null,
    incentiveIds: [],
    manualFarEnabled: false,
    manualFar: null,
    designValues: {},
    lockedInputs: [],
    ...overrides,
  });
}

describe("calculateFar", () => {
  it("calculates a plain case from the bundled ruleset", () => {
    const result = calculateFar(dataset, input());
    expect(result.baseFar).toBe(2.5);
    expect(result.appliedFar).toBe(2.5);
  });

  it("interpolates road FAR between bundled road-width steps", () => {
    const result = calculateFar(
      dataset,
      input({
        existingRoadWidthFt: 10,
        roadWideningNotPossible: true,
      }),
    );
    expect(result.existingRoadFar).toBeCloseTo(1.625);
  });

  it("includes road widening and surrendered land in the result", () => {
    const result = calculateFar(
      dataset,
      input({
        plotArea: 10_000,
        existingRoadWidthFt: 10,
        proposedRoadWidthFt: 20,
        surrenderedArea: 500,
      }),
    );
    expect(result.surrenderedAreaSqft).toBe(500);
    expect(result.netPlotAreaSqft).toBe(9500);
    expect(result.proposedRoadFar).toBe(2.5);
    expect(result.roadFar).toBeCloseTo(2.0625);
    expect(result.floorAreaSqft).toBeGreaterThan(result.netPlotAreaSqft);
  });

  it("returns a clear error for a missing incentive input", () => {
    expect(() =>
      calculateFar(
        dataset,
        input({
          plotArea: 10_000,
          incentiveIds: ["public-open-space"],
        }),
      ),
    ).toThrow("Enter a value for Public open space.");
  });

  it("rejects a report formula that divides by zero", () => {
    const datasetWithInvalidFormula = {
      ...dataset,
      reportFields: [
        ...dataset.reportFields,
        {
          id: "divide-by-zero",
          label: "Divide by zero",
          section: "far" as const,
          precision: 2,
          formula: {
            type: "operation" as const,
            operator: "divide" as const,
            operands: [
              { type: "constant" as const, value: 1 },
              { type: "constant" as const, value: 0 },
            ],
          },
        },
      ],
    };
    expect(() => calculateFar(datasetWithInvalidFormula, input())).toThrow(
      CalculationError,
    );
  });

  it("rejects report formulas nested beyond the maximum depth", () => {
    let formula: unknown = { type: "constant", value: 1 };
    for (let depth = 0; depth < 10; depth += 1) {
      formula = { type: "operation", operator: "add", operands: [formula] };
    }
    const candidate = {
      ...bundled,
      reportFields: [
        {
          id: "too-deep",
          label: "Too deep",
          section: "far",
          formula,
        },
      ],
    };
    expect(ruleDatasetSchema.safeParse(candidate).success).toBe(false);
  });
});
