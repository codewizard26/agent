import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildClaudeArgs,
  parseCliResult,
  createGate,
  toJsonSchema,
  createClaudeCliClient,
} from "./llm-claude.js";
import { CLAUDE_RANK_MODEL, CLAUDE_UTILITY_MODEL } from "./models.js";

/** Reads the value that follows a flag, which is how execFile argv is shaped. */
function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe("buildClaudeArgs", () => {
  it("disables every tool for a structured parse", () => {
    const args = buildClaudeArgs({ mode: "parse", tier: "utility", jsonSchema: {} });
    // An empty --tools is what took the probe from 26,725 input tokens to 1,007:
    // the tool definitions are most of the default system prompt.
    expect(valueOf(args, "--tools")).toBe("");
  });

  it("passes the JSON schema through as serialized JSON", () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const args = buildClaudeArgs({ mode: "parse", tier: "rank", jsonSchema: schema });
    expect(JSON.parse(valueOf(args, "--json-schema")!)).toEqual(schema);
  });

  it("gives web search the one tool it needs and no schema", () => {
    const args = buildClaudeArgs({ mode: "search", tier: "rank" });
    expect(valueOf(args, "--tools")).toBe("WebSearch");
    expect(valueOf(args, "--allowed-tools")).toBe("WebSearch");
    expect(args).not.toContain("--json-schema");
  });

  it("maps the rank tier to the rank model and utility to the cheap one", () => {
    expect(
      valueOf(buildClaudeArgs({ mode: "parse", tier: "rank", jsonSchema: {} }), "--model"),
    ).toBe(CLAUDE_RANK_MODEL);
    expect(
      valueOf(buildClaudeArgs({ mode: "parse", tier: "utility", jsonSchema: {} }), "--model"),
    ).toBe(CLAUDE_UTILITY_MODEL);
  });

  it("forwards the effort level the caller asked for", () => {
    const args = buildClaudeArgs({
      mode: "parse",
      tier: "rank",
      jsonSchema: {},
      effort: "high",
    });
    expect(valueOf(args, "--effort")).toBe("high");
  });

  it("isolates the run from the user's own Claude Code configuration", () => {
    // A fetch route must not inherit this repo's CLAUDE.md, hooks or MCP
    // servers: they cost tokens, and a hook that blocks would hang the route.
    const args = buildClaudeArgs({ mode: "parse", tier: "rank", jsonSchema: {} });
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(valueOf(args, "--setting-sources")).toBe("");
    // Nothing can answer a permission prompt inside a server route, so anything
    // that would ask is denied instead of blocking forever.
    expect(valueOf(args, "--permission-prompts")).toBe("none");
  });

  it("caps spend per invocation when a budget is given", () => {
    const args = buildClaudeArgs({
      mode: "parse",
      tier: "rank",
      jsonSchema: {},
      maxBudgetUsd: 0.5,
    });
    expect(valueOf(args, "--max-budget-usd")).toBe("0.5");
  });

  it("omits the budget flag when none is given", () => {
    const args = buildClaudeArgs({ mode: "parse", tier: "rank", jsonSchema: {} });
    expect(args).not.toContain("--max-budget-usd");
  });

  it("always asks for the json envelope in print mode", () => {
    const args = buildClaudeArgs({ mode: "search", tier: "rank" });
    expect(args).toContain("--print");
    expect(valueOf(args, "--output-format")).toBe("json");
  });
});

const OkSchema = z.object({ ok: z.boolean() });

function envelope(fields: Record<string, unknown>): string {
  return JSON.stringify({ is_error: false, subtype: "success", ...fields });
}

describe("parseCliResult", () => {
  it("returns the object the model produced", () => {
    const parsed = parseCliResult(envelope({ result: '{"ok":true}' }), OkSchema);
    expect(parsed).toEqual({ ok: true });
  });

  it("throws when the CLI reports an error so a dead run is never a null feed", () => {
    const stdout = JSON.stringify({
      is_error: true,
      subtype: "error_max_budget",
      result: "budget exceeded",
    });
    expect(() => parseCliResult(stdout, OkSchema)).toThrow(/budget exceeded/);
  });

  it("returns null when the result is not JSON", () => {
    // Matches `parse`'s contract: null means "no parseable object", which the
    // ranker renders as an unranked job rather than a failed fetch.
    expect(parseCliResult(envelope({ result: "I cannot do that" }), OkSchema)).toBeNull();
  });

  it("returns null when the object does not match the schema", () => {
    expect(parseCliResult(envelope({ result: '{"ok":"yes"}' }), OkSchema)).toBeNull();
  });

  it("throws when stdout is not a CLI envelope at all", () => {
    expect(() => parseCliResult("command not found", OkSchema)).toThrow();
  });
});

describe("parseCliResult text mode", () => {
  it("returns the raw result string when no schema is given", () => {
    expect(parseCliResult(envelope({ result: "some prose" }), null)).toBe("some prose");
  });

  it("returns an empty string when a search produced no text", () => {
    // A search that hits the token ceiling still returns what it found, and
    // partial findings beat none — `searchWeb` does not throw on empty.
    expect(parseCliResult(envelope({ result: "" }), null)).toBe("");
  });
});

describe("createGate", () => {
  it("never runs more than the limit at once", async () => {
    const gate = createGate(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return peak;
    };

    await Promise.all(Array.from({ length: 8 }, () => gate(task)));

    // Ranking fans out one subprocess per batch. Twenty simultaneous `claude`
    // processes is a laptop problem that twenty simultaneous HTTPS requests
    // never was, so the gate is what makes the CLI client safe under rankJobs.
    expect(peak).toBe(2);
  });

  it("returns every result", async () => {
    const gate = createGate(2);
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => gate(async () => n * 2)));
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("frees its slot when a task rejects", async () => {
    const gate = createGate(1);
    await expect(gate(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(gate(async () => "after")).resolves.toBe("after");
  });
});

describe("toJsonSchema", () => {
  it("strips the $schema key the CLI validator rejects", () => {
    // `claude --json-schema` fails outright on zod's default dialect header:
    // "no schema with key or ref https://json-schema.org/draft/2020-12/schema".
    const converted = toJsonSchema(z.object({ tier: z.enum(["a", "b"]) })) as Record<
      string,
      unknown
    >;
    expect(converted).not.toHaveProperty("$schema");
    expect(converted).toMatchObject({
      type: "object",
      required: ["tier"],
    });
  });
});

describe("createClaudeCliClient error handling", () => {
  it("rejects instead of crashing when the binary exits before reading stdin", async () => {
    // `false` exits immediately, so writing a prompt into it raises EPIPE on the
    // child's stdin. An unhandled stream error there takes down the whole node
    // process — a dead fetch route rather than one failed batch.
    const client = createClaudeCliClient({ binary: "false", timeoutMs: 5_000 });
    await expect(
      client.parse({
        schema: OkSchema,
        schemaName: "ok",
        tier: "utility",
        prompt: "x".repeat(200_000),
      }),
    ).rejects.toThrow(/claude CLI/);
  }, 15_000);
});
