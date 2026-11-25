import { describe, expect, it } from "vitest";
import { mrtLine6Stations, nearestMrtStation } from "./mrt";

describe("nearestMrtStation", () => {
  it("finds the station under the pin", () => {
    const motijheel = mrtLine6Stations.find((s) => s.name === "Motijheel")!;
    expect(nearestMrtStation(motijheel.lat, motijheel.lng)).toMatchObject({ station: motijheel, meters: 0 });
  });

  it("measures distance in metres", () => {
    // Dhaka University to Bangladesh Secretariat is roughly 1.1 km.
    const du = mrtLine6Stations.find((s) => s.name === "Dhaka University")!;
    const { meters } = nearestMrtStation(du.lat + 0.0045, du.lng);
    expect(meters).toBeGreaterThan(400);
    expect(meters).toBeLessThan(600);
  });
});
