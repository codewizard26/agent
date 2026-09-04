import type { ParsedProfile, Posture } from "./resume.js";
import type { NormalizedJob } from "./types.js";
export interface FilterOptions {
    now: Date;
    /** null means "any" — no time-frame constraint, undated sources allowed. */
    timeFrameDays: number | null;
    /** Every ledger key for this profile, applied and dismissed alike. */
    ledgerKeys: Set<string>;
}
export interface FilterResult {
    passed: NormalizedJob[];
    rejected: {
        job: NormalizedJob;
        reason: string;
    }[];
}
export declare function filterJobs(jobs: NormalizedJob[], profile: ParsedProfile, posture: Posture, opts: FilterOptions): FilterResult;
