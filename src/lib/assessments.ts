import { randomInt, randomUUID } from "node:crypto";
import { getActiveRuleset, getDatabase, type ActiveRuleset } from "@/lib/database";
import {
  ENGINE_VERSION,
  calculateFar,
  type CalculationInput,
  type CalculationResult,
} from "@/lib/rules";

export type CalculationRun = {
  ruleset: ActiveRuleset;
  result: CalculationResult;
  engineVersion: string;
  calculatedAt: string;
};

/** The single entry point both the customer calculator and the architect workspace use. */
export async function runCalculation(input: CalculationInput): Promise<CalculationRun> {
  const ruleset = await getActiveRuleset();
  return {
    ruleset,
    result: calculateFar(ruleset.dataset, input),
    engineVersion: ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
  };
}

// No 0/O/1/I so a reference read out over the phone is unambiguous.
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const assessmentIdPattern = /^FAR-[2-9A-HJ-NP-Z]{8}$/;

export function newAssessmentId(): string {
  let id = "FAR-";
  for (let index = 0; index < 8; index += 1) {
    id += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return id;
}

export function assessmentTitle(result: CalculationResult): string {
  return `${result.blockLabel} · ${result.occupancyLabels.join(", ")}`;
}

/** Saves a customer calculation as a new assessment with its original revision. */
export async function saveCustomerAssessment(
  input: CalculationInput,
  run: CalculationRun,
): Promise<string> {
  const client = await getDatabase();
  const id = newAssessmentId();
  await client.batch(
    [
      {
        sql: "INSERT OR IGNORE INTO ruleset_snapshots (sha256, name, dataset_json, created_at) VALUES (?, ?, ?, ?)",
        args: [run.ruleset.sha256, run.ruleset.dataset.name, run.ruleset.json, run.calculatedAt],
      },
      {
        sql: "INSERT INTO assessments (id, source, status, title, created_at, updated_at) VALUES (?, 'customer', 'draft', ?, ?, ?)",
        args: [id, assessmentTitle(run.result), run.calculatedAt, run.calculatedAt],
      },
      {
        sql: `INSERT INTO assessment_revisions
          (id, assessment_id, scenario, input_json, result_json, ruleset_sha, engine_version, created_at)
          VALUES (?, ?, 'Customer submission', ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          id,
          JSON.stringify(input),
          JSON.stringify(run.result),
          run.ruleset.sha256,
          run.engineVersion,
          run.calculatedAt,
        ],
      },
    ],
    "write",
  );
  return id;
}

export type EnquiryInput = {
  assessmentId: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
};

/**
 * Attaches contact details to a saved customer assessment and marks it as a new enquiry.
 * Returns the original customer result for the notification, or null if the reference is unknown.
 */
export async function createEnquiry(
  enquiry: EnquiryInput,
): Promise<{ enquiryId: string; title: string; result: CalculationResult } | null> {
  const client = await getDatabase();
  const found = await client.execute({
    sql: `SELECT a.title, r.result_json FROM assessments a
      JOIN assessment_revisions r ON r.assessment_id = a.id
      WHERE a.id = ? AND a.source = 'customer'
      ORDER BY r.created_at ASC LIMIT 1`,
    args: [enquiry.assessmentId],
  });
  const row = found.rows[0];
  if (!row) return null;

  const enquiryId = randomUUID();
  const now = new Date().toISOString();
  await client.batch(
    [
      {
        sql: "INSERT INTO enquiries (id, assessment_id, name, phone, email, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [enquiryId, enquiry.assessmentId, enquiry.name, enquiry.phone, enquiry.email, enquiry.message, now],
      },
      {
        sql: "UPDATE assessments SET status = 'new', updated_at = ? WHERE id = ? AND status = 'draft'",
        args: [now, enquiry.assessmentId],
      },
      {
        sql: "INSERT INTO audit_log (id, assessment_id, action, detail_json, created_at) VALUES (?, ?, 'enquiry_received', ?, ?)",
        args: [randomUUID(), enquiry.assessmentId, JSON.stringify({ enquiryId }), now],
      },
    ],
    "write",
  );
  return {
    enquiryId,
    title: String(row.title),
    result: JSON.parse(String(row.result_json)) as CalculationResult,
  };
}

export async function markEnquiryEmailed(enquiryId: string): Promise<void> {
  const client = await getDatabase();
  await client.execute({ sql: "UPDATE enquiries SET email_sent = 1 WHERE id = ?", args: [enquiryId] });
}
