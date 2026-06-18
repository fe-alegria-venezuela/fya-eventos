import type { AnyBulkWriteOperation } from "mongodb";
import { inviteesCollection } from "./mongo";
import { getPerson } from "./mailchimp";
import type { Person } from "./dashboard";
import { logger } from "./log";

const log = logger("invitees");

// One document per invitee. `email` (lowercased) is the natural key.
// MongoDB is the source of truth; Mailchimp only seeds/refreshes this on sync.
export interface InviteeDoc {
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  mailchimpId?: string;
  tags?: string[];
  hasConfirmed: boolean;
  hasDeclined: boolean;
  hasCheckedIn: boolean;
  source: "mailchimp" | "manual";
  confirmedAt?: Date;
  declinedAt?: Date;
  checkedInAt?: Date;
  // Last time the APP changed confirmed/declined. Used by the sync to decide
  // whether a Mailchimp change is newer than what the app already knows.
  statusUpdatedAt?: Date;
  // Mailchimp's last_changed as seen on the last sync (audit/debug).
  mailchimpLastChanged?: string;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncCounts {
  added: number;
  updated: number;
  total: number;
}

function toPerson(d: InviteeDoc): Person {
  const changed = d.checkedInAt ?? d.statusUpdatedAt ?? d.updatedAt;
  return {
    id: d.mailchimpId ?? d.email,
    email: d.email,
    name: d.name,
    firstName: d.firstName,
    lastName: d.lastName,
    tags: d.tags ?? [],
    hasConfirmed: d.hasConfirmed,
    hasDeclined: d.hasDeclined,
    hasCheckedIn: d.hasCheckedIn,
    lastChanged: changed instanceof Date ? changed.toISOString() : undefined,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function findAll(): Promise<Person[]> {
  const col = await inviteesCollection();
  const docs = await col.find({}).toArray();
  return docs.map(toPerson);
}

export async function findByEmail(email: string): Promise<Person | null> {
  const col = await inviteesCollection();
  const doc = await col.findOne({ email });
  return doc ? toPerson(doc) : null;
}

// Mongo-first lookup with a one-time Mailchimp fallback: if the invitee isn't in
// the DB yet (e.g. an RSVP/scan arrives before the first sync), pull them from
// Mailchimp ONCE and persist, so every future read is Mongo-only.
export async function getOrImportInvitee(email: string): Promise<Person | null> {
  const existing = await findByEmail(email);
  if (existing) return existing;

  log.info("invitee not in DB — importing from Mailchimp once", { email });
  const mc = await getPerson(email);
  if (!mc) return null;
  await upsertFromMailchimp([mc]);
  return findByEmail(email);
}

// ── Status writes (app is authoritative) ─────────────────────────────────────

async function applyStatus(
  email: string,
  set: Partial<InviteeDoc>,
  unset?: Partial<Record<keyof InviteeDoc, "">>,
): Promise<Person | null> {
  const col = await inviteesCollection();
  const update: Record<string, unknown> = { $set: { ...set, updatedAt: new Date() } };
  if (unset) update.$unset = unset;
  const doc = await col.findOneAndUpdate({ email }, update, { returnDocument: "after" });
  return doc ? toPerson(doc) : null;
}

export async function setConfirmed(email: string): Promise<Person | null> {
  const now = new Date();
  return applyStatus(email, {
    hasConfirmed: true,
    hasDeclined: false,
    confirmedAt: now,
    statusUpdatedAt: now,
  });
}

export async function setDeclined(email: string): Promise<Person | null> {
  const now = new Date();
  return applyStatus(email, {
    hasDeclined: true,
    hasConfirmed: false,
    declinedAt: now,
    statusUpdatedAt: now,
  });
}

export async function setCheckin(email: string): Promise<Person | null> {
  return applyStatus(email, { hasCheckedIn: true, checkedInAt: new Date() });
}

export async function undoCheckin(email: string): Promise<Person | null> {
  return applyStatus(email, { hasCheckedIn: false }, { checkedInAt: "" });
}

// ── Sync: Mailchimp → Mongo upsert with a conservative merge ──────────────────
//
// Merge policy (per invitee):
//   • New invitee        → inserted, status seeded from Mailchimp.
//   • Existing invitee   → contact info always refreshed.
//       - hasCheckedIn   → monotonic; sync never reverts it (app is authoritative).
//       - confirmed/decl → adopt Mailchimp's value ONLY if Mailchimp's last_changed
//                          is newer than the app's statusUpdatedAt, so RSVP changes
//                          made in the app are never clobbered by a stale Mailchimp.
export async function upsertFromMailchimp(people: Person[]): Promise<SyncCounts> {
  if (people.length === 0) return { added: 0, updated: 0, total: 0 };

  const col = await inviteesCollection();
  const emails = people.map((p) => p.email);
  const existing = await col.find({ email: { $in: emails } }).toArray();
  const byEmail = new Map(existing.map((d) => [d.email, d]));
  const now = new Date();

  const ops: AnyBulkWriteOperation<InviteeDoc>[] = people.map((p) => {
    const prev = byEmail.get(p.email);

    const set: Partial<InviteeDoc> = {
      firstName: p.firstName,
      lastName: p.lastName,
      name: p.name,
      mailchimpId: p.id,
      tags: p.tags,
      lastSyncedAt: now,
      updatedAt: now,
    };
    if (p.lastChanged) set.mailchimpLastChanged = p.lastChanged;

    if (!prev) {
      // Brand-new invitee — seed status from Mailchimp.
      const statusAt = p.lastChanged ? new Date(p.lastChanged) : now;
      set.hasConfirmed = p.hasConfirmed;
      set.hasDeclined = p.hasDeclined;
      set.hasCheckedIn = p.hasCheckedIn;
      set.statusUpdatedAt = statusAt;
      if (p.hasConfirmed) set.confirmedAt = statusAt;
      if (p.hasDeclined) set.declinedAt = statusAt;
      if (p.hasCheckedIn) set.checkedInAt = statusAt;
    } else {
      // Monotonic check-in: only ever flips false → true on sync.
      if (p.hasCheckedIn && !prev.hasCheckedIn) {
        set.hasCheckedIn = true;
        set.checkedInAt = p.lastChanged ? new Date(p.lastChanged) : now;
      }
      // RSVP: newer-wins between Mailchimp and the app.
      const mcChanged = p.lastChanged ? new Date(p.lastChanged).getTime() : 0;
      const appChanged = prev.statusUpdatedAt ? prev.statusUpdatedAt.getTime() : 0;
      const rsvpDiffers = p.hasConfirmed !== prev.hasConfirmed || p.hasDeclined !== prev.hasDeclined;
      if (mcChanged > appChanged && rsvpDiffers) {
        const at = new Date(mcChanged);
        set.hasConfirmed = p.hasConfirmed;
        set.hasDeclined = p.hasDeclined;
        set.statusUpdatedAt = at;
        if (p.hasConfirmed) set.confirmedAt = at;
        if (p.hasDeclined) set.declinedAt = at;
      }
    }

    return {
      updateOne: {
        filter: { email: p.email },
        update: { $set: set, $setOnInsert: { createdAt: now, source: "mailchimp" } },
        upsert: true,
      },
    };
  });

  const res = await col.bulkWrite(ops, { ordered: false });
  const counts: SyncCounts = {
    added: res.upsertedCount,
    updated: res.modifiedCount,
    total: people.length,
  };
  log.info("upsertFromMailchimp done", counts);
  return counts;
}
