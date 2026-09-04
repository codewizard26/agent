import type { LlmClient } from "./llm.js";
import { type RankedJob } from "./rank.js";
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
export type ProgressEvent = {
    type: "fetching";
    sources: number;
} | {
    type: "fetched";
    total: number;
    deduped: number;
    failed: SourceKind[];
} | {
    type: "filtered";
    kept: number;
    rejected: number;
} | {
    type: "ranking";
    jobs: number;
} | {
    type: "done";
    results: RankedResult[];
    failed: SourceKind[];
} | {
    type: "error";
    message: string;
};
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
    rejected: {
        job: NormalizedJob;
        reason: string;
    }[];
    failed: SourceKind[];
    stats: {
        fetched: number;
        deduped: number;
        kept: number;
    };
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
export declare const DEFAULT_SOURCE_TIMEOUT_MS = 15000;
/**
 * Everything up to ranking: fan out, dedupe, filter. Deliberately takes NO
 * model client — this half of the pipeline is pure code, which is what lets it
 * run with no API key at all and hand its output to Claude Code for ranking.
 */
export declare function collectCandidates(opts: CollectOptions): Promise<CandidateSet>;
/**
 * Fans out to every source, dedupes, filters against the profile, ranks the
 * survivors, and yields progress as it goes. Writes nothing.
 */
export declare function runFetch(opts: FetchOptions): AsyncGenerator<ProgressEvent>;
