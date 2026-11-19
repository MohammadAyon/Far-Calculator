import { timingSafeEqual } from "node:crypto";
import { activateRuleDataset } from "@/lib/database";
import { ruleDatasetSchema } from "@/lib/rules";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

function authorized(request: Request): boolean {
  const configuredToken = process.env.DATA_IMPORT_TOKEN;
  if (!configuredToken) {
    return process.env.NODE_ENV !== "production";
  }

  const suppliedToken = request.headers.get("x-data-import-token");
  if (!suppliedToken) return false;
  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && !process.env.DATA_IMPORT_TOKEN) {
    return Response.json(
      { error: "Data import is disabled until DATA_IMPORT_TOKEN is configured." },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return Response.json(
      { error: "A valid data import token is required." },
      { status: 401 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMPORT_BYTES) {
    return Response.json({ error: "The import file exceeds 8 MB." }, { status: 413 });
  }

  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
      return Response.json({ error: "The import file exceeds 8 MB." }, { status: 413 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return Response.json({ error: "The import file is not valid JSON." }, { status: 400 });
    }

    const parsed = ruleDatasetSchema.safeParse(payload);
    if (!parsed.success) {
      return Response.json(
        {
          error: "The file does not match the FAR dataset format.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    await activateRuleDataset(parsed.data);
    return Response.json({ dataset: parsed.data });
  } catch (error) {
    console.error("Unable to import the rule dataset.", error);
    return Response.json(
      { error: "The rule dataset could not be saved to the database." },
      { status: 503 },
    );
  }
}
