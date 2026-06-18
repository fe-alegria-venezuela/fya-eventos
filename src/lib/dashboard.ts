// Neutral domain types + dashboard builder. Kept independent of the data source
// (Mailchimp vs MongoDB) so both the sync layer and the DB layer can produce a
// `Person[]` and the dashboard renders the same way regardless of origin.

export interface Person {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  tags: string[];
  hasConfirmed: boolean;
  hasDeclined: boolean;
  hasCheckedIn: boolean;
  lastChanged?: string;
}

export interface DashboardStats {
  totalInvited: number;
  confirmed: number;
  declined: number;
  noResponse: number;
  arrived: number;
  pending: number;
  attendanceRate: number;
}

export interface DashboardData {
  stats: DashboardStats;
  confirmed: Person[];
  declined: Person[];
  noResponse: Person[];
  timestamp: string;
}

function byName(a: Person, b: Person): number {
  return a.name.localeCompare(b.name, "es");
}

export function buildDashboard(people: Person[]): DashboardData {
  const confirmed = people.filter((p) => p.hasConfirmed && !p.hasDeclined);
  const declined = people.filter((p) => p.hasDeclined && !p.hasConfirmed);
  const noResponse = people.filter((p) => !p.hasConfirmed && !p.hasDeclined);
  const arrived = confirmed.filter((p) => p.hasCheckedIn).length;

  return {
    stats: {
      totalInvited: people.length,
      confirmed: confirmed.length,
      declined: declined.length,
      noResponse: noResponse.length,
      arrived,
      pending: confirmed.length - arrived,
      attendanceRate: confirmed.length > 0 ? Math.round((arrived / confirmed.length) * 100) : 0,
    },
    confirmed: confirmed.sort(byName),
    declined: declined.sort(byName),
    noResponse: noResponse.sort(byName),
    timestamp: new Date().toISOString(),
  };
}
