/**
 * Model ids, in one place so a cost or capability change is a one-file edit.
 * Two providers, one tier vocabulary — `llm.ts` reaches OpenAI's Responses API,
 * `llm-claude.ts` reaches the local `claude` CLI. `createLlmClient` picks.
 */

/** The judgement call: ranking a posting against a profile. */
export const RANK_MODEL = "gpt-5";

/** Cheap structured extraction: resumes, HN comments, Bluesky posts, form fields. */
export const UTILITY_MODEL = "gpt-5-mini";

/**
 * The same two tiers on the Claude CLI. Sonnet ranks; measured 2026-09-03, a
 * two-job batch cost $0.024 at effort low. Opus is a one-word change here if
 * ranking quality ever matters more than the bill.
 */
export const CLAUDE_RANK_MODEL = "claude-sonnet-5";

/** Haiku for the per-item extractions — HN comments and Bluesky posts run hundreds deep. */
export const CLAUDE_UTILITY_MODEL = "claude-haiku-4-5-20251001";
