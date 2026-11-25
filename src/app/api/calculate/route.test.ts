import bundled from "../../../../public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveCustomerAssessment } from "@/lib/assessments";
import { ruleDatasetSchema } from "@/lib/rules";
import { POST } from "./route";

vi.mock("@/lib/database", () => ({
  getActiveRuleset: vi.fn(async () => ({ dataset: ruleDatasetSchema.parse(bundled), json: "{}", sha256: "test-sha" })),
  getDatabase: vi.fn(),
}));
vi.mock("@/lib/assessments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assessments")>()),
  saveCustomerAssessment: vi.fn(),
}));

const body = {
  blockId: "Block-03",
  plotArea: 5,
  plotAreaUnit: "katha",
  existingRoadWidthFt: 25,
  proposedRoadWidthFt: null,
  surrenderedArea: 0,
  surrenderedAreaUnit: "sqft",
  occupancyCode: "A3",
};
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/calculate", { method: "POST", body: JSON.stringify(payload) }));

beforeEach(() => vi.clearAllMocks());

describe("POST /api/calculate (customer)", () => {
  it("returns the result with a reference and the ruleset and engine versions", async () => {
    vi.mocked(saveCustomerAssessment).mockResolvedValue("FAR-ABCDEFGH");
    const response = await post(body);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ reference: "FAR-ABCDEFGH", rulesetSha: "test-sha" });
    expect(json.engineVersion).toBeTruthy();
    expect(json.result.floorAreaSqft).toBeGreaterThan(0);
  });

  it("rejects architect-only overrides", async () => {
    const response = await post({ ...body, manualFarEnabled: true, manualFar: 9 });
    expect(response.status).toBe(400);
    expect(saveCustomerAssessment).not.toHaveBeenCalled();
  });

  it("still returns the result when saving the assessment fails", async () => {
    vi.mocked(saveCustomerAssessment).mockRejectedValue(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await post(body);
    expect(response.status).toBe(200);
    expect((await response.json()).reference).toBeNull();
  });

  it("explains rule failures with a 422", async () => {
    const response = await post({ ...body, existingRoadWidthFt: 12 });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("widened");
  });
});
