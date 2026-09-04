import fs from "node:fs";
import { eq } from "drizzle-orm";
import { createDb, profiles, jobLedger, type FeedRow } from "@job-agent/db";
import {
  buildSources,
  loadBoards,
  ledgerMatchKeys,
  createLlmClient,
  type LlmClient,
  type RankedResult,
  type SourceTask,
  type ParsedProfile,
  type Posture,
} from "@job-agent/core";

import { resolveBoardsPath } from "./boards-path";

export interface FetchPreset {
  timeFrameDays: number | null;
  rankLimit: number | null;
  maxBoards: number | null;
  skipModelSources: boolean;
}

/**
 * What the nightly cron runs. Deliberately bounded: measured 2026-08-29, the deep
 * preset takes 4m21s and the route's ceiling is `maxDuration = 300`, so a cron
 * that turned on Hacker News or web search would be killed mid-run and leave a
 * half-written board every night. Do not re-enable them here — the manual
 * "Fetch latest" button is where a slow, thorough fetch belongs.
 */
export const CRON_PRESET: FetchPreset = {
  timeFrameDays: 7,
  rankLimit: 25,
  maxBoards: null,
  skipModelSources: true,
};

export interface PreparedFetch {
  profile: ParsedProfile;
  posture: Posture;
  ledgerKeys: Set<string>;
  sources: SourceTask[];
  client: LlmClient;
}

export async function prepareFetch(
  db: ReturnType<typeof createDb>,
  profileId: string,
  preset: FetchPreset,
): Promise<PreparedFetch | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  if (!row) return null;

  const ledgerRows = await db
    .select()
    .from(jobLedger)
    .where(eq(jobLedger.profileId, profileId));

  const bskyId = process.env.BLUESKY_IDENTIFIER;
  const bskyPassword = process.env.BLUESKY_APP_PASSWORD;
  // Eight subprocesses rather than the client's laptop-safe default of four.
  // Ranking is ~95% of fetch wall clock and every batch is one `claude` call,
  // so this knob roughly halves a fetch on the Claude path and does nothing at
  // all on the OpenAI one.
  const client = createLlmClient(process.env, { claude: { maxConcurrency: 8 } });
  const profile = row.parsedProfile as ParsedProfile;

  return {
    profile,
    posture: row.posture as Posture,
    ledgerKeys: new Set(
      ledgerRows.flatMap((r) => ledgerMatchKeys({ atsKey: r.atsKey, slugKey: r.slugKey })),
    ),
    client,
    sources: buildSources({
      boards: loadBoards(fs.readFileSync(resolveBoardsPath(), "utf8")),
      profile,
      timeFrameDays: preset.timeFrameDays,
      client,
      maxBoards: preset.maxBoards ?? undefined,
      skipModelSources: preset.skipModelSources,
      bluesky:
        bskyId && bskyPassword
          ? { identifier: bskyId, appPassword: bskyPassword }
          : undefined,
    }),
  };
}

/** Drops `descriptionText` — the board never renders it and it is most of the bytes. */
export function toFeedRows(results: RankedResult[]): FeedRow[] {
  return results.map((job) => ({
    atsKey: job.key.atsKey,
    slugKey: job.key.slugKey,
    company: job.company,
    title: job.title,
    locationRaw: job.locationRaw,
    remote: job.remote,
    applyUrl: job.applyUrl,
    sourceKind: job.sourceKind,
    postedAt: job.postedAt,
    dateFidelity: job.dateFidelity,
    score: job.rank?.score ?? null,
    tier: job.rank?.tier ?? null,
    why: job.rank?.why ?? null,
    redFlags: job.rank?.redFlags ?? [],
    sponsorshipGate: job.rank?.sponsorshipGate ?? false,
    indiaEligible: job.rank?.indiaEligible ?? true,
  }));
}
