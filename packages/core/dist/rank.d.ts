import { z } from "zod";
import type { LlmClient } from "./llm.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";
declare const RankedJobSchema: z.ZodObject<{
    jobKey: z.ZodString;
    score: z.ZodNumber;
    tier: z.ZodEnum<{
        strong: "strong";
        stretch: "stretch";
        skip: "skip";
    }>;
    why: z.ZodString;
    redFlags: z.ZodArray<z.ZodString>;
    sponsorshipGate: z.ZodBoolean;
    indiaEligible: z.ZodBoolean;
    timezoneGate: z.ZodNullable<z.ZodString>;
    resumeHooks: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type RankedJob = z.infer<typeof RankedJobSchema>;
/**
 * Exported so the candidates CLI can write the exact same text `rankJobs`
 * would send. If ranking happens in a Claude Code conversation instead of
 * through the API, both paths see identical input and cannot drift.
 */
export declare function profileBrief(profile: ParsedProfile): string;
export declare function jobBrief(job: NormalizedJob, descriptionChars?: number): string;
/**
 * Scores jobs against a profile. Batches are independent: a failed batch loses
 * only its own jobs, and those simply render unranked rather than disappearing.
 * Returns a map keyed by slugKey.
 */
export declare function rankJobs(jobs: NormalizedJob[], profile: ParsedProfile, client: LlmClient, batchSize?: number, 
/**
 * Measured 2026-08-29 on the same 10 jobs: low 35s, medium 66s, high 113s,
 * with low and medium agreeing within ~2 points per job. Ranking is ~95% of
 * fetch wall clock, so this single word outweighs every source-count knob.
 */
effort?: "low" | "medium" | "high"): Promise<Map<string, RankedJob>>;
export {};
