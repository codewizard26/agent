import { dedupeJobs, mapWithConcurrency } from "./adapters/index.js";
import { filterJobs } from "./filter.js";
import { isIndiaLocated, sortByIndiaPriority } from "./india.js";
import { rankJobs } from "./rank.js";
/** One slow board must not set the pace for the other fifty-seven. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;
/**
 * Bounds a source's wall-clock cost. The underlying request is not cancelled —
 * adapters take no AbortSignal — so this trades a briefly-orphaned fetch for a
 * predictable fetch time. Measured 2026-08-29: one Lever aggregator board
 * (4,203 postings) took 42.7s while every other source finished inside 13s.
 */
function withTimeout(run, ms, kind) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${kind}: timed out after ${ms}ms`)), ms);
        run().then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
}
/**
 * Everything up to ranking: fan out, dedupe, filter. Deliberately takes NO
 * model client — this half of the pipeline is pure code, which is what lets it
 * run with no API key at all and hand its output to Claude Code for ranking.
 */
export async function collectCandidates(opts) {
    const now = opts.now ?? new Date();
    const concurrency = opts.concurrency ?? 32;
    const timeoutMs = opts.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
    const settled = await mapWithConcurrency(opts.sources, concurrency, (s) => withTimeout(() => s.run(), s.timeoutMs ?? timeoutMs, s.kind));
    const collected = [];
    const failed = [];
    settled.forEach((result, i) => {
        if (result.status === "fulfilled")
            collected.push(...result.value);
        else
            failed.push(opts.sources[i].kind);
    });
    const allSourcesFailed = opts.sources.length > 0 && failed.length === opts.sources.length;
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
export async function* runFetch(opts) {
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
    const toRank = opts.rankLimit != null ? ordered.slice(0, opts.rankLimit) : ordered;
    yield { type: "ranking", jobs: toRank.length };
    const rankings = await rankJobs(toRank, opts.profile, opts.client);
    // India priority is ORDERING, not filtering: India-eligible roles rise to the
    // top, but nothing is dropped for lacking an India signal.
    const indiaRank = (job) => {
        if (!opts.posture.indiaPriority)
            return 0;
        if (isIndiaLocated(job))
            return 2;
        return job.rank?.indiaEligible === false ? 0 : 1;
    };
    const results = ordered
        .map((job) => ({ ...job, rank: rankings.get(job.key.slugKey) ?? null }))
        .sort((a, b) => indiaRank(b) - indiaRank(a) ||
        (b.rank?.score ?? -1) - (a.rank?.score ?? -1));
    yield { type: "done", results, failed };
}
