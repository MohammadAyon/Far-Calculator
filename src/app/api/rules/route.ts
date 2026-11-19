import { getActiveRuleDataset } from "@/lib/database";

export async function GET() {
  try {
    const dataset = await getActiveRuleDataset();
    return Response.json({ dataset });
  } catch (error) {
    console.error("Unable to load the active rule dataset.", error);
    return Response.json(
      { error: "The rule database is unavailable. Check the server configuration." },
      { status: 503 },
    );
  }
}
