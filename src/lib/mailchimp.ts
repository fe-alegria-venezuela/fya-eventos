import { createHash } from "node:crypto";
import { env, TAGS } from "./env";
import { logger, mask } from "./log";

const log = logger("mailchimp");

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

// Wraps fetch with structured logging. Logs path + status; on failure also dumps body.
async function mcFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = init?.method || "GET";
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(`${MC_BASE()}${path}`, {
      ...init,
      headers: { ...headers(), ...(init?.headers || {}) },
      cache: "no-store",
    });
  } catch (err) {
    log.error("network error", { method, path, error: err instanceof Error ? err.message : err });
    throw err;
  }

  const elapsedMs = Date.now() - start;
  if (!res.ok) {
    let body: unknown = null;
    try {
      const text = await res.clone().text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 500);
      }
    } catch {
      // ignore
    }
    log.error("non-2xx", { method, path, status: res.status, elapsedMs, body });
  } else {
    log.info("ok", { method, path, status: res.status, elapsedMs });
  }
  return res;
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
  log.info("setTags", { email, tags });
  const res = await mcFetch(`/lists/${LIST()}/members/${md5(email)}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}

// After a write, fetch and log the current tags. Helps confirm whether Mailchimp
// actually landed the change (vs. silently dropping it due to tag-name mismatch).
async function logTagState(email: string, when: string): Promise<string[]> {
  const m = await getMember(email);
  const tags = (m?.tags || []).map((t) => t.name);
  // Status matters: a Journey will skip contacts that aren't "subscribed".
  log.info(`tag state ${when}`, { email, status: m?.status, tags });
  return tags;
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
  for (const type of ["static", "saved"]) {
    const res = await mcFetch(`/lists/${LIST()}/segments?type=${type}&count=200`);
    if (!res.ok) continue;
    const data = (await res.json()) as SegmentList;
    const found = data.segments?.find((s) => s.name === name);
    if (found) {
      log.info("segment found", { name, type, id: found.id });
      return found.id;
    }
  }
  log.warn("segment not found", { name });
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

export async function getInvitedPeople(): Promise<Person[]> {
  log.info("getInvitedPeople start", { apiKey: mask(env.MAILCHIMP_API_KEY()), list: LIST() });

  // Mailchimp's /segments/{id}/members endpoint is cached server-side for hours/days.
  // Querying ONLY the Invitado segment misses contacts whose tag was applied recently.
  // We query Invitado + Sí asistirá + No asistirá in parallel and union the emails so a
  // stale entry in one segment is rescued by the others.
  const probeNames: string[] = [TAGS.INVITADO, TAGS.CONFIRMED, TAGS.DECLINED];
  const segIds = await Promise.all(probeNames.map((n) => findSegmentIdByName(n)));
  const validSegs: { name: string; id: number }[] = probeNames
    .map((name, i) => ({ name, id: segIds[i] }))
    .filter((s): s is { name: string; id: number } => s.id !== null);

  if (validSegs.length === 0) {
    log.warn("no usable segments found", { probeNames });
    return [];
  }

  const emailLists = await Promise.all(validSegs.map((s) => getEmailsInSegment(s.id)));
  const union = new Set<string>();
  emailLists.forEach((emails, i) => {
    log.info("segment members", { segment: validSegs[i].name, count: emails.length });
    emails.forEach((e) => union.add(e));
  });
  log.info("union of segments", { uniqueEmails: union.size });

  if (union.size === 0) return [];

  // Fresh GET per member — bypasses the segment cache for tag accuracy.
  const results = await Promise.all(Array.from(union).map((e) => getMember(e)));
  const people = results.filter((m): m is MailchimpMember => m !== null).map(toPerson);

  // Visibility: log a tag breakdown so it's obvious why someone is/isn't counted.
  const breakdown = {
    total: people.length,
    confirmed: people.filter((p) => p.hasConfirmed && !p.hasDeclined).length,
    declined: people.filter((p) => p.hasDeclined && !p.hasConfirmed).length,
    noResponse: people.filter((p) => !p.hasConfirmed && !p.hasDeclined).length,
    checkedIn: people.filter((p) => p.hasCheckedIn).length,
  };
  log.info("getInvitedPeople done", breakdown);
  return people;
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

export async function applyConfirmed(email: string): Promise<boolean> {
  log.info("applyConfirmed start", { email, tagName: TAGS.CONFIRMED });
  await logTagState(email, "before applyConfirmed");
  const ok = await setTags(email, [
    { name: TAGS.CONFIRMED, status: "active" },
    { name: TAGS.DECLINED, status: "inactive" },
  ]);
  const after = await logTagState(email, "after applyConfirmed");
  if (!after.includes(TAGS.CONFIRMED)) {
    log.warn("CONFIRMED tag did NOT land — check tag name normalization in Mailchimp", {
      expected: TAGS.CONFIRMED,
      actualTags: after,
    });
  }
  log.info("applyConfirmed done", { email, ok, hasConfirmed: after.includes(TAGS.CONFIRMED) });
  return ok;
}

export async function applyDeclined(email: string): Promise<boolean> {
  log.info("applyDeclined start", { email });
  const ok = await setTags(email, [
    { name: TAGS.DECLINED, status: "active" },
    { name: TAGS.CONFIRMED, status: "inactive" },
  ]);
  await logTagState(email, "after applyDeclined");
  log.info("applyDeclined done", { email, ok });
  return ok;
}

export async function applyCheckin(email: string): Promise<boolean> {
  log.info("applyCheckin start", { email });
  const ok = await setTags(email, [{ name: TAGS.CHECKIN, status: "active" }]);
  await logTagState(email, "after applyCheckin");
  log.info("applyCheckin done", { email, ok });
  return ok;
}

// Off → 400ms → on to re-trigger the Mailchimp Customer Journey that sends the QR.
export async function reapplyConfirmedTag(email: string): Promise<boolean> {
  log.info("reapplyConfirmedTag start", { email, tagName: TAGS.CONFIRMED });
  await logTagState(email, "before reapply");

  log.info("reapply: flipping OFF");
  const off = await setTags(email, [{ name: TAGS.CONFIRMED, status: "inactive" }]);
  if (!off) {
    log.error("reapply: OFF flip failed — aborting");
    return false;
  }
  await logTagState(email, "after OFF flip");

  log.info("reapply: sleeping 400ms before ON flip");
  await new Promise((r) => setTimeout(r, 400));

  log.info("reapply: flipping ON");
  const on = await setTags(email, [{ name: TAGS.CONFIRMED, status: "active" }]);
  const finalTags = await logTagState(email, "after ON flip");

  if (!finalTags.includes(TAGS.CONFIRMED)) {
    log.error("reapply: CONFIRMED tag NOT present after ON flip — Mailchimp Journey will NOT fire", {
      expected: TAGS.CONFIRMED,
      actualTags: finalTags,
    });
  } else {
    log.info("reapply done — Journey should fire if its trigger is 'tag added: Sí asistirá'");
  }
  return on;
}
