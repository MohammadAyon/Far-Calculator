import bundled from "../../public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json";
import { describe, expect, it } from "vitest";
import {
  CalculationError,
  calculateFar,
  calculationInputSchema,
  ruleDatasetSchema,
  suggestFlatProgram,
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

describe("suggestFlatProgram", () => {
  const value = (rows: { id: string; value: number | null }[], id: string) =>
    rows.find((row) => row.id === id)?.value;

  // 5 katha square plot (60 × 60 ft), 20 ft road, FAR 3.45, MGC 62.5%.
  const fiveKatha = {
    floorAreaSqft: 12_420,
    netPlotAreaSqft: 3_600,
    mgcSqft: 2_250,
    frontageFt: null,
    roadWidthFt: 20,
    unitsPerKatha: 2,
    circulationPercent: 15,
  };

  it("gives storeys, apartments per floor and parking for a square plot", () => {
    const program = suggestFlatProgram(fiveKatha);
    expect(program.summary).toMatchObject({ storeys: 6, upperFloors: 5, unitsPerFloor: 2, totalUnits: 10, carsRequired: 3 });
    expect(program.summary.unitSizeSqft).toBeCloseTo(956.25);
    expect(value(program.setbacks, "sb-front-m")).toBe(1.5); // 4.5 − 3.05 < 1.5
    expect(value(program.setbacks, "sb-envelope")).toBeCloseTo(2724.2, 0);
    expect(value(program.setbacks, "sb-plate")).toBe(2_250); // MGC governs
  });

  it("uses the entered frontage and lets setbacks govern the plate", () => {
    const program = suggestFlatProgram({ ...fiveKatha, frontageFt: 40, mgcSqft: 10_000 });
    expect(value(program.setbacks, "sb-plot-depth")).toBe(90);
    expect(value(program.setbacks, "sb-plate")).toBeCloseTo(2707.7, 0);
  });

  it("applies the 4.5 m from road centre front setback on narrow roads", () => {
    const program = suggestFlatProgram({ ...fiveKatha, roadWidthFt: 6 });
    expect(value(program.setbacks, "sb-front-m")).toBeCloseTo(3.586, 3);
    expect(program.summary.carsRequired).toBe(0); // road under 6 m
  });

  it("moves to the Table 1 tier that matches the storey count", () => {
    const program = suggestFlatProgram({
      ...fiveKatha,
      floorAreaSqft: 60_000,
      netPlotAreaSqft: 10_000,
      mgcSqft: 5_500,
      roadWidthFt: 60,
    });
    expect(program.summary.storeys).toBe(11);
    expect(value(program.setbacks, "sb-side-m")).toBe(3);
    expect(value(program.setbacks, "sb-rear-m")).toBe(3);
  });

  it("fits apartments per floor from a desired flat size", () => {
    const auto = suggestFlatProgram({ ...fiveKatha, unitsPerKatha: 4 });
    expect(auto.summary.unitsPerFloor).toBe(4); // density cap 22 ÷ 5 floors
    const sized = suggestFlatProgram({ ...fiveKatha, unitsPerKatha: 4, targetUnitSqft: 600 });
    expect(sized.summary).toMatchObject({ unitsPerFloor: 3, carsRequired: 0, bikesRequired: 3 });
  });

  it("appears in the A3 result", () => {
    const result = calculateFar(
      dataset,
      input({ plotArea: 5, plotAreaUnit: "katha", occupancyShares: [{ code: "A3", sharePercent: 100 }] }),
    );
    expect(result.buildingSummary?.storeys).toBeGreaterThan(1);
    expect(result.reportFields.layout[0].id).toBe("auto-upper-floors");
    expect(result.reportFields.setbacks.some((row) => row.id === "sb-front-m")).toBe(true);
    expect(result.reportFields.parking.some((row) => row.id === "auto-cars-required")).toBe(true);
  });
});

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
