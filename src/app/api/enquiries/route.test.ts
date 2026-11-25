import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnquiry, markEnquiryEmailed } from "@/lib/assessments";
import { POST } from "./route";

vi.mock("@/lib/assessments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assessments")>()),
  createEnquiry: vi.fn(),
  markEnquiryEmailed: vi.fn(async () => undefined),
}));

const valid = { assessmentId: "FAR-ABCDEFGH", name: "Rahim Uddin", phone: "01712 345678", email: "", message: "" };
const post = (payload: unknown) =>
  POST(new Request("http://localhost/api/enquiries", { method: "POST", body: JSON.stringify(payload) }));
const saved = {
  enquiryId: "enquiry-1",
  title: "Block-03 · A3 - Flat & apartment",
  result: { plotAreaSqft: 3600, netPlotAreaSqft: 3600, existingRoadWidthFt: 25, proposedRoadWidthFt: null, appliedFar: 3, floorAreaSqft: 10800 },
} as unknown as Awaited<ReturnType<typeof createEnquiry>>;
const emailEnv = ["RESEND_API_KEY", "ENQUIRY_EMAIL_TO", "ENQUIRY_EMAIL_FROM"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of emailEnv) delete process.env[key];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/enquiries", () => {
  it("quietly drops bot submissions that fill the honeypot", async () => {
    const response = await post({ ...valid, website: "http://spam.example" });
    expect(response.status).toBe(200);
    expect(createEnquiry).not.toHaveBeenCalled();
  });

  it("validates the phone number and reference", async () => {
    expect((await post({ ...valid, phone: "abc" })).status).toBe(400);
    expect((await post({ ...valid, assessmentId: "FAR-123" })).status).toBe(400);
    expect(createEnquiry).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown calculation reference", async () => {
    vi.mocked(createEnquiry).mockResolvedValue(null);
    expect((await post(valid)).status).toBe(404);
  });

  it("saves the enquiry and skips email when no email provider is configured", async () => {
    vi.mocked(createEnquiry).mockResolvedValue(saved);
    const response = await post(valid);
    expect(response.status).toBe(200);
    expect(createEnquiry).toHaveBeenCalledWith(expect.objectContaining({ name: "Rahim Uddin", email: null }));
    expect(markEnquiryEmailed).not.toHaveBeenCalled();
  });

  it("emails Foundrio and records it when the provider accepts the message", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.ENQUIRY_EMAIL_TO = "team@example.com";
    process.env.ENQUIRY_EMAIL_FROM = "FAR <far@example.com>";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(createEnquiry).mockResolvedValue(saved);
    expect((await post(valid)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    expect(markEnquiryEmailed).toHaveBeenCalledWith("enquiry-1");
  });
});
