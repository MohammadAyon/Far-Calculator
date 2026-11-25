import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import bundled from "../../public/rulesets/dhaka-metropolitan-building-construction-rules-2025.json";
import { ruleDatasetSchema, type RuleDataset } from "@/lib/rules";

type DatabaseGlobal = typeof globalThis & {
  farCalculatorDb?: Client;
  farCalculatorDbReady?: Promise<void>;
};

const globalDatabase = globalThis as DatabaseGlobal;
const parsedBundledRuleDataset = ruleDatasetSchema.safeParse(bundled);
if (!parsedBundledRuleDataset.success) {
  throw new Error("The bundled DAP 2025 ruleset is invalid.");
}
const bundledRuleDataset = parsedBundledRuleDataset.data;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const bundledRuleset = (() => {
  const json = JSON.stringify(bundledRuleDataset);
  return { dataset: bundledRuleDataset, json, sha256: sha256(json) };
})();

function databaseConfig(): {
  url: string;
  authToken?: string;
  isLocal: boolean;
} {
  const url = process.env.TURSO_DATABASE_URL || undefined;
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

  if (isProduction && (!url || url.startsWith("file:"))) {
    throw new Error(
      "TURSO_DATABASE_URL must be configured with a remote Turso database in production.",
    );
  }
  if (url && !url.startsWith("file:") && !authToken) {
    throw new Error("TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL.");
  }
  if (isProduction && !authToken) {
    throw new Error("TURSO_AUTH_TOKEN is required in production.");
  }

  return {
    url: url ?? "file:./data/far-calculator.db",
    authToken,
    isLocal: !url || url.startsWith("file:"),
  };
}

function getDatabaseClient(): { client: Client; isLocal: boolean } {
  const config = databaseConfig();
  const client =
    globalDatabase.farCalculatorDb ??
    (globalDatabase.farCalculatorDb = createClient({
      url: config.url,
      authToken: config.authToken,
    }));
  return { client, isLocal: config.isLocal };
}

export async function getDatabase(): Promise<Client> {
  const { client, isLocal } = getDatabaseClient();
  if (isLocal) {
    await mkdir(join(process.cwd(), "data"), { recursive: true });
  }

  globalDatabase.farCalculatorDbReady ??= initializeDatabase(client);
  await globalDatabase.farCalculatorDbReady;
  return client;
}

export async function checkDatabaseConnection(): Promise<void> {
  const { client } = getDatabaseClient();
  await client.execute("SELECT 1");
}

async function initializeDatabase(client: Client): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS rule_sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dataset_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        imported_at TEXT,
        sha256 TEXT,
        source_ip TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS rule_sets_active_created
        ON rule_sets(active, created_at DESC)`,
      // Every ruleset a saved calculation used, keyed by hash, so results stay reproducible.
      `CREATE TABLE IF NOT EXISTS ruleset_snapshots (
        sha256 TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dataset_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('customer', 'architect')),
        status TEXT NOT NULL CHECK (status IN ('draft', 'new', 'in_review', 'verified', 'closed')),
        title TEXT NOT NULL,
        assigned_to TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS assessments_status_updated
        ON assessments(status, updated_at DESC)`,
      // Insert-only: revision 1 of a customer assessment is the original customer calculation.
      `CREATE TABLE IF NOT EXISTS assessment_revisions (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id),
        scenario TEXT NOT NULL,
        parent_id TEXT,
        input_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        baseline_result_json TEXT,
        overrides_json TEXT,
        ruleset_sha TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS assessment_revisions_assessment
        ON assessment_revisions(assessment_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS enquiries (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL REFERENCES assessments(id),
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        message TEXT,
        email_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        assessment_id TEXT,
        user_id TEXT,
        action TEXT NOT NULL,
        detail_json TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS audit_log_assessment
        ON audit_log(assessment_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('architect', 'admin')),
        password_hash TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL
      )`,
    ],
    "write",
  );

  const columns = await client.execute("PRAGMA table_info(rule_sets)");
  const existingColumns = new Set(
    columns.rows.map((row) => String(row.name)),
  );
  for (const [name, definition] of [
    ["imported_at", "TEXT"],
    ["sha256", "TEXT"],
    ["source_ip", "TEXT"],
  ]) {
    if (!existingColumns.has(name)) {
      await client.execute(`ALTER TABLE rule_sets ADD COLUMN ${name} ${definition}`);
    }
  }
}

export type ActiveRuleset = { dataset: RuleDataset; json: string; sha256: string };

export async function getActiveRuleset(): Promise<ActiveRuleset> {
  const client = await getDatabase();
  const result = await client.execute(
    "SELECT dataset_json FROM rule_sets WHERE active = 1 ORDER BY created_at DESC LIMIT 1",
  );
  const row = result.rows[0];
  if (!row || typeof row.dataset_json !== "string") {
    return bundledRuleset;
  }
  const parsed = ruleDatasetSchema.safeParse(JSON.parse(row.dataset_json));
  if (!parsed.success) {
    throw new Error("The active ruleset is invalid or uses an unsupported schema.");
  }
  return { dataset: parsed.data, json: row.dataset_json, sha256: sha256(row.dataset_json) };
}

export async function getActiveRuleDataset(): Promise<RuleDataset> {
  return (await getActiveRuleset()).dataset;
}

export async function activateRuleDataset(
  dataset: RuleDataset,
  metadata: { sha256: string; sourceIp: string },
): Promise<void> {
  const client = await getDatabase();
  const importedAt = new Date().toISOString();
  await client.batch(
    [
      {
        sql: "UPDATE rule_sets SET active = 0 WHERE active = 1",
        args: [],
      },
      {
        sql: "INSERT INTO rule_sets (id, name, dataset_json, active, created_at, imported_at, sha256, source_ip) VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
        args: [
          crypto.randomUUID(),
          dataset.name,
          JSON.stringify(dataset),
          importedAt,
          importedAt,
          metadata.sha256,
          metadata.sourceIp,
        ],
      },
      {
        sql: `DELETE FROM rule_sets
          WHERE active = 0
          AND id NOT IN (
            SELECT id FROM rule_sets
            WHERE active = 0
            ORDER BY created_at DESC, id DESC
            LIMIT 9
          )`,
        args: [],
      },
    ],
    "write",
  );
}

export async function revertToPreviousRuleDataset(): Promise<boolean> {
  const client = await getDatabase();
  const result = await client.execute(
    "SELECT id FROM rule_sets WHERE active = 0 ORDER BY created_at DESC, id DESC LIMIT 1",
  );
  const previousId = result.rows[0]?.id;
  if (typeof previousId !== "string") return false;

  await client.batch(
    [
      { sql: "UPDATE rule_sets SET active = 0 WHERE active = 1", args: [] },
      {
        sql: "UPDATE rule_sets SET active = 1 WHERE id = ?",
        args: [previousId],
      },
    ],
    "write",
  );
  return true;
}
