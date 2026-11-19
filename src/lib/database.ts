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

export async function getActiveRuleDataset(): Promise<RuleDataset> {
  const client = await getDatabase();
  const result = await client.execute(
    "SELECT dataset_json FROM rule_sets WHERE active = 1 ORDER BY created_at DESC LIMIT 1",
  );
  const row = result.rows[0];
  if (!row || typeof row.dataset_json !== "string") {
    return bundledRuleDataset;
  }
  const parsed = ruleDatasetSchema.safeParse(JSON.parse(row.dataset_json));
  if (!parsed.success) {
    throw new Error("The active ruleset is invalid or uses an unsupported schema.");
  }
  return parsed.data;
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
