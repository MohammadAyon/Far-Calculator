import { createHash } from "node:crypto";
import { activateRuleDataset } from "@/lib/database";
import { authorizeDataImport } from "@/lib/data-import-auth";
import { ruleDatasetSchema } from "@/lib/rules";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  // Best-effort on serverless; the Vercel Firewall rate-limit rule is the real control.
  const denied = authorizeDataImport(request);
  if (denied) return denied;

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

    const sourceIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await activateRuleDataset(parsed.data, {
      sha256: createHash("sha256").update(text).digest("hex"),
      sourceIp,
    });
    return Response.json({ dataset: parsed.data });
  } catch (error) {
    console.error("Unable to import the rule dataset.", error);
    return Response.json(
      { error: "The rule dataset could not be saved to the database." },
      { status: 503 },
    );
  }
}
