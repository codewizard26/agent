import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { createDb } from "./client.js";
import { feedJobs } from "./schema.js";

type Db = ReturnType<typeof createDb>;

export interface FeedRow {
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  locationRaw: string;
  remote: boolean;
  applyUrl: string;
  sourceKind: string;
  postedAt: Date | null;
  dateFidelity: string;
  score: number | null;
  tier: string | null;
  why: string | null;
  redFlags: string[];
  sponsorshipGate: boolean;
  indiaEligible: boolean;
}

/** Rows this stale are dropped, so a board left alone does not grow forever. */
const STALE_DAYS = 14;

/**
 * Writes a fetch's results to the board. Upserts rather than replacing, so
 * `firstSeenAt` survives and a job the user has been looking at for two days
 * does not read as new after every refresh.
 */
export async function saveFeed(
  db: Db,
  profileId: string,
  rows: FeedRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date();

  // A job's slug can normalize differently between fetches while its ATS
  // identity stays put. Clearing by atsKey first is what stops the board
  // showing the same posting twice — the same dual-key rule the ledger uses.
  const atsKeys = rows.map((r) => r.atsKey).filter((k): k is string => k !== null);
  if (atsKeys.length > 0) {
    await db
      .delete(feedJobs)
      .where(and(eq(feedJobs.profileId, profileId), inArray(feedJobs.atsKey, atsKeys)));
  }

  await db
    .insert(feedJobs)
    .values(rows.map((r) => ({ ...r, profileId, firstSeenAt: now, lastSeenAt: now })))
    .onConflictDoUpdate({
      target: [feedJobs.profileId, feedJobs.slugKey],
      set: {
        score: sql`excluded.score`,
        tier: sql`excluded.tier`,
        why: sql`excluded.why`,
        redFlags: sql`excluded.red_flags`,
        sponsorshipGate: sql`excluded.sponsorship_gate`,
        indiaEligible: sql`excluded.india_eligible`,
        postedAt: sql`excluded.posted_at`,
        applyUrl: sql`excluded.apply_url`,
        lastSeenAt: now,
      },
    });

  const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);
  await db
    .delete(feedJobs)
    .where(and(eq(feedJobs.profileId, profileId), lt(feedJobs.lastSeenAt, cutoff)));
}

/** The board, best first. Ranked jobs sort above unranked ones. */
export async function listFeed(db: Db, profileId: string) {
  return db
    .select()
    .from(feedJobs)
    .where(eq(feedJobs.profileId, profileId))
    .orderBy(
      sql`${feedJobs.indiaEligible} DESC`,
      sql`${feedJobs.score} DESC NULLS LAST`,
    );
}

/**
 * Removes a job from the board. Applying or dismissing writes a ledger row, but
 * that only keeps the job out of the NEXT fetch — without this the board keeps
 * showing something the user already handled until the cron next runs.
 */
export async function removeFromFeed(
  db: Db,
  profileId: string,
  keys: { atsKey: string | null; slugKey: string },
): Promise<void> {
  await db
    .delete(feedJobs)
    .where(
      and(
        eq(feedJobs.profileId, profileId),
        keys.atsKey
          ? or(eq(feedJobs.atsKey, keys.atsKey), eq(feedJobs.slugKey, keys.slugKey))
          : eq(feedJobs.slugKey, keys.slugKey),
      ),
    );
}
