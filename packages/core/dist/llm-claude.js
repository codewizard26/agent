import { execFile } from "node:child_process";
import { toJSONSchema } from "zod";
import { CLAUDE_RANK_MODEL, CLAUDE_UTILITY_MODEL } from "./models.js";
function modelFor(tier) {
    return tier === "rank" ? CLAUDE_RANK_MODEL : CLAUDE_UTILITY_MODEL;
}
/**
 * The argv for one `claude` invocation. Split out from the spawn so the flag
 * set — which is most of what makes this cheap and non-interactive — is
 * testable without paying for a subprocess.
 *
 * The prompt is NOT here: it goes in on stdin, because a 20-job ranking batch
 * carries 20 job descriptions and belongs nowhere near an argv limit.
 */
export function buildClaudeArgs(opts) {
    const args = [
        "--print",
        "--output-format",
        "json",
        "--model",
        modelFor(opts.tier),
        // Isolation. Without these the run inherits this repo's CLAUDE.md, the
        // user's hooks, their MCP servers and their skills — tokens the fetch does
        // not need, and a hook that blocks is a route that hangs.
        "--no-session-persistence",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        // Nobody can answer a permission prompt inside a server route.
        "--permission-prompts",
        "none",
    ];
    if (opts.mode === "search") {
        // One tool, named twice: `--tools` decides what exists, `--allowed-tools`
        // pre-approves it so the denied-by-default prompt policy above cannot
        // silently kill the search.
        args.push("--tools", "WebSearch", "--allowed-tools", "WebSearch");
    }
    else {
        // Empty tool set. This is the single biggest cost lever: measured
        // 2026-09-03 the same prompt took 26,725 input tokens with the default
        // tools and 1,007 without them.
        args.push("--tools", "");
        args.push("--json-schema", JSON.stringify(opts.jsonSchema ?? {}));
    }
    if (opts.effort)
        args.push("--effort", opts.effort);
    if (opts.maxBudgetUsd !== undefined) {
        args.push("--max-budget-usd", String(opts.maxBudgetUsd));
    }
    return args;
}
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
export function parseCliResult(stdout, schema) {
    let envelope;
    try {
        envelope = JSON.parse(stdout);
    }
    catch {
        throw new Error(`claude CLI produced no JSON envelope: ${stdout.slice(0, 200)}`);
    }
    if (envelope.is_error) {
        throw new Error(`claude CLI failed (${envelope.subtype ?? "unknown"}): ${envelope.result ?? ""}`);
    }
    const result = envelope.result ?? "";
    if (schema === null)
        return result;
    let candidate;
    try {
        candidate = JSON.parse(result);
    }
    catch {
        return null;
    }
    const parsed = schema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
}
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BUDGET_USD = 2;
/**
 * `rankJobs` fans every batch out at once with `Promise.allSettled`. Against an
 * HTTP provider that is twenty sockets; against this client it is twenty node
 * subprocesses, which is a different kind of load entirely. Four keeps a
 * ranking pass moving without stalling the machine it runs on.
 */
const DEFAULT_MAX_CONCURRENCY = 4;
/**
 * Admits at most `limit` tasks at a time, queueing the rest in arrival order.
 * A rejected task frees its slot exactly like a resolved one.
 */
export function createGate(limit) {
    let active = 0;
    const waiting = [];
    // A finishing task hands its slot straight to the next in line rather than
    // decrementing and letting whoever asks next take it. Releasing first leaves
    // a window where a newly arriving caller and the woken one both see room.
    const release = () => {
        const next = waiting.shift();
        if (next)
            next();
        else
            active -= 1;
    };
    return async function gate(fn) {
        if (active >= limit) {
            await new Promise((resolve) => waiting.push(resolve));
        }
        else {
            active += 1;
        }
        try {
            return await fn();
        }
        finally {
            release();
        }
    };
}
function run(binary, args, prompt, timeoutMs, cwd) {
    return new Promise((resolve, reject) => {
        const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, cwd }, (error, stdout, stderr) => {
            // A non-zero exit with a parseable envelope is still a usable answer —
            // `parseCliResult` reports it far better than an exec error does.
            if (error && !stdout.trim().startsWith("{")) {
                reject(new Error(`claude CLI: ${error.message}${stderr ? ` — ${stderr.slice(0, 300)}` : ""}`));
                return;
            }
            resolve(stdout);
        });
        // The child can exit before it drains a long prompt — a missing binary, a
        // rejected flag — and an unhandled EPIPE on this stream takes the whole
        // node process down with it. The execFile callback above already reports
        // the real failure, so swallowing it here loses nothing.
        child.stdin?.on("error", () => { });
        child.stdin?.end(prompt);
    });
}
/**
 * An `LlmClient` over the local `claude` binary. Drop-in for
 * `createOpenAiClient` — every call site takes the interface, not the provider.
 */
export function createClaudeCliClient(opts = {}) {
    const binary = opts.binary ?? process.env.CLAUDE_CLI_PATH ?? "claude";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBudgetUsd = opts.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
    // The subprocess never needs the repo. Running it out of the temp directory
    // keeps it from picking up project files even if a setting source slips.
    const cwd = opts.cwd ?? process.env.TMPDIR ?? "/tmp";
    const gate = createGate(opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    return {
        async parse(parseOpts) {
            const jsonSchema = toJsonSchema(parseOpts.schema);
            const args = buildClaudeArgs({
                mode: "parse",
                tier: parseOpts.tier,
                jsonSchema,
                effort: parseOpts.effort ?? "low",
                maxBudgetUsd,
            });
            const prompt = parseOpts.system
                ? `${parseOpts.system}\n\n${parseOpts.prompt}`
                : parseOpts.prompt;
            const stdout = await gate(() => run(binary, args, prompt, timeoutMs, cwd));
            return parseCliResult(stdout, parseOpts.schema);
        },
        async searchWeb(searchOpts) {
            const args = buildClaudeArgs({
                mode: "search",
                tier: "rank",
                effort: "low",
                maxBudgetUsd,
            });
            const stdout = await gate(() => run(binary, args, searchOpts.prompt, timeoutMs, cwd));
            return parseCliResult(stdout, null);
        },
    };
}
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
export function toJsonSchema(schema) {
    const { $schema: _dialect, ...rest } = toJSONSchema(schema, { io: "output" });
    return rest;
}
