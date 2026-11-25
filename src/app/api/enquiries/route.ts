import { z } from "zod";
import {
  assessmentIdPattern,
  createEnquiry,
  markEnquiryEmailed,
} from "@/lib/assessments";
import type { CalculationResult } from "@/lib/rules";

const enquirySchema = z
  .object({
    assessmentId: z.string().regex(assessmentIdPattern),
    name: z.string().trim().min(2, "Enter your name.").max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{6,19}$/, "Enter a valid phone number."),
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email or leave it empty.").max(200)]).default(""),
    message: z.string().trim().max(1000).default(""),
    // Honeypot: hidden from people, so anything here came from a bot.
    website: z.string().max(200).default(""),
  })
  .strict();

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }
  const parsed = enquirySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: parsed.error.issues[0]?.message ?? "Check your contact details.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }
  const { website, ...data } = parsed.data;
  if (website) return Response.json({ status: "ok" });

  try {
    const saved = await createEnquiry({
      assessmentId: data.assessmentId,
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      message: data.message || null,
    });
    if (!saved) {
      return Response.json(
        { error: "This calculation reference was not found. Please calculate again and resend." },
        { status: 404 },
      );
    }
    if (await sendEnquiryEmail(data, saved.title, saved.result)) {
      await markEnquiryEmailed(saved.enquiryId).catch((error) =>
        console.error("Could not mark the enquiry as emailed.", error),
      );
    }
    return Response.json({ status: "ok", reference: data.assessmentId });
  } catch (error) {
    console.error("Could not save the enquiry.", error);
    return Response.json(
      { error: "We could not send your request just now. Please call us or try again." },
      { status: 503 },
    );
  }
}

async function sendEnquiryEmail(
  data: { assessmentId: string; name: string; phone: string; email: string; message: string },
  title: string,
  result: CalculationResult,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ENQUIRY_EMAIL_TO;
  const from = process.env.ENQUIRY_EMAIL_FROM;
  if (!apiKey || !to || !from) {
    console.warn("Enquiry email skipped: RESEND_API_KEY, ENQUIRY_EMAIL_TO or ENQUIRY_EMAIL_FROM is not set.");
    return false;
  }
  const number = (value: number, digits = 2) => value.toLocaleString("en-US", { maximumFractionDigits: digits });
  const text = [
    `New feasibility review request ${data.assessmentId}`,
    "",
    `Name: ${data.name}`,
    `Phone: ${data.phone}`,
    `Email: ${data.email || "not given"}`,
    `Message: ${data.message || "none"}`,
    "",
    `Plot: ${title}`,
    `Plot area: ${number(result.plotAreaSqft, 0)} sq ft (net ${number(result.netPlotAreaSqft, 0)} sq ft)`,
    `Road: ${number(result.existingRoadWidthFt)} ft${result.proposedRoadWidthFt ? `, proposed ${number(result.proposedRoadWidthFt)} ft` : ""}`,
    `Applied FAR: ${number(result.appliedFar)}`,
    `Buildable floor area: ${number(result.floorAreaSqft, 0)} sq ft`,
    "",
    "Open the architect workspace to review it.",
  ].join("\n");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.split(",").map((address) => address.trim()),
        ...(data.email ? { reply_to: data.email } : {}),
        subject: `FAR review request ${data.assessmentId}: ${title}`,
        text,
      }),
    });
    if (!response.ok) {
      console.error("Enquiry email failed.", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("Enquiry email failed.", error);
    return false;
  }
}
