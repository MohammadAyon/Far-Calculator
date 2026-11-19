import { createHash, timingSafeEqual } from "node:crypto";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const failedAttempts = new Map<string, { count: number; expiresAt: number }>();

export function authorizeDataImport(request: Request): Response | null {
  const expectedToken = process.env.DATA_IMPORT_TOKEN;
  if (!expectedToken) {
    return Response.json(
      { error: "Data import is disabled until DATA_IMPORT_TOKEN is configured." },
      { status: 503 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  for (const [key, attempts] of failedAttempts) {
    if (attempts.expiresAt <= now) failedAttempts.delete(key);
  }
  const attempts = failedAttempts.get(ip);
  if (attempts && attempts.count >= MAX_FAILED_ATTEMPTS) {
    return Response.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429 },
    );
  }

  const suppliedToken = request.headers.get("x-data-import-token") ?? "";
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  const suppliedHash = createHash("sha256").update(suppliedToken).digest();
  if (timingSafeEqual(expectedHash, suppliedHash)) {
    failedAttempts.delete(ip);
    return null;
  }

  failedAttempts.set(ip, {
    count: (attempts?.count ?? 0) + 1,
    expiresAt: attempts?.expiresAt ?? now + RATE_LIMIT_WINDOW_MS,
  });
  return Response.json(
    { error: "A valid data import token is required." },
    { status: 401 },
  );
}
