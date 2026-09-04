import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { RANK_MODEL, UTILITY_MODEL } from "./models.js";

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

function modelFor(tier: LlmTier): string {
  return tier === "rank" ? RANK_MODEL : UTILITY_MODEL;
}

/**
 * The Responses API counts reasoning tokens against `max_output_tokens`, and a
 * response that runs out comes back `incomplete` with `output_parsed` null —
 * indistinguishable from a refusal unless you check. Every truncation throws
 * here so a systematically undersized budget surfaces as an error instead of a
 * feed where nothing is ranked.
 */
function assertComplete(response: {
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
}): void {
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown";
    throw new Error(`model response incomplete: ${reason}`);
  }
}

export function createOpenAiClient(client: OpenAI = new OpenAI()): LlmClient {
  return {
    async parse<T>(opts: LlmParseOptions<T>): Promise<T | null> {
      const response = await client.responses.parse({
        model: modelFor(opts.tier),
        reasoning: { effort: opts.effort ?? "low" },
        max_output_tokens: opts.maxOutputTokens ?? 16000,
        input: [
          ...(opts.system
            ? [{ role: "system" as const, content: opts.system }]
            : []),
          { role: "user" as const, content: opts.prompt },
        ],
        text: { format: zodTextFormat(opts.schema, opts.schemaName) },
      });
      assertComplete(response);
      return (response.output_parsed as T | null) ?? null;
    },

    async searchWeb(opts: LlmSearchOptions): Promise<string> {
      const response = await client.responses.create({
        model: modelFor("rank"),
        reasoning: { effort: "low" },
        max_output_tokens: 16000,
        tools: [{ type: "web_search" }],
        input: opts.prompt,
      });
      // A search that hits the token ceiling still returns whatever it found,
      // and partial findings beat none — this one does not throw.
      return response.output_text ?? "";
    },
  };
}
