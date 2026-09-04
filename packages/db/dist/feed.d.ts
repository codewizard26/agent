import type { createDb } from "./client.js";
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
/**
 * Writes a fetch's results to the board. Upserts rather than replacing, so
 * `firstSeenAt` survives and a job the user has been looking at for two days
 * does not read as new after every refresh.
 */
export declare function saveFeed(db: Db, profileId: string, rows: FeedRow[]): Promise<void>;
/** The board, best first. Ranked jobs sort above unranked ones. */
export declare function listFeed(db: Db, profileId: string): Promise<{
    id: string;
    profileId: string;
    atsKey: string | null;
    slugKey: string;
    company: string;
    title: string;
    applyUrl: string;
    locationRaw: string;
    remote: boolean;
    sourceKind: string;
    postedAt: Date | null;
    dateFidelity: string;
    score: number | null;
    tier: string | null;
    why: string | null;
    redFlags: unknown;
    sponsorshipGate: boolean;
    indiaEligible: boolean;
    firstSeenAt: Date;
    lastSeenAt: Date;
}[]>;
/**
 * Removes a job from the board. Applying or dismissing writes a ledger row, but
 * that only keeps the job out of the NEXT fetch — without this the board keeps
 * showing something the user already handled until the cron next runs.
 */
export declare function removeFromFeed(db: Db, profileId: string, keys: {
    atsKey: string | null;
    slugKey: string;
}): Promise<void>;
export {};
