import { getDatabase } from "@/lib/database";

export async function GET() {
  try {
    await getDatabase();
    return Response.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check could not connect to the database.", error);
    return Response.json(
      { status: "error", database: "unavailable" },
      { status: 503 },
    );
  }
}
