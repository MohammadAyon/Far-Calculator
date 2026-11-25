import { describe, expect, it } from "vitest";
import { lobbyAllowanceSqft, solveLayout, type LayoutInput } from "./layout";

// 5 katha in Block-03, FAR 3.59 → 12,924 sft, Table 3 coverage 46.5–62.5%.
const base: LayoutInput = {
  farAreaSqft: 12_924,
  plotAreaSqft: 3_600,
  minMgcPercent: 46.5,
  maxMgcPercent: 62.5,
  unitsPerKatha: 2,
  values: {},
  locked: [],
};

describe("solveLayout", () => {
  it("fills 100% FAR with the highest floors the coverage range allows", () => {
    const r = solveLayout(base);
    expect(r).toMatchObject({ highestFloors: 7, lowestFloors: 6, floors: 7, unitsPerFloor: 1, totalUnits: 7, maxUnits: 11, circulationSqft: 218 });
    // Rule 49(গ): the ground-floor core is not FAR area, so all 12,924 sft go to 7 floors of unit + core.
    expect(r.avgUnitSqft).toBeCloseTo((12_924 - 7 * 218) / 7, 1);
    expect(r.utilization).toBeCloseTo(1, 6);
    expect(r.issues).toEqual([]);
  });

  it("keeps a locked unit size and reports how much FAR it uses", () => {
    const r = solveLayout({ ...base, values: { avgUnitSqft: 1200 }, locked: ["avgUnitSqft"] });
    expect(r.avgUnitSqft).toBe(1200);
    expect(r.issues).toEqual([]);
    expect(r.utilization).toBeLessThan(1);
    expect(r.plateSqft).toBeLessThanOrEqual(3_600 * 0.625);
  });

  it("flags a locked unit count above the density cap", () => {
    const r = solveLayout({ ...base, values: { totalUnits: 15 }, locked: ["totalUnits"] });
    expect(r.totalUnits).toBe(15);
    expect(r.issues.some((issue) => issue.includes("density cap of 11"))).toBe(true);
  });

  it("adds side and front balconies outside FAR", () => {
    const r = solveLayout({ ...base, frontLengthFt: 60 });
    // G+7 = 8 storeys → 1.25 m side setbacks; 30% × (60 ft − 2 × 4.1 ft) × 1 m.
    expect(r.frontBalconySqft).toBeCloseTo(0.3 * (60 - 2 * 1.25 * 3.280839895) * 3.280839895, 1);
    expect(r.sideBalconySqft).toBeCloseTo(0.025 * (r.avgUnitSqft + 218 + r.frontBalconySqft), 1);
    expect(r.utilization).toBeCloseTo(1, 6);
  });

  it("grows the lobby with more units per floor", () => {
    expect([2, 3, 4, 5, 8, 9].map(lobbyAllowanceSqft)).toEqual([0, 40, 40, 80, 120, 140]);
  });
});
