import { getInvitedPeople } from "./mailchimp";
import { upsertFromMailchimp, type SyncCounts } from "./invitees";
import { logger } from "./log";

const log = logger("sync");

export interface SyncResult extends SyncCounts {
  at: string; // ISO timestamp of completion
  atMs: number;
  skipped?: boolean;
}

// Minimum gap between manual syncs. Guards against double-clicks and abuse of the
// (unauthenticated) dashboard button hammering Mailchimp — the very thing we're
// trying to avoid. The cron passes { force: true } and bypasses this.
const MIN_INTERVAL_MS = 30_000;

let inFlight: Promise<SyncResult> | null = null;
let lastResult: SyncResult | null = null;

// The single heavy Mailchimp fetch. Pulls the audience + statuses and upserts them
// into Mongo with a conservative merge (see invitees.upsertFromMailchimp).
export async function syncFromMailchimp(opts?: { force?: boolean }): Promise<SyncResult> {
  // Coalesce concurrent triggers (e.g. button + cron landing together) onto one run.
  if (inFlight) {
    log.info("sync already in flight — joining existing run");
    return inFlight;
  }

  // Debounce rapid manual re-triggers.
  if (!opts?.force && lastResult && Date.now() - lastResult.atMs < MIN_INTERVAL_MS) {
    log.info("sync skipped — ran recently", { sinceMs: Date.now() - lastResult.atMs });
    return { ...lastResult, skipped: true };
  }

  inFlight = (async (): Promise<SyncResult> => {
    const startedMs = Date.now();
    log.info("sync start", { force: !!opts?.force });
    const people = await getInvitedPeople();
    const counts = await upsertFromMailchimp(people);
    const at = new Date();
    log.info("sync done", { ...counts, elapsedMs: Date.now() - startedMs });
    return { ...counts, at: at.toISOString(), atMs: at.getTime() };
  })();

  try {
    const r = await inFlight;
    lastResult = r;
    return r;
  } finally {
    inFlight = null;
  }
}

export function lastSyncResult(): SyncResult | null {
  return lastResult;
}
