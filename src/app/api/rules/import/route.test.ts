import bundled from "../../../../../public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activateRuleDataset } from "@/lib/database";
import { POST } from "./route";

vi.mock("@/lib/database", () => ({
  activateRuleDataset: vi.fn(),
}));

const originalToken = process.env.DATA_IMPORT_TOKEN;

function request(ip: string, token?: string) {
  return new Request("http://localhost/api/rules/import", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      ...(token ? { "x-data-import-token": token } : {}),
    },
    body: JSON.stringify(bundled),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATA_IMPORT_TOKEN;
});

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.DATA_IMPORT_TOKEN;
  } else {
    process.env.DATA_IMPORT_TOKEN = originalToken;
  }
});

describe("POST /api/rules/import authorization", () => {
  it("returns 503 when DATA_IMPORT_TOKEN is unset", async () => {
    const response = await POST(request("198.51.100.21"));
    expect(response.status).toBe(503);
  });

  it("returns 401 for a wrong token", async () => {
    process.env.DATA_IMPORT_TOKEN = "test-import-token";
    const response = await POST(request("198.51.100.22", "wrong-token"));
    expect(response.status).toBe(401);
  });

  it("returns 200 for the correct token", async () => {
    process.env.DATA_IMPORT_TOKEN = "test-import-token";
    const response = await POST(
      request("198.51.100.23", "test-import-token"),
    );
    expect(response.status).toBe(200);
    expect(activateRuleDataset).toHaveBeenCalledOnce();
  });

  it("rate-limits repeated failed attempts per IP", async () => {
    process.env.DATA_IMPORT_TOKEN = "test-import-token";
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await POST(request("198.51.100.24", "wrong-token"));
    }
    expect(response?.status).toBe(429);
  });
});
