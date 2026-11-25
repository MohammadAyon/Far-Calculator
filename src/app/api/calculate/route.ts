import { runCalculation, saveCustomerAssessment } from "@/lib/assessments";
import {
  CalculationError,
  customerCalculationInputSchema,
  customerToEngineInput,
} from "@/lib/rules";

// Public customer calculator. Architect-only parameters are not part of the schema, so they are rejected.
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = customerCalculationInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Check the plot area, road width, block, and building use.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const input = customerToEngineInput(parsed.data);
    const run = await runCalculation(input);
    // Saving gives the customer a reference; a failed save must not block their result.
    let reference: string | null = null;
    try {
      reference = await saveCustomerAssessment(input, run);
    } catch (error) {
      console.error("Could not save the customer assessment.", error);
    }
    return Response.json({
      result: run.result,
      reference,
      rulesetName: run.ruleset.dataset.name,
      rulesetSha: run.ruleset.sha256,
      engineVersion: run.engineVersion,
      calculatedAt: run.calculatedAt,
    });
  } catch (error) {
    if (error instanceof CalculationError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("FAR calculation failed.", error);
    return Response.json(
      { error: "The calculator is temporarily unavailable. Please try again in a moment." },
      { status: 503 },
    );
  }
}
