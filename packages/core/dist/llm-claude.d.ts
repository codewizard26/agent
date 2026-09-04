import { type z } from "zod";
import type { LlmClient, LlmTier } from "./llm.js";
/**
 * The same `LlmClient` the rest of the codebase already talks to, backed by the
 * locally installed `claude` binary instead of a paid API key.
 *
 * Why a subprocess and not the Anthropic SDK: the CLI authenticates with the
 * user's own Claude Code session, so this runs on a subscription with no
 * ANTHROPIC_API_KEY and no OPENAI_API_KEY anywhere. That is the whole point —
 * it is also why it only works where the binary exists, which means locally,
 * never on Vercel.
 *
 * Structured output is the CLI's `--json-schema`, not a prompt convention:
 * measured 2026-09-03 against `rank.ts`'s own BatchSchema, it returned a
 * conforming object first try.
 */
export type ClaudeCliMode = "parse" | "search";
export interface ClaudeArgsOptions {
    mode: ClaudeCliMode;
    tier: LlmTier;
    /** JSON Schema for `--json-schema`. Required for "parse", ignored for "search". */
    jsonSchema?: unknown;
    effort?: "low" | "medium" | "high";
    /** Fails the invocation rather than letting one runaway batch spend freely. */
    maxBudgetUsd?: number;
}
/**
 * The argv for one `claude` invocation. Split out from the spawn so the flag
 * set — which is most of what makes this cheap and non-interactive — is
 * testable without paying for a subprocess.
 *
 * The prompt is NOT here: it goes in on stdin, because a 20-job ranking batch
 * carries 20 job descriptions and belongs nowhere near an argv limit.
 */
export declare function buildClaudeArgs(opts: ClaudeArgsOptions): string[];
/**
 * Reads one `--output-format json` envelope.
 *
 * Three outcomes, deliberately different:
 *   - throws  — the CLI itself failed (budget, auth, no binary). A systematic
 *               failure must surface, not read as "nothing ranked".
 *   - null    — the model answered but not with a conforming object. One job
 *               renders unranked; the fetch is fine.
 *   - value   — parsed and schema-checked.
 *
 * Pass `null` for the schema to take the model's prose verbatim, which is what
 * `searchWeb` wants.
 */
export declare function parseCliResult<T>(stdout: string, schema: z.ZodType<T> | null): T | string | null;
export interface ClaudeCliOptions {
    /** Overrides the binary, for a non-standard install. */
    binary?: string;
    /** Per-invocation ceiling. A hung subprocess must not hold a route open. */
    timeoutMs?: number;
    /** Per-invocation spend cap handed to `--max-budget-usd`. */
    maxBudgetUsd?: number;
    /** Working directory for the subprocess. Defaults to the OS temp dir. */
    cwd?: string;
    /** Subprocesses allowed in flight at once. */
    maxConcurrency?: number;
}
/**
 * Admits at most `limit` tasks at a time, queueing the rest in arrival order.
 * A rejected task frees its slot exactly like a resolved one.
 */
export declare function createGate(limit: number): <T>(fn: () => Promise<T>) => Promise<T>;
/**
 * An `LlmClient` over the local `claude` binary. Drop-in for
 * `createOpenAiClient` — every call site takes the interface, not the provider.
 */
export declare function createClaudeCliClient(opts?: ClaudeCliOptions): LlmClient;
/**
 * Zod 4 emits a fully inlined schema for every shape this codebase uses —
 * verified 2026-09-03 against `rank.ts`'s BatchSchema, which came out with no
 * `$ref` or `$defs` at all, which is what `--json-schema` needs.
 * `io: "output"` is the side the model must produce.
 *
 * The `$schema` dialect header has to go: the CLI validates the schema against
 * its own registry and fails the whole invocation with "no schema with key or
 * ref https://json-schema.org/draft/2020-12/schema" when it is present.
 */
export declare function toJsonSchema(schema: z.ZodType<unknown>): unknown;
