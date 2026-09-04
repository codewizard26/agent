import OpenAI from "openai";
import type { z } from "zod";
/**
 * Which model a call wants, not which model it gets. Call sites say "this is a
 * cheap extraction" or "this is the judgement call"; `models.ts` decides what
 * that means, so swapping models is one file.
 */
export type LlmTier = "rank" | "utility";
export interface LlmParseOptions<T> {
    schema: z.ZodType<T>;
    /** Names the JSON schema for the provider. Lowercase, no spaces. */
    schemaName: string;
    system?: string;
    prompt: string;
    tier: LlmTier;
    effort?: "low" | "medium" | "high";
    maxOutputTokens?: number;
}
export interface LlmSearchOptions {
    prompt: string;
    maxSearches?: number;
}
/**
 * The only model surface the rest of the codebase sees. Everything model-shaped
 * goes through `parse` — no hand-parsed JSON out of a text response — which is
 * also what keeps `collectCandidates` free of any model dependency at all.
 */
export interface LlmClient {
    /** Structured output. Null when the model returned no parseable object. */
    parse<T>(opts: LlmParseOptions<T>): Promise<T | null>;
    /** Grounded generation with web search. Returns the model's prose. */
    searchWeb(opts: LlmSearchOptions): Promise<string>;
}
export declare function createOpenAiClient(client?: OpenAI): LlmClient;
