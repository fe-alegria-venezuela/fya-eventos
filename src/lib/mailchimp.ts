import { createHash } from "node:crypto";
import { env, SEGMENT_ID_OVERRIDES, TAGS } from "./env";
import { logger, mask } from "./log";
import type { Person } from "./dashboard";

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
// Base backoff. Jitter (±50%) is added per call so concurrent retries don't
// resync and burst Akamai again.
const BACKOFF_BASE_MS = [400, 1200, 3000];

function jitteredBackoff(attempt: number): number {
  const base = BACKOFF_BASE_MS[attempt - 1] ?? BACKOFF_BASE_MS[BACKOFF_BASE_MS.length - 1];
  // Deterministic-ish jitter: don't pull from Math.random (forbidden in some contexts)
  // and don't need cryptographic randomness — a time-derived value is enough to spread.
  const jitter = ((Date.now() & 0xff) / 255) * base * 0.5 - base * 0.25;
  return Math.max(50, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Pool-based map: at most `concurrency` calls in flight at any moment. Prevents
// Akamai (Mailchimp's WAF) from blocking us when we GET many members at once.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
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

// ── Akamai circuit breaker ──────────────────────────────────────────────────
// When Akamai's WAF starts rejecting our IP (akamai_503), retrying immediately
// makes the cooldown longer. Track recent Akamai 503s and short-circuit for
// AKAMAI_COOLDOWN_MS so we stop hammering. Self-resets after the cooldown.
const AKAMAI_503_WINDOW_MS = 30_000;
const AKAMAI_503_THRESHOLD = 3;
const AKAMAI_COOLDOWN_MS = 3 * 60_000;

let akamai503Count = 0;
let akamai503WindowStart = 0;
let akamaiBlockedUntil = 0;

function isAkamaiBlocked(): boolean {
  if (Date.now() < akamaiBlockedUntil) return true;
  if (akamaiBlockedUntil > 0) {
    // Cooldown elapsed — log the recovery so it's visible.
    log.info("akamai circuit CLOSED — resuming requests");
    akamaiBlockedUntil = 0;
    akamai503Count = 0;
  }
  return false;
}

function isAkamaiBody(body: unknown): boolean {
  return !!(
    body &&
    typeof body === "object" &&
    "type" in body &&
    (body as { type?: unknown }).type === "akamai_error_message"
  );
}

function recordAkamai503() {
  const now = Date.now();
  if (now - akamai503WindowStart > AKAMAI_503_WINDOW_MS) {
    akamai503WindowStart = now;
    akamai503Count = 1;
  } else {
    akamai503Count++;
  }
  if (akamai503Count >= AKAMAI_503_THRESHOLD) {
    akamaiBlockedUntil = now + AKAMAI_COOLDOWN_MS;
    log.error("akamai circuit OPEN — cooling down", {
      count: akamai503Count,
      cooldownMs: AKAMAI_COOLDOWN_MS,
      until: new Date(akamaiBlockedUntil).toISOString(),
    });
  }
}

function shortCircuitResponse(path: string): Response {
  log.warn("akamai circuit open — skipping request", { path });
  return new Response('{"circuit":"open"}', {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

// Wraps fetch with retry-on-transient + structured logging. Retries 429/5xx up to MAX_ATTEMPTS
// with exponential backoff. 4xx (except 408/425/429) is treated as terminal — no retry.
// Also honors a Retry-After header if Mailchimp sends one.
async function mcFetch(path: string, init?: RequestInit): Promise<Response> {
  if (isAkamaiBlocked()) return shortCircuitResponse(path);

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
        await sleep(jitteredBackoff(attempt));
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

    // If this is Akamai blocking, record it and (on the last failed attempt)
    // potentially open the circuit so the NEXT calls short-circuit immediately.
    if (isAkamaiBody(body)) {
      recordAkamai503();
      if (isAkamaiBlocked()) {
        // Circuit just opened — abandon retries on this request too.
        log.warn("akamai circuit opened mid-request — aborting further retries", {
          method,
          path,
          attempt,
        });
        return res;
      }
    }

    if (retryable && attempt < MAX_ATTEMPTS) {
      // Mailchimp may suggest a wait time on rate-limit. Prefer it when present.
      const retryAfter = res.headers.get("retry-after");
      const headerMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 5000) : null;
      const waitMs = headerMs && !Number.isNaN(headerMs) ? headerMs : jitteredBackoff(attempt);
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

// Segment IDs are basically immutable (created once when a tag is created). Cache them
// at module level so we stop spamming /segments?type=... on every dashboard refresh.
const SEGMENT_ID_TTL_MS = 10 * 60 * 1000;
const segmentIdCache = new Map<string, { id: number; expiresAt: number }>();

// One request per segment type (static + saved) instead of N requests per N names.
// Returns a name → id map, with null for names not found.
// Resolution order: env-var override → in-memory cache → API lookup.
async function findSegmentIdsByNames(names: string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const now = Date.now();

  // 1. Env-var overrides take absolute priority. With these set we never call /segments at all.
  for (const name of names) {
    const override = SEGMENT_ID_OVERRIDES[name];
    if (override != null) {
      result.set(name, override);
      // Also seed the cache for completeness.
      segmentIdCache.set(name, { id: override, expiresAt: now + SEGMENT_ID_TTL_MS });
    }
  }

  // 2. Resolve from runtime cache where possible.
  const uncached: string[] = [];
  for (const name of names) {
    if (result.has(name)) continue;
    const hit = segmentIdCache.get(name);
    if (hit && hit.expiresAt > now) {
      result.set(name, hit.id);
    } else {
      uncached.push(name);
    }
  }

  if (uncached.length === 0) {
    log.info("segment IDs resolved without /segments call", {
      names,
      fromEnv: names.filter((n) => SEGMENT_ID_OVERRIDES[n] != null),
    });
    return result;
  }

  // 2. ONE fetch per segment type, regardless of how many names we're looking up.
  for (const type of ["static", "saved"]) {
    const res = await mcFetch(`/lists/${LIST()}/segments?type=${type}&count=200`);
    if (!res.ok) continue;
    const data = (await res.json()) as SegmentList;
    for (const seg of data.segments || []) {
      if (uncached.includes(seg.name) && !result.has(seg.name)) {
        result.set(seg.name, seg.id);
        segmentIdCache.set(seg.name, { id: seg.id, expiresAt: now + SEGMENT_ID_TTL_MS });
        log.info("segment found", { name: seg.name, type, id: seg.id });
      }
    }
    // Early exit: all names found, skip the "saved" lookup.
    if (uncached.every((n) => result.has(n))) break;
  }

  // 3. Names still not found get null + a warning.
  for (const name of uncached) {
    if (!result.has(name)) {
      result.set(name, null);
      log.warn("segment not found", { name });
    }
  }

  return result;
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

interface MembersListResp {
  members: MailchimpMember[];
  total_items: number;
}

const RECENT_CHANGES_DAYS = 60;
const RECENT_CHANGES_PAGE_SIZE = 1000;
// Hard cap to avoid runaway pagination on very active audiences (57K total members
// could have many thousand recent changes during a campaign).
const RECENT_CHANGES_MAX_PAGES = 12;
// Cap concurrent per-member GETs to dodge Akamai's WAF burst-detection.
const MEMBER_GET_CONCURRENCY = 6;

// Lists audience members modified in the last N days with full tag + merge_field data.
// PAGINATES through results — a busy audience can easily have thousands of modifications
// in 60 days (opens, clicks, status changes), so a single 1000-item page would miss most
// of our invitados.
async function getRecentlyChangedMembers(): Promise<MailchimpMember[]> {
  const since = new Date(Date.now() - RECENT_CHANGES_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const all: MailchimpMember[] = [];
  let offset = 0;
  let page = 0;
  let totalItems: number | undefined;

  while (page < RECENT_CHANGES_MAX_PAGES) {
    const url =
      `/lists/${LIST()}/members?since_last_changed=${encodeURIComponent(since)}` +
      `&count=${RECENT_CHANGES_PAGE_SIZE}&offset=${offset}` +
      `&fields=members.id,members.email_address,members.status,members.merge_fields,members.tags,members.last_changed,total_items`;
    const res = await mcFetch(url);
    if (!res.ok) {
      log.warn("recent-changes pagination — page fetch failed", { page, offset, status: res.status });
      break;
    }

    const data = (await res.json()) as MembersListResp;
    const members = data.members || [];
    totalItems = data.total_items;
    all.push(...members);
    page++;

    // Done — last page was a partial.
    if (members.length < RECENT_CHANGES_PAGE_SIZE) break;
    if (totalItems !== undefined && all.length >= totalItems) break;

    offset += RECENT_CHANGES_PAGE_SIZE;

    // Polite gap between pages so Akamai doesn't lump consecutive page fetches into a burst.
    await sleep(200);
  }

  const taggedInvitado = all.filter((m) => m.tags?.some((t) => t.name === TAGS.INVITADO)).length;

  log.info("recent-changes scan", {
    sinceDays: RECENT_CHANGES_DAYS,
    pages: page,
    membersScanned: all.length,
    totalItems,
    taggedInvitado,
  });

  if (
    page >= RECENT_CHANGES_MAX_PAGES &&
    totalItems !== undefined &&
    all.length < totalItems
  ) {
    log.warn("recent-changes hit max-pages cap — older modifications may be truncated", {
      scanned: all.length,
      totalItems,
      maxPages: RECENT_CHANGES_MAX_PAGES,
    });
  }

  return all;
}

// Last-known-good cache for getInvitedPeople. When Mailchimp is unreachable (Akamai cooldown
// or any other failure), we serve this instead of an empty dashboard. TTL is long enough
// to bridge most outages but short enough that stale data is obviously old.
const LAST_GOOD_TTL_MS = 5 * 60_000;
let lastGoodPeople: { people: Person[]; at: number } | null = null;

export async function getInvitedPeople(): Promise<Person[]> {
  log.info("getInvitedPeople start", { apiKey: mask(env.MAILCHIMP_API_KEY()), list: LIST() });

  // Short-circuit immediately if Akamai is cooling us down — don't even try.
  if (isAkamaiBlocked() && lastGoodPeople) {
    const ageMs = Date.now() - lastGoodPeople.at;
    if (ageMs < LAST_GOOD_TTL_MS) {
      log.warn("akamai blocked — serving last-known-good cache", {
        ageMs,
        people: lastGoodPeople.people.length,
      });
      return lastGoodPeople.people;
    }
  }

  // Step 1: discover the universe of "people we care about" via segment emails.
  // Segments are cheap and indexed, but their cached membership lags by hours.
  // ONE batched lookup instead of N parallel-identical requests that triggered Akamai.
  const probeNames: string[] = [TAGS.INVITADO, TAGS.CONFIRMED, TAGS.DECLINED];
  const segIdMap = await findSegmentIdsByNames(probeNames);
  const validSegs: { name: string; id: number }[] = probeNames
    .map((name) => ({ name, id: segIdMap.get(name) ?? null }))
    .filter((s): s is { name: string; id: number } => s.id !== null);

  if (validSegs.length === 0) {
    log.warn("no usable segments found", { probeNames });
    // Fall back to last-known-good if we have it — better than zeroed dashboard.
    if (lastGoodPeople && Date.now() - lastGoodPeople.at < LAST_GOOD_TTL_MS) {
      log.warn("serving last-known-good due to no segments", { people: lastGoodPeople.people.length });
      return lastGoodPeople.people;
    }
    return [];
  }

  // Step 2: run segment list + recent-changes bulk fetch in parallel.
  // The bulk fetch returns FULL fresh records (tags, merge_fields, status) for everyone
  // modified in the last N days. We reuse this data and skip individual GETs for them —
  // that's how we avoid the 100+ parallel requests that triggered Akamai's WAF.
  const [emailLists, recentMembers] = await Promise.all([
    Promise.all(validSegs.map((s) => getEmailsInSegment(s.id))),
    getRecentlyChangedMembers(),
  ]);

  const union = new Set<string>();
  emailLists.forEach((emails, i) => {
    log.info("segment members", { segment: validSegs[i].name, count: emails.length });
    emails.forEach((e) => union.add(e));
  });

  // Rescue: any recent-changes member tagged Invitado that the segment cache missed.
  const beforeRecent = union.size;
  for (const m of recentMembers) {
    if (m.tags?.some((t) => t.name === TAGS.INVITADO)) {
      union.add(m.email_address.toLowerCase());
    }
  }
  log.info("union with recent-changes rescue", {
    fromSegments: beforeRecent,
    addedByRecent: union.size - beforeRecent,
    total: union.size,
  });

  if (union.size === 0) return [];

  // Step 3: classify each email — do we ALREADY have fresh data from the bulk fetch?
  const bulkByEmail = new Map<string, MailchimpMember>();
  for (const m of recentMembers) {
    bulkByEmail.set(m.email_address.toLowerCase(), m);
  }

  const people: Person[] = [];
  const needIndividualGet: string[] = [];
  for (const email of union) {
    const cached = bulkByEmail.get(email);
    if (cached) people.push(toPerson(cached));
    else needIndividualGet.push(email);
  }

  log.info("data source breakdown", {
    fromBulkFetch: people.length,
    needIndividualGet: needIndividualGet.length,
  });

  // Step 4: only the leftovers go through individual GETs, with concurrency limited
  // so Akamai doesn't see a burst.
  const dropped: string[] = [];
  if (needIndividualGet.length > 0) {
    const results = await mapWithConcurrency(needIndividualGet, MEMBER_GET_CONCURRENCY, (e) =>
      getMember(e).then((m) => ({ email: e, m })),
    );
    for (const { email, m } of results) {
      if (m) people.push(toPerson(m));
      else dropped.push(email);
    }
  }

  if (dropped.length > 0) {
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

  // Cache only "healthy" results — non-empty and the fetched count is reasonable.
  if (people.length > 0) {
    lastGoodPeople = { people, at: Date.now() };
  }
  return people;
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

// Reverts a check-in by flipping the CHECKIN tag off. Used to fix mistaken arrivals
// (e.g. a guest who self-scanned by accident) from the dashboard.
export async function applyUndoCheckin(email: string): Promise<boolean> {
  log.info("applyUndoCheckin start", { email });
  const ok = await setTags(email, [{ name: TAGS.CHECKIN, status: "inactive" }]);
  await logTagState(email, "after applyUndoCheckin");
  log.info("applyUndoCheckin done", { email, ok });
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
