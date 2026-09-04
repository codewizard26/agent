import { describe, it, expect } from "vitest";
import { resolveLlmProvider, createLlmClient } from "./llm-factory.js";

describe("resolveLlmProvider", () => {
  it("honours an explicit LLM_PROVIDER", () => {
    expect(resolveLlmProvider({ LLM_PROVIDER: "claude", OPENAI_API_KEY: "sk-x" })).toBe(
      "claude",
    );
    expect(resolveLlmProvider({ LLM_PROVIDER: "openai" })).toBe("openai");
  });

  it("uses OpenAI when a key is present and nothing was asked for", () => {
    // Vercel keeps LLM_PROVIDER unset, which is what keeps the deployed cron on
    // OpenAI — there is no `claude` binary in a serverless function.
    expect(resolveLlmProvider({ OPENAI_API_KEY: "sk-x" })).toBe("openai");
  });

  it("falls back to the Claude CLI when there is no key at all", () => {
    expect(resolveLlmProvider({})).toBe("claude");
  });

  it("rejects a provider name it does not know", () => {
    expect(() => resolveLlmProvider({ LLM_PROVIDER: "gemini" })).toThrow(/gemini/);
  });
});

describe("createLlmClient", () => {
  it("builds a client exposing the LlmClient surface", () => {
    const client = createLlmClient({ LLM_PROVIDER: "claude" });
    expect(typeof client.parse).toBe("function");
    expect(typeof client.searchWeb).toBe("function");
  });

  it("refuses OpenAI without a key instead of throwing deep inside a fetch", () => {
    expect(() => createLlmClient({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
  });
});
