import type { AtsKind, JobKey } from "./types.js";
/** Lowercase, strip punctuation, collapse whitespace. */
export declare function slugify(s: string): string;
/**
 * Normalizes a job title so the same role from different sources produces one key.
 * Order matters: strip bracketed and trailing fragments before slugifying, because
 * slugify would otherwise destroy the delimiters we key on.
 */
export declare function normalizeTitle(title: string): string;
export declare function buildJobKey(input: {
    company: string;
    title: string;
    atsKind: AtsKind | null;
    atsRef: string | null;
}): JobKey;
/** Every key a ledger row for this job could match on. */
export declare function ledgerMatchKeys(key: JobKey): string[];
