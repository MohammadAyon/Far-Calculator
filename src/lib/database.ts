import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { ruleDatasetSchema, type RuleDataset } from "@/lib/rules";

type DatabaseGlobal = typeof globalThis & {
  farCalculatorDb?: Client;
  farCalculatorDbReady?: Promise<void>;
};

const globalDatabase = globalThis as DatabaseGlobal;
let bundledRuleDatasetPromise: Promise<RuleDataset> | undefined;

function getBundledRuleDataset(): Promise<RuleDataset> {
  bundledRuleDatasetPromise ??= readFile(
    join(
      process.cwd(),
      "public",
      "rulesets",
      "dhaka-metropolitan-building-construction-rules-2025.json",
    ),
    "utf8",
  ).then((contents) => {
    const parsed = ruleDatasetSchema.safeParse(JSON.parse(contents));
    if (!parsed.success) {
      throw new Error("The bundled DAP 2025 ruleset is invalid.");
    }
    return parsed.data;
  });
  return bundledRuleDatasetPromise;
}

function createDatabaseClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (url && !url.startsWith("file:")) {
    return createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  return createClient({ url: url ?? "file:./data/far-calculator.db" });
}

export async function getDatabase(): Promise<Client> {
  const configuredUrl = process.env.TURSO_DATABASE_URL;
  const usesRemoteDatabase = Boolean(configuredUrl && !configuredUrl.startsWith("file:"));
  if (usesRemoteDatabase && !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("TURSO_AUTH_TOKEN is required with TURSO_DATABASE_URL.");
  }

  if (!usesRemoteDatabase) {
    await mkdir(join(process.cwd(), "data"), { recursive: true });
  }

  const client =
    globalDatabase.farCalculatorDb ??
    (globalDatabase.farCalculatorDb = createDatabaseClient());

  globalDatabase.farCalculatorDbReady ??= initializeDatabase(client);
  await globalDatabase.farCalculatorDbReady;
  return client;
}

async function initializeDatabase(client: Client): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS rule_sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dataset_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS rule_sets_active_created
        ON rule_sets(active, created_at DESC)`,
    ],
    "write",
  );
}

export async function getActiveRuleDataset(): Promise<RuleDataset> {
  const client = await getDatabase();
  const result = await client.execute(
    "SELECT dataset_json FROM rule_sets WHERE active = 1 ORDER BY created_at DESC LIMIT 1",
  );
  const row = result.rows[0];
  if (!row || typeof row.dataset_json !== "string") {
    return getBundledRuleDataset();
  }
  const parsed = ruleDatasetSchema.safeParse(JSON.parse(row.dataset_json));
  if (!parsed.success) {
    throw new Error("The active ruleset is invalid or uses an unsupported schema.");
  }
  return parsed.data;
}

export async function activateRuleDataset(
  dataset: RuleDataset,
): Promise<void> {
  const client = await getDatabase();
  const createdAt = new Date().toISOString();
  await client.batch(
    [
      {
        sql: "UPDATE rule_sets SET active = 0 WHERE active = 1",
        args: [],
      },
      {
        sql: "INSERT INTO rule_sets (id, name, dataset_json, active, created_at) VALUES (?, ?, ?, 1, ?)",
        args: [
          crypto.randomUUID(),
          dataset.name,
          JSON.stringify(dataset),
          createdAt,
        ],
      },
    ],
    "write",
  );
}
