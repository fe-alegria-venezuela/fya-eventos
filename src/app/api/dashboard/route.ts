import { buildDashboard, getInvitedPeople } from "@/lib/mailchimp";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export async function GET() {
  try {
    const people = await getInvitedPeople();
    return Response.json(buildDashboard(people), {
      headers: {
        "Cache-Control": "private, max-age=20, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
