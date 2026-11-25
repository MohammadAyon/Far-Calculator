// Building layout & constraint engine: fills the permitted FAR area with dwelling floors,
// units and circulation. Locked fields are kept; unlocked ones adjust to reach 100% FAR.
//
// FAR accounting follows Bidhimala 2025 Rule 49: the ground-floor (parking) core, the
// mandatory fire-safe stair, side balconies up to 2.5% and road-side front balconies are
// excluded; typical-floor circulation counts.

export const FEET_PER_METER = 3.280839895;
const MIN_UNIT_SQFT = 300; // shortcut: planning floor for an auto-sized flat, not a gazette value

export type LayoutField =
  | "floors"
  | "unitsPerFloor"
  | "buildings"
  | "totalUnits"
  | "avgUnitSqft"
  | "circulationSqft"
  | "gfCirculationSqft"
  | "fireStairSqft";

export type LayoutInput = {
  farAreaSqft: number;
  plotAreaSqft: number;
  minMgcPercent: number | null;
  maxMgcPercent: number;
  unitsPerKatha: number;
  frontLengthFt?: number;
  roadWidthFt?: number;
  values: Partial<Record<LayoutField, number>>;
  locked: LayoutField[];
};

export type LayoutResult = Record<LayoutField, number> & {
  maxUnits: number;
  highestFloors: number | null;
  lowestFloors: number;
  baseCoreSqft: number;
  lobbyAllowanceSqft: number;
  plotWidthFt: number;
  plotDepthFt: number;
  frontSetbackM: number;
  sideSetbackM: number;
  rearSetbackM: number;
  envelopeSqft: number;
  maxPlateSqft: number;
  frontBalconySqft: number;
  sideBalconySqft: number;
  grossUnitSqft: number;
  plateSqft: number;
  farUsedSqft: number;
  utilization: number;
  issues: string[];
};

// Rule 41(3) Table 1: [max storeys incl. ground, side setback m, rear setback m].
const SETBACK_TIERS = [
  [7, 1.0, 1.25],
  [10, 1.25, 2.0],
  [15, 3.0, 3.0],
  [20, 3.25, 3.25],
  [30, 3.5, 3.5],
  [40, 4.5, 4.5],
  [Infinity, 5.0, 5.0],
] as const;

export function setbacksM(storeys: number) {
  const [, side, rear] = SETBACK_TIERS.find(([maxStoreys]) => storeys <= maxStoreys)!;
  return { side, rear };
}

/** Base core & lobby per building per floor by plot size (planning default, as farcalculator.com). */
export function baseCoreSqft(katha: number) {
  return katha <= 10 ? 218 : katha <= 20 ? 300 : katha <= 30 ? 435 : 570;
}

/** Extra lobby when a building has more units per floor (planning default). */
export function lobbyAllowanceSqft(unitsPerFloorPerBuilding: number) {
  const u = Math.ceil(unitsPerFloorPerBuilding);
  if (u <= 2) return 0;
  if (u <= 8) return Math.ceil((u - 2) / 2) * 40;
  return 120 + (u - 8) * 20;
}

export function solveLayout(input: LayoutInput): LayoutResult {
  const { farAreaSqft: far, plotAreaSqft: plot, values: v } = input;
  const locked = new Set(input.locked);
  const lock = (f: LayoutField) => locked.has(f) && Number.isFinite(v[f]) && (v[f] as number) >= 0;
  const katha = plot / 720;
  // DAP 3.6.4.1(ঘ): up to 10% more A3 units than the density allows, with approval.
  const maxUnits = Math.max(1, Math.floor(katha * input.unitsPerKatha * 1.1 + 1e-9));
  const maxPlate = (plot * input.maxMgcPercent) / 100;
  const width = input.frontLengthFt || Math.sqrt(plot); // no frontage: square plot
  const depth = plot / width;
  const frontM = Math.max(4.5 - (input.roadWidthFt ?? 0) / FEET_PER_METER / 2, 1.5); // Rule 41(1)
  const minPlate = input.minMgcPercent ? (plot * input.minMgcPercent) / 100 : null;
  const highestFloors = minPlate ? Math.max(1, Math.floor(far / minPlate)) : null;
  const lowestFloors = Math.max(1, Math.ceil(far / maxPlate));

  const floorsList = lock("floors") ? [Math.max(1, Math.round(v.floors!))] : range(1, (highestFloors ?? lowestFloors) + 2);
  const buildings = lock("buildings") ? Math.max(1, Math.round(v.buildings!)) : 1;

  type Candidate = LayoutResult & { score: number[] };
  let best: Candidate | null = null;
  for (const floors of floorsList) {
    const upfList = lock("unitsPerFloor")
      ? [Math.max(1, Math.round(v.unitsPerFloor!))]
      : lock("totalUnits")
        ? [Math.max(1, Math.ceil(v.totalUnits! / floors))]
        : range(1, Math.max(1, Math.floor(maxUnits / floors)));
    for (const unitsPerFloor of upfList) {
      const totalUnits = lock("totalUnits") ? Math.max(1, Math.round(v.totalUnits!)) : floors * unitsPerFloor;
      const perBldgUnits = totalUnits / floors / buildings;
      const core = baseCoreSqft(katha);
      const lobby = lobbyAllowanceSqft(perBldgUnits);
      const circulation = lock("circulationSqft") ? v.circulationSqft! : core + lobby;
      const gfCirculation = lock("gfCirculationSqft") ? v.gfCirculationSqft! : circulation;
      const fireStair = lock("fireStairSqft") ? v.fireStairSqft! : 0;
      const circFar = floors * buildings * circulation; // Rule 49(গ): the ground-floor core is outside FAR
      const avgUnitSqft = lock("avgUnitSqft") ? v.avgUnitSqft! : (far - circFar) / totalUnits;
      const farUsed = totalUnits * avgUnitSqft + circFar;
      const plate = (totalUnits / floors) * avgUnitSqft + buildings * (circulation + fireStair);
      const { side: sideM, rear: rearM } = setbacksM(floors + 1);
      const envelope = Math.max(0, width - 2 * sideM * FEET_PER_METER) * Math.max(0, depth - (frontM + rearM) * FEET_PER_METER);
      const plateCap = Math.min(maxPlate, envelope);
      // Table 2 row 5: front balcony up to 30% of the road-side building width × 1 m deep.
      const front = input.frontLengthFt
        ? 0.3 * Math.max(0, input.frontLengthFt / buildings - 2 * sideM * FEET_PER_METER) * FEET_PER_METER
        : 0;
      const side = 0.025 * (perBldgUnits * avgUnitSqft + circulation + fireStair + front); // Rule 49(ণ)
      const issues: string[] = [];
      if (totalUnits > maxUnits) issues.push(`Total units ${totalUnits} exceed the density cap of ${maxUnits} (Appendix 3.6 + 10%).`);
      if (plate > plateCap + 0.5) {
        issues.push(`Floor plate ${Math.round(plate)} ft² exceeds the ${envelope < maxPlate ? "area inside the setbacks" : "maximum ground coverage"} of ${Math.round(plateCap)} ft².`);
      }
      if (farUsed > far * 1.0001) issues.push(`Locked values use ${Math.round((farUsed / far) * 100)}% of the permitted FAR area.`);
      if (avgUnitSqft < MIN_UNIT_SQFT) issues.push(`Average unit size ${Math.round(avgUnitSqft)} ft² is below ${MIN_UNIT_SQFT} ft².`);
      if (highestFloors !== null && (floors > highestFloors || floors < lowestFloors)) {
        issues.push(`G+${floors} is outside the ground-coverage range G+${lowestFloors} to G+${highestFloors}.`);
      }
      const utilization = farUsed / far;
      const candidate: Candidate = {
        floors, unitsPerFloor, buildings, totalUnits, avgUnitSqft,
        circulationSqft: circulation, gfCirculationSqft: gfCirculation, fireStairSqft: fireStair,
        maxUnits, highestFloors, lowestFloors, baseCoreSqft: core, lobbyAllowanceSqft: lobby,
        plotWidthFt: width, plotDepthFt: depth, frontSetbackM: frontM, sideSetbackM: sideM, rearSetbackM: rearM,
        envelopeSqft: envelope, maxPlateSqft: plateCap,
        frontBalconySqft: front, sideBalconySqft: side,
        grossUnitSqft: avgUnitSqft + (front + side + circulation) / perBldgUnits,
        plateSqft: plate, farUsedSqft: farUsed, utilization, issues,
        // fewest problems, then closest to 100% FAR, then more floors, then more units
        score: [-issues.length, -Math.abs(1 - utilization), floors, totalUnits],
      };
      if (!best || better(candidate.score, best.score)) best = candidate;
    }
  }
  const { score, ...result } = best!;
  void score;
  return result;
}

function better(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] > b[i];
  return false;
}

function range(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}
