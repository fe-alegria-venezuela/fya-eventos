import DashboardClient from "./DashboardClient";
import { buildDashboard, type DashboardData } from "@/lib/dashboard";
import { findAll } from "@/lib/invitees";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadInitial(): Promise<DashboardData | null> {
  try {
    // Initial render reads from MongoDB (fast, no Mailchimp). The sync job is the
    // only thing that pulls from Mailchimp.
    return buildDashboard(await findAll());
  } catch {
    // Render the dashboard shell anyway; the client retries via /api/dashboard.
    return null;
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return <DashboardClient initialData={initial} />;
}
