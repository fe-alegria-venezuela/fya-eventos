import DashboardClient from "./DashboardClient";
import { buildDashboard, getInvitedPeople, type DashboardData } from "@/lib/mailchimp";

export const dynamic = "force-dynamic";

async function loadInitial(): Promise<DashboardData | null> {
  try {
    return buildDashboard(await getInvitedPeople());
  } catch {
    // Render the dashboard shell anyway; the client retries via /api/dashboard.
    return null;
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return <DashboardClient initialData={initial} />;
}
