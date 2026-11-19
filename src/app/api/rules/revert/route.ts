import { revertToPreviousRuleDataset } from "@/lib/database";
import { authorizeDataImport } from "@/lib/data-import-auth";

export async function POST(request: Request) {
  const denied = authorizeDataImport(request);
  if (denied) return denied;

  try {
    if (!(await revertToPreviousRuleDataset())) {
      return Response.json(
        { error: "There is no previous ruleset to restore." },
        { status: 409 },
      );
    }
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Unable to revert the rule dataset.", error);
    return Response.json(
      { error: "The rule dataset could not be reverted." },
      { status: 503 },
    );
  }
}
