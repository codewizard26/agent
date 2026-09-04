import { dedupeJobs, mapWithConcurrency } from "./adapters/index.js";
import type { LlmClient } from "./llm.js";
import { filterJobs } from "./filter.js";
import { isIndiaLocated, sortByIndiaPriority } from "./india.js";
import { rankJobs, type RankedJob } from "./rank.js";
import type { ParsedProfile, Posture } from "./resume.js";
import type { NormalizedJob, SourceKind } from "./types.js";

export interface SourceTask {
  kind: SourceKind;
  run: () => Promise<NormalizedJob[]>;
  /**
   * Overrides the default ceiling. Model-backed sources make one call per item
   * and legitimately run for minutes; a budget sized for an HTTP board kills
   * them every time.
   */
  timeoutMs?: number;
}

export interface RankedResult extends NormalizedJob {
  rank: RankedJob | null;
}

export type ProgressEvent =
  | { type: "fetching"; sources: number }
  | { type: "fetched"; total: number; deduped: number; failed: SourceKind[] }
  | { type: "filtered"; kept: number; rejected: number }
  | { type: "ranking"; jobs: number }
  | { type: "done"; results: RankedResult[]; failed: SourceKind[] }
  | { type: "error"; message: string };

export interface FetchOptions {
  profile: ParsedProfile;
  posture: Posture;
  sources: SourceTask[];
  ledgerKeys: Set<string>;
  /** null means "any" — no window, undated sources allowed. */
  timeFrameDays: number | null;
  client: LlmClient;
  now?: Date;
  concurrency?: number;
  sourceTimeoutMs?: number;
  /**
   * Rank only this many jobs. Ranking is the slowest and only per-job-priced
   * stage, so this is the main speed and cost lever. The jobs beyond the cap are
   * still returned — unranked, sorted below the ranked ones — never dropped.
   */
  rankLimit?: number;
}

export interface CandidateSet {
  /** Jobs that survived dedup and the profile filter. Unranked. */
  jobs: NormalizedJob[];
  rejected: { job: NormalizedJob; reason: string }[];
  failed: SourceKind[];
  stats: { fetched: number; deduped: number; kept: number };
  /** True when no source returned anything — an error, not an empty feed. */
  allSourcesFailed: boolean;
}

export interface CollectOptions {
  profile: ParsedProfile;
  posture: Posture;
  sources: SourceTask[];
  ledgerKeys: Set<string>;
  timeFrameDays: number | null;
  now?: Date;
  concurrency?: number;
  /** Per-source ceiling. A source past it is reported failed, not waited on. */
  sourceTimeoutMs?: number;
}

/** One slow board must not set the pace for the other fifty-seven. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;

/**
 * Bounds a source's wall-clock cost. The underlying request is not cancelled —
 * adapters take no AbortSignal — so this trades a briefly-orphaned fetch for a
 * predictable fetch time. Measured 2026-08-29: one Lever aggregator board
 * (4,203 postings) took 42.7s while every other source finished inside 13s.
 */
function withTimeout<T>(run: () => Promise<T>, ms: number, kind: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${kind}: timed out after ${ms}ms`)), ms);
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Everything up to ranking: fan out, dedupe, filter. Deliberately takes NO
 * model client — this half of the pipeline is pure code, which is what lets it
 * run with no API key at all and hand its output to Claude Code for ranking.
 */
export async function collectCandidates(
  opts: CollectOptions,
): Promise<CandidateSet> {
  const now = opts.now ?? new Date();
  const concurrency = opts.concurrency ?? 32;
  const timeoutMs = opts.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;

  const settled = await mapWithConcurrency(opts.sources, concurrency, (s) =>
    withTimeout(() => s.run(), s.timeoutMs ?? timeoutMs, s.kind),
  );

  const collected: NormalizedJob[] = [];
  const failed: SourceKind[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") collected.push(...result.value);
    else failed.push(opts.sources[i]!.kind);
  });

  const allSourcesFailed =
    opts.sources.length > 0 && failed.length === opts.sources.length;

  const deduped = dedupeJobs(collected);
  const { passed, rejected } = filterJobs(deduped, opts.profile, opts.posture, {
    now,
    timeFrameDays: opts.timeFrameDays,
    ledgerKeys: opts.ledgerKeys,
  });

  return {
    jobs: passed,
    rejected,
    failed,
    stats: {
      fetched: collected.length,
      deduped: deduped.length,
      kept: passed.length,
    },
    allSourcesFailed,
  };
}

/**
 * Fans out to every source, dedupes, filters against the profile, ranks the
 * survivors, and yields progress as it goes. Writes nothing.
 */
export async function* runFetch(
  opts: FetchOptions,
): AsyncGenerator<ProgressEvent> {
  yield { type: "fetching", sources: opts.sources.length };

  const candidates = await collectCandidates(opts);

  if (candidates.allSourcesFailed) {
    yield {
      type: "error",
      message: `every source failed (${candidates.failed.join(", ")})`,
    };
    return;
  }

  yield {
    type: "fetched",
    total: candidates.stats.fetched,
    deduped: candidates.stats.deduped,
    failed: candidates.failed,
  };

  const { jobs: passed, rejected, failed } = candidates;
  yield { type: "filtered", kept: passed.length, rejected: rejected.length };

  // The cap has to choose which jobs get ranked before anything is scored, so it
  // uses the one ordering available without a model: India priority.
  const ordered = opts.posture.indiaPriority ? sortByIndiaPriority(passed) : passed;
  const toRank =
    opts.rankLimit != null ? ordered.slice(0, opts.rankLimit) : ordered;

  yield { type: "ranking", jobs: toRank.length };
  const rankings = await rankJobs(toRank, opts.profile, opts.client);

  // India priority is ORDERING, not filtering: India-eligible roles rise to the
  // top, but nothing is dropped for lacking an India signal.
  const indiaRank = (job: RankedResult): number => {
    if (!opts.posture.indiaPriority) return 0;
    if (isIndiaLocated(job)) return 2;
    return job.rank?.indiaEligible === false ? 0 : 1;
  };

  const results: RankedResult[] = ordered
    .map((job) => ({ ...job, rank: rankings.get(job.key.slugKey) ?? null }))
    .sort(
      (a, b) =>
        indiaRank(b) - indiaRank(a) ||
        (b.rank?.score ?? -1) - (a.rank?.score ?? -1),
    );

  yield { type: "done", results, failed };
}
