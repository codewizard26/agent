import type { LlmClient } from "./llm.js";
import { type ClaudeCliOptions } from "./llm-claude.js";
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
export declare function resolveLlmProvider(env?: LlmEnv): LlmProvider;
export interface CreateLlmClientOptions {
    claude?: ClaudeCliOptions;
}
export declare function createLlmClient(env?: LlmEnv, opts?: CreateLlmClientOptions): LlmClient;
