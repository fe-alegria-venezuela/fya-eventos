import { buildDashboard } from "@/lib/dashboard";
import { findAll } from "@/lib/invitees";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reads straight from MongoDB — fast, no Mailchimp, no rate limits. The dashboard
// polls this every ~25s; Mailchimp is only touched by the sync job.
export async function GET() {
  try {
    const people = await findAll();
    return Response.json(buildDashboard(people), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
