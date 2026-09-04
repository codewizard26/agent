import { createOpenAiClient } from "./llm.js";
import { createClaudeCliClient } from "./llm-claude.js";
/**
 * Explicit `LLM_PROVIDER` wins. Otherwise the presence of an OpenAI key
 * decides, which keeps the deployed Vercel cron on OpenAI — a serverless
 * function has no `claude` binary to spawn — while a laptop with no key at all
 * lands on the CLI.
 */
export function resolveLlmProvider(env = process.env) {
    const requested = env.LLM_PROVIDER?.trim().toLowerCase();
    if (requested) {
        if (requested !== "openai" && requested !== "claude") {
            throw new Error(`unknown LLM_PROVIDER "${requested}" — expected "openai" or "claude"`);
        }
        return requested;
    }
    return env.OPENAI_API_KEY ? "openai" : "claude";
}
export function createLlmClient(env = process.env, opts = {}) {
    const provider = resolveLlmProvider(env);
    if (provider === "claude")
        return createClaudeCliClient(opts.claude);
    // `new OpenAI()` throws on a missing key from deep inside the first fetch,
    // which reads as a broken feed. Fail here, where the message names the fix.
    if (!env.OPENAI_API_KEY) {
        throw new Error('LLM_PROVIDER=openai but OPENAI_API_KEY is unset — set the key, or use LLM_PROVIDER=claude to rank through the local claude CLI');
    }
    return createOpenAiClient();
}
