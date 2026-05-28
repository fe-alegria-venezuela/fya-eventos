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

// Status codes worth retrying — transient ones. Auth (401/403) and not-found (404) are not.
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
// Backoff: 200ms → 600ms → 1500ms. Last entry is unused (we stop after MAX_ATTEMPTS - 1 waits).
const BACKOFF_MS = [200, 600, 1500];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBody(res: Response): Promise<unknown> {
  try {
    const text = await res.clone().text();
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return null;
  }
}

// Wraps fetch with retry-on-transient + structured logging. Retries 429/5xx up to MAX_ATTEMPTS
// with exponential backoff. 4xx (except 408/425/429) is treated as terminal — no retry.
// Also honors a Retry-After header if Mailchimp sends one.
async function mcFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = init?.method || "GET";
  let lastRes: Response | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    let res: Response;
    try {
      res = await fetch(`${MC_BASE()}${path}`, {
        ...init,
        headers: { ...headers(), ...(init?.headers || {}) },
        cache: "no-store",
      });
    } catch (err) {
      // Network error (DNS, socket reset). Retry like a 5xx.
      const message = err instanceof Error ? err.message : String(err);
      log.warn("network error", { method, path, attempt, error: message });
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1]);
        continue;
      }
      log.error("network error — giving up", { method, path, attempts: attempt, error: message });
      throw err;
    }

    const elapsedMs = Date.now() - start;
    lastRes = res;

    if (res.ok) {
      if (attempt > 1) log.info("ok after retry", { method, path, status: res.status, attempt, elapsedMs });
      else log.info("ok", { method, path, status: res.status, elapsedMs });
      return res;
    }

    const retryable = TRANSIENT_STATUSES.has(res.status);
    const body = await readBody(res);

    if (retryable && attempt < MAX_ATTEMPTS) {
      // Mailchimp may suggest a wait time on rate-limit. Prefer it when present.
      const retryAfter = res.headers.get("retry-after");
      const headerMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 5000) : null;
      const waitMs = headerMs && !Number.isNaN(headerMs) ? headerMs : BACKOFF_MS[attempt - 1];
      log.warn("transient — retrying", {
        method,
        path,
        attempt,
        status: res.status,
        elapsedMs,
        waitMs,
      });
      await sleep(waitMs);
      continue;
    }

    log.error(retryable ? "transient — gave up" : "non-2xx", {
      method,
      path,
      attempts: attempt,
      status: res.status,
      elapsedMs,
      body,
    });
    return res;
  }

  // Shouldn't reach here, but TypeScript needs it.
  return lastRes!;
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

interface MembersWithTagsResp {
  members: { email_address: string; tags: { id: number; name: string }[] }[];
  total_items: number;
}

const RECENT_CHANGES_DAYS = 14;
const RECENT_CHANGES_PAGE_SIZE = 1000;

// Lists audience members modified in the last N days and filters locally by tag.
// This complements the heavily-cached /segments/{id}/members endpoint — Mailchimp's
// /lists/{id}/members is more real-time, so newly-tagged contacts show up here even
// when the tag's segment cache is still stale.
async function getRecentlyTaggedEmails(tagName: string): Promise<string[]> {
  const since = new Date(Date.now() - RECENT_CHANGES_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `/lists/${LIST()}/members?since_last_changed=${encodeURIComponent(since)}` +
    `&count=${RECENT_CHANGES_PAGE_SIZE}&fields=members.email_address,members.tags,total_items`;
  const res = await mcFetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as MembersWithTagsResp;
  const members = data.members || [];
  const matches = members
    .filter((m) => m.tags?.some((t) => t.name === tagName))
    .map((m) => m.email_address.toLowerCase());

  if (members.length >= RECENT_CHANGES_PAGE_SIZE) {
    log.warn("recent-changes hit page cap — older modifications may be truncated", {
      since,
      pageSize: RECENT_CHANGES_PAGE_SIZE,
      totalItems: data.total_items,
    });
  }

  log.info("recently-tagged scan", {
    tag: tagName,
    sinceDays: RECENT_CHANGES_DAYS,
    membersScanned: members.length,
    matches: matches.length,
  });
  return matches;
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

  // Run segment queries and the recent-changes scan in parallel — no extra latency.
  const [emailLists, recentInvited] = await Promise.all([
    Promise.all(validSegs.map((s) => getEmailsInSegment(s.id))),
    getRecentlyTaggedEmails(TAGS.INVITADO),
  ]);

  const union = new Set<string>();
  emailLists.forEach((emails, i) => {
    log.info("segment members", { segment: validSegs[i].name, count: emails.length });
    emails.forEach((e) => union.add(e));
  });

  // Add the recent-changes scan — catches newly tagged contacts the segment cache missed.
  const beforeRecent = union.size;
  recentInvited.forEach((e) => union.add(e));
  const addedByRecent = union.size - beforeRecent;
  log.info("union with recent-changes", {
    fromSegments: beforeRecent,
    addedByRecent,
    total: union.size,
  });

  if (union.size === 0) return [];

  // Fresh GET per member — bypasses the segment cache for tag accuracy.
  // Pair each result back with its source email so we know exactly who dropped.
  const emails = Array.from(union);
  const results = await Promise.all(emails.map((e) => getMember(e).then((m) => ({ email: e, m }))));
  const people: Person[] = [];
  const dropped: string[] = [];
  for (const { email, m } of results) {
    if (m) people.push(toPerson(m));
    else dropped.push(email);
  }

  if (dropped.length > 0) {
    // These are the emails causing the fluctuating count. Should be empty after retries
    // do their job. If consistently non-empty for the same emails, that contact has a
    // permanent issue (deleted, hard-bounced cleaned, archived not yet propagated).
    log.warn("DROPPED — member fetch failed after retries", {
      count: dropped.length,
      emails: dropped,
    });
  }

  const breakdown = {
    requested: union.size,
    fetched: people.length,
    dropped: dropped.length,
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
