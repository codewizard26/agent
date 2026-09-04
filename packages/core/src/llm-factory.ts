import type { LlmClient } from "./llm.js";
import { createOpenAiClient } from "./llm.js";
import { createClaudeCliClient, type ClaudeCliOptions } from "./llm-claude.js";

/**
 * One place that decides which model provider a process talks to, so no call
 * site constructs a provider directly. Adding this is what let the browser UI
 * run with no OPENAI_API_KEY: `new OpenAI()` throws at construction, so every
 * unconditional `createOpenAiClient()` was a hard dependency on a paid key.
 */
export type LlmProvider = "openai" | "claude";

export type LlmEnv = Record<string, string | undefined>;

/**
 * Explicit `LLM_PROVIDER` wins. Otherwise the presence of an OpenAI key
 * decides, which keeps the deployed Vercel cron on OpenAI — a serverless
 * function has no `claude` binary to spawn — while a laptop with no key at all
 * lands on the CLI.
 */
export function resolveLlmProvider(env: LlmEnv = process.env): LlmProvider {
  const requested = env.LLM_PROVIDER?.trim().toLowerCase();
  if (requested) {
    if (requested !== "openai" && requested !== "claude") {
      throw new Error(
        `unknown LLM_PROVIDER "${requested}" — expected "openai" or "claude"`,
      );
    }
    return requested;
  }
  return env.OPENAI_API_KEY ? "openai" : "claude";
}

export interface CreateLlmClientOptions {
  claude?: ClaudeCliOptions;
}

export function createLlmClient(
  env: LlmEnv = process.env,
  opts: CreateLlmClientOptions = {},
): LlmClient {
  const provider = resolveLlmProvider(env);
  if (provider === "claude") return createClaudeCliClient(opts.claude);

  // `new OpenAI()` throws on a missing key from deep inside the first fetch,
  // which reads as a broken feed. Fail here, where the message names the fix.
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      'LLM_PROVIDER=openai but OPENAI_API_KEY is unset — set the key, or use LLM_PROVIDER=claude to rank through the local claude CLI',
    );
  }
  return createOpenAiClient();
}
