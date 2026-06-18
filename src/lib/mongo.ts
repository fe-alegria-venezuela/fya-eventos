import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "./env";
import { logger } from "./log";
import type { InviteeDoc } from "./invitees";

const log = logger("mongo");

// Reuse a single MongoClient across warm serverless invocations (and across HMR
// reloads in dev). Creating a new client per request exhausts the connection pool.
// The client connects lazily; we cache the connecting promise so concurrent first
// calls share one handshake.
const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>;
};

function clientPromise(): Promise<MongoClient> {
  if (!globalForMongo._mongoClientPromise) {
    const client = new MongoClient(env.MONGODB_URI(), {
      // Keep the pool small — 200 invitees, low concurrency, serverless.
      maxPoolSize: 5,
      retryWrites: true,
    });
    globalForMongo._mongoClientPromise = client.connect().then((c) => {
      log.info("connected", { db: env.MONGODB_DB() });
      return c;
    });
  }
  return globalForMongo._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise();
  return client.db(env.MONGODB_DB());
}

// Indexes are created once per process. Cheap and idempotent — Mongo no-ops if the
// index already exists.
let indexesEnsured = false;

export async function inviteesCollection(): Promise<Collection<InviteeDoc>> {
  const db = await getDb();
  const col = db.collection<InviteeDoc>("invitees");
  if (!indexesEnsured) {
    indexesEnsured = true;
    await col.createIndex({ email: 1 }, { unique: true }).catch((err) => {
      indexesEnsured = false;
      log.warn("createIndex failed", { error: err instanceof Error ? err.message : String(err) });
    });
  }
  return col;
}
