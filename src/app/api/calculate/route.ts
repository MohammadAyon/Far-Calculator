import { getActiveRuleDataset } from "@/lib/database";
import {
  CalculationError,
  calculateFar,
  calculationInputSchema,
} from "@/lib/rules";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const parsed = calculationInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Check the plot area, road width, block, and occupancy inputs.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const dataset = await getActiveRuleDataset();
    const result = calculateFar(dataset, parsed.data);
    return Response.json({ result });
  } catch (error) {
    if (error instanceof CalculationError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("FAR calculation failed.", error);
    return Response.json(
      { error: "The calculation service is unavailable. Check the server configuration." },
      { status: 503 },
    );
  }
}
