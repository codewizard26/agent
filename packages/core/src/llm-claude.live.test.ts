import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createClaudeCliClient } from "./llm-claude.js";

/**
 * Spawns the real `claude` binary and spends real subscription budget, so it
 * runs under `pnpm test:live`, never in the 6-second unit suite.
 *
 * What it pins is the CLI contract the client is built on: `--json-schema`
 * really constrains the output, and `--output-format json` really wraps the
 * answer in a `result` string. Both are flags that could change under us.
 */
describe("claude CLI client", () => {
  const client = createClaudeCliClient({ timeoutMs: 120_000, maxBudgetUsd: 0.5 });

  it("returns an object matching the schema it was given", async () => {
    const schema = z.object({
      city: z.string(),
      isCapital: z.boolean(),
    });

    const parsed = await client.parse({
      schema,
      schemaName: "city_fact",
      tier: "utility",
      prompt: "The capital of France. Answer with the schema object.",
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.city.toLowerCase()).toContain("paris");
    expect(parsed!.isCapital).toBe(true);
  }, 120_000);

  it("still honours a zod enum through --json-schema", async () => {
    // `rank.ts` scores every job into one of these three, so an enum the CLI
    // silently ignored would put unusable tiers on the board.
    const schema = z.object({ tier: z.enum(["strong", "stretch", "skip"]) });

    const parsed = await client.parse({
      schema,
      schemaName: "tier_only",
      tier: "utility",
      prompt:
        "A candidate with 6 months of experience applying to a Principal Engineer role. Pick the tier.",
    });

    expect(parsed).not.toBeNull();
    expect(["strong", "stretch", "skip"]).toContain(parsed!.tier);
  }, 120_000);

  it("reaches the web and comes back with prose", async () => {
    // This is the capability that was missing entirely without a client, and
    // the only route the pipeline has to LinkedIn and Naukri postings.
    const text = await client.searchWeb({
      prompt: "Search the web for the current stable Node.js LTS major version. One sentence.",
    });

    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/node/i);
  }, 180_000);
});
