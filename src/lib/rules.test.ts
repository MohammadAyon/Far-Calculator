import bundled from "../../public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json";
import { describe, expect, it } from "vitest";
import {
  CalculationError,
  calculateFar,
  calculationInputSchema,
  customerCalculationInputSchema,
  customerToEngineInput,
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

describe("A3 building layout (layout engine)", () => {
  const a3 = (overrides: Record<string, unknown>) =>
    calculateFar(dataset, input({ plotAreaUnit: "katha", occupancyShares: [{ code: "A3", sharePercent: 100 }], ...overrides }));
  const row = (rows: { id: string; value: number | null; label: string }[], id: string) => rows.find((item) => item.id === id);

  it("summarises the engine layout and uses all the FAR area", () => {
    const result = a3({ plotArea: 5, existingRoadWidthFt: 25 });
    expect(result.buildingSummary).toMatchObject({ storeys: 8, upperFloors: 7, unitsPerFloor: 1, totalUnits: 7 });
    expect(result.reportFields.layout[0].id).toBe("auto-upper-floors");
    expect(row(result.reportFields.layout, "auto-unused-floor-area")?.value).toBeCloseTo(0, 3);
  });

  it("applies the 4.5 m from road centre front setback on narrow roads", () => {
    const result = a3({ plotArea: 5, existingRoadWidthFt: 12, roadWideningNotPossible: true });
    expect(row(result.reportFields.setbacks, "sb-front-m")?.value).toBeCloseTo(4.5 - (12 * 0.3048) / 2, 3);
  });

  it("lets the setbacks govern the floor plate on a narrow plot", () => {
    const plate = row(a3({ plotArea: 5, existingRoadWidthFt: 25, plotFrontageFt: 15 }).reportFields.setbacks, "sb-plate");
    expect(plate?.value).toBeLessThan(3_600 * 0.625);
    expect(plate?.label).toContain("setbacks govern");
  });

  it("fits a desired flat size", () => {
    const result = a3({ plotArea: 5, existingRoadWidthFt: 25, designValues: { targetUnitSizeSqft: 1200 } });
    expect(result.buildingSummary?.unitSizeSqft).toBe(1200);
  });
});

describe("calculateFar", () => {
  it("calculates a plain case from the bundled ruleset", () => {
    // 20 ft is just over the 6 m band (19.685 ft), so Rule 47(6) lifts FAR slightly above 2.5.
    const result = calculateFar(dataset, input());
    expect(result.baseFar).toBeCloseTo(2.516, 3);
    expect(result.appliedFar).toBeCloseTo(2.516, 3);
  });

  it("uses Table 5 values exactly at metre band edges", () => {
    // Block-03 (Z1), A1, road exactly 6 m → Table 5 gives 2.5.
    const result = calculateFar(dataset, input({ existingRoadWidthFt: 6 / 0.3048 }));
    expect(result.existingRoadFar).toBeCloseTo(2.5, 4);
  });

  it("interpolates road FAR between bundled road-width steps", () => {
    const result = calculateFar(
      dataset,
      input({
        existingRoadWidthFt: 10,
        roadWideningNotPossible: true,
      }),
    );
    expect(result.existingRoadFar).toBeCloseTo(1.618, 3); // between 2.5 m (1.5) and 3.66 m (1.75)
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
    expect(result.proposedRoadFar).toBeCloseTo(2.516, 3);
    expect(result.roadFar).toBeCloseTo(2.067, 3); // Rule 47(8): average of existing and proposed
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

describe("stairs and lifts", () => {
  const rows = (plotArea: number, existingRoadWidthFt: number) =>
    Object.fromEntries(
      calculateFar(dataset, input({ plotArea, plotAreaUnit: "katha", existingRoadWidthFt, occupancyShares: [{ code: "A3", sharePercent: 100 }] }))
        .reportFields.stairsElevator.map((row) => [row.id, row.value]),
    );

  it("requires one lift above 18 m (Rule 59(1))", () => {
    // 5 katha → G+7: 3.6 m + 7 × 3.0 m = 24.6 m.
    expect(rows(5, 25)).toMatchObject({ "stair-count": 1, "stair-main-width": 1.15, "lift-height": 24.6, "lift-count": 1 });
  });

  it("requires two lifts above 10 storeys (Rule 59(2))", () => {
    expect(rows(21, 60)["lift-count"]).toBe(2);
  });
});

describe("gazette rules (Bidhimala 2025 + DAP amendment)", () => {
  const a3 = (overrides: Record<string, unknown>) =>
    calculateFar(dataset, input({ plotAreaUnit: "katha", occupancyShares: [{ code: "A3", sharePercent: 100 }], ...overrides }));
  const value = (rows: { id: string; value: number | null }[], id: string) => rows.find((row) => row.id === id)?.value;

  it("uses Table 3 ground coverage for a 4–6 katha plot", () => {
    expect(a3({ plotArea: 5, existingRoadWidthFt: 25 }).siteCoverage).toMatchObject({
      minGroundCoveragePercent: 46.5,
      maxGroundCoveragePercent: 62.5,
      mandatoryOpenSpacePercent: 37.5,
    });
  });

  it("requires car parking on a 12 ft road (Table 8 row 1 only waives 1.8–2.5 m roads)", () => {
    // 1,200 sft flats (~111 sqm) fall in the 1 car per 2 units tier.
    const result = a3({ plotArea: 5, existingRoadWidthFt: 12, roadWideningNotPossible: true, designValues: { targetUnitSizeSqft: 1200 } });
    expect(value(result.reportFields.parking, "auto-cars-required")).toBeGreaterThan(0);
  });

  it("takes units per katha from the block (Appendix 3.6)", () => {
    // Block-31 lists 1.3 units per katha: 10 katha × 1.3 × 1.1 = 14.3 → 14 units.
    const result = a3({ blockId: "Block-31", plotArea: 10, existingRoadWidthFt: 30 });
    expect(value(result.reportFields.layout, "auto-density-cap")).toBe(14);
  });

  it("asks for community space above 3,000 sqm of residential FAR area (Rule 57(চ)(1))", () => {
    const result = a3({ plotArea: 40, existingRoadWidthFt: 60 });
    expect(result.floorAreaSqft).toBeGreaterThan(3000 * 10.7639);
    expect(value(result.reportFields.layout, "auto-community-space")).toBeCloseTo(result.floorAreaSqft * 0.05);
  });
});

describe("customer input and calculation trace", () => {
  const customer = {
    blockId: "Block-03",
    plotArea: 5,
    plotAreaUnit: "katha",
    existingRoadWidthFt: 25,
    proposedRoadWidthFt: null,
    surrenderedArea: 0,
    surrenderedAreaUnit: "sqft",
    occupancyCode: "A3",
  };

  it("rejects architect-only parameters from the public calculator", () => {
    for (const extra of [{ manualFar: 9 }, { manualFarEnabled: true }, { zoneOverride: "Z3" }, { incentiveIds: ["green-building"] }, { designValues: { unitsPerKatha: 9 } }]) {
      expect(customerCalculationInputSchema.safeParse({ ...customer, ...extra }).success).toBe(false);
    }
  });

  it("gives the same result as the full engine input for an equivalent assessment", () => {
    const viaCustomer = calculateFar(dataset, customerToEngineInput(customerCalculationInputSchema.parse(customer)));
    const viaArchitect = calculateFar(dataset, input({ plotArea: 5, plotAreaUnit: "katha", existingRoadWidthFt: 25, occupancyShares: [{ code: "A3", sharePercent: 100 }] }));
    expect(viaCustomer).toEqual(viaArchitect);
  });

  it("traces the values the result reports", () => {
    const result = calculateFar(dataset, input({ plotArea: 10_000, existingRoadWidthFt: 10, proposedRoadWidthFt: 20, surrenderedArea: 500 }));
    const step = (label: string) => result.trace.find((item) => item.label.startsWith(label))?.value;
    expect(step("Area FAR for the block")).toBe(result.areaFar);
    expect(step("Base FAR")).toBe(result.baseFar);
    expect(step("Calculated FAR")).toBe(result.calculatedFar);
    expect(step("Total buildable floor area")).toBe(result.floorAreaSqft);
    expect(step("Net plot area")).toBe(result.netPlotAreaSqft);
    expect(result.trace.some((item) => item.ref === "DAP Article 3.6.4.2")).toBe(true);
  });

  it("lists the layout assumptions only when a building estimate is made", () => {
    const flats = calculateFar(dataset, input({ plotArea: 5, plotAreaUnit: "katha", existingRoadWidthFt: 25, occupancyShares: [{ code: "A3", sharePercent: 100 }] }));
    expect(flats.trace.filter((item) => item.kind === "assumption").map((item) => item.label)).toContain("Square plot assumed for setbacks (no frontage entered)");
    expect(calculateFar(dataset, input()).trace.some((item) => item.kind === "assumption")).toBe(false);
  });
});
