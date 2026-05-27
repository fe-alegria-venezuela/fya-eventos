import { createHash } from "node:crypto";
import { env, TAGS } from "./env";

export type MemberStatus =
  | "subscribed"
  | "unsubscribed"
  | "cleaned"
  | "pending"
  | "transactional"
  | "archived";

export interface MailchimpMember {
  id: string;
  email_address: string;
  status: MemberStatus;
  merge_fields: Record<string, string>;
  tags: { id: number; name: string }[];
  last_changed?: string;
}

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

const MC_BASE = () => `https://${env.MAILCHIMP_SERVER()}.api.mailchimp.com/3.0`;
const LIST = () => env.MAILCHIMP_LIST_ID();

function auth(): string {
  return "Basic " + Buffer.from("any:" + env.MAILCHIMP_API_KEY()).toString("base64");
}

function md5(input: string): string {
  return createHash("md5").update(input.toLowerCase().trim()).digest("hex");
}

function headers() {
  return { Authorization: auth(), "Content-Type": "application/json" };
}

// Fresh fetches only — segment endpoints have stale tags (Mailchimp caches several days).
async function mcFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${MC_BASE()}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers || {}) },
    cache: "no-store",
  });
}

export async function getMember(email: string): Promise<MailchimpMember | null> {
  const res = await mcFetch(`/lists/${LIST()}/members/${md5(email)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function setTags(
  email: string,
  tags: { name: string; status: "active" | "inactive" }[],
): Promise<boolean> {
  const res = await mcFetch(`/lists/${LIST()}/members/${md5(email)}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}

function toPerson(m: MailchimpMember): Person {
  const tagNames = (m.tags || []).map((t) => t.name);
  const firstName = m.merge_fields?.FNAME?.trim() || "";
  const lastName = m.merge_fields?.LNAME?.trim() || "";
  const name = [firstName, lastName].filter(Boolean).join(" ") || m.email_address;
  return {
    id: m.id,
    email: m.email_address.toLowerCase(),
    name,
    firstName,
    lastName,
    tags: tagNames,
    hasConfirmed: tagNames.includes(TAGS.CONFIRMED),
    hasDeclined: tagNames.includes(TAGS.DECLINED),
    hasCheckedIn: tagNames.includes(TAGS.CHECKIN),
    lastChanged: m.last_changed,
  };
}

export async function getPerson(email: string): Promise<Person | null> {
  const m = await getMember(email);
  return m ? toPerson(m) : null;
}

interface SegmentList {
  segments: { id: number; name: string }[];
}

async function findSegmentIdByName(name: string): Promise<number | null> {
  // Static tag segments live under type=static; saved-segment tags can also live under type=saved.
  for (const type of ["static", "saved"]) {
    const res = await mcFetch(`/lists/${LIST()}/segments?type=${type}&count=200`);
    if (!res.ok) continue;
    const data = (await res.json()) as SegmentList;
    const found = data.segments?.find((s) => s.name === name);
    if (found) return found.id;
  }
  return null;
}

interface SegmentMembers {
  members: { id: string; email_address: string }[];
}

async function getEmailsInSegment(segmentId: number): Promise<string[]> {
  const res = await mcFetch(
    `/lists/${LIST()}/segments/${segmentId}/members?count=1000&fields=members.email_address`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as SegmentMembers;
  return (data.members || []).map((m) => m.email_address.toLowerCase());
}

// Returns full Person[] for everyone tagged "Invitado".
// Two-step: get emails from segment (fast), then individual GETs in parallel (fresh tags).
export async function getInvitedPeople(): Promise<Person[]> {
  const segId = await findSegmentIdByName(TAGS.INVITADO);
  if (!segId) return [];

  const emails = await getEmailsInSegment(segId);
  if (emails.length === 0) return [];

  const results = await Promise.all(emails.map((e) => getMember(e)));
  return results.filter((m): m is MailchimpMember => m !== null).map(toPerson);
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

function byName(a: Person, b: Person): number {
  return a.name.localeCompare(b.name, "es");
}

// Tag-flip helpers — encapsulate the "remove the opposite tag" rule.
export async function applyConfirmed(email: string): Promise<boolean> {
  return setTags(email, [
    { name: TAGS.CONFIRMED, status: "active" },
    { name: TAGS.DECLINED, status: "inactive" },
  ]);
}

export async function applyDeclined(email: string): Promise<boolean> {
  return setTags(email, [
    { name: TAGS.DECLINED, status: "active" },
    { name: TAGS.CONFIRMED, status: "inactive" },
  ]);
}

export async function applyCheckin(email: string): Promise<boolean> {
  return setTags(email, [{ name: TAGS.CHECKIN, status: "active" }]);
}

// Re-trigger the QR journey: flip the tag off and back on so Mailchimp's Customer
// Journey re-fires the "tag added" trigger.
export async function reapplyConfirmedTag(email: string): Promise<boolean> {
  const off = await setTags(email, [{ name: TAGS.CONFIRMED, status: "inactive" }]);
  if (!off) return false;
  await new Promise((r) => setTimeout(r, 400));
  return setTags(email, [{ name: TAGS.CONFIRMED, status: "active" }]);
}
