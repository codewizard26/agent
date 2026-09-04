/**
 * Fetch + dedupe + filter, and write the survivors to disk for ranking inside a
 * Claude Code conversation.
 *
 * Two modes:
 *   --client none    (default) pure HTTP sources only, no model anywhere. The
 *                    model-backed sources — web search, Hacker News, Bluesky —
 *                    are skipped, which also means no LinkedIn, Naukri,
 *                    Wellfound, Hirist or Cutshort: those are reachable only as
 *                    pages a search engine already indexed.
 *   --client claude  spawns the local `claude` binary for the model half, on
 *                    the user's own Claude Code session. Turns web search on,
 *                    and with `--deep true` Hacker News and Bluesky too.
 *
 * Ranking still happens in chat either way — this script writes candidates,
 * `runFetch` is what scores them.
 *
 * Usage:
 *   pnpm candidates --profile ./my-profile.json [--days 7] [--desc 800]
 *   pnpm candidates --profile-id <uuid> [--days any] [--max-boards 30]
 *   pnpm candidates --profile ./my-profile.json --client claude --deep true
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, profiles, jobLedger } from "@job-agent/db";
import {
  buildSources,
  collectCandidates,
  loadBoards,
  ledgerMatchKeys,
  sortByIndiaPriority,
  profileBrief,
  jobBrief,
  ParsedProfileSchema,
  PostureSchema,
  ProfileFileSchema,
  MODEL_BACKED_SOURCES,
  DEFAULT_SOURCE_TIMEOUT_MS,
  DEEP_ONLY_SOURCES,
  createClaudeCliClient,
  type NormalizedJob,
  type ParsedProfile,
  type Posture,
} from "@job-agent/core";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

interface Args {
  profileFile: string | null;
  profileId: string | null;
  timeFrameDays: number | null;
  descriptionChars: number;
  outDir: string;
  concurrency: number;
  maxBoards: number | null;
  sourceTimeoutMs: number;
  client: "none" | "claude";
  /** Adds the per-item model sources (Hacker News, Bluesky). Minutes, not seconds. */
  deep: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    profileFile: null,
    profileId: null,
    timeFrameDays: 7,
    descriptionChars: 800,
    outDir: path.join(ROOT, ".candidates"),
    concurrency: 32,
    maxBoards: null,
    sourceTimeoutMs: DEFAULT_SOURCE_TIMEOUT_MS,
    client: "none",
    deep: false,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    switch (flag) {
      case "--profile":
        args.profileFile = path.resolve(value);
        break;
      case "--profile-id":
        args.profileId = value;
        break;
      case "--days":
        // "any" drops the window, which is also the only way to see Ashby and
        // Instahyre — neither exposes a post date.
        args.timeFrameDays = value === "any" ? null : Number(value);
        break;
      case "--desc":
        args.descriptionChars = Number(value);
        break;
      case "--out":
        args.outDir = path.resolve(value);
        break;
      case "--concurrency":
        args.concurrency = Number(value);
        break;
      case "--source-timeout":
        // One Lever aggregator board carries thousands of postings and takes
        // ~43s. At the 15s default it is reported failed every run, so its
        // platform row reads "failed" rather than the postings it actually has.
        args.sourceTimeoutMs = Number(value);
        break;
      case "--client":
        if (value !== "none" && value !== "claude") {
          throw new Error(`--client takes "none" or "claude", got "${value}"`);
        }
        args.client = value;
        break;
      case "--deep":
        args.deep = value === "true";
        break;
      case "--max-boards":
        // Fewer company board tokens. The boards are only ~13s of the fetch, so
        // this trades coverage for a small win — reach for it last.
        args.maxBoards = Number(value);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!args.profileFile && !args.profileId) {
    throw new Error("pass --profile <file.json> or --profile-id <uuid>");
  }
  if (args.timeFrameDays !== null && !Number.isFinite(args.timeFrameDays)) {
    throw new Error("--days takes a number or 'any'");
  }
  return args;
}

interface ResolvedProfile {
  name: string;
  /** null when no database row backs this profile, which means no ledger. */
  id: string | null;
  parsedProfile: ParsedProfile;
  posture: Posture;
}

/**
 * A profile JSON file is the primary path: `pnpm seed` needs a model to parse a
 * resume, and skipping that model is the whole reason this script exists.
 * A database row is still used when one exists, because that id is what the
 * ledger — the record of what has already been applied to — hangs off.
 */
async function resolveProfile(
  db: ReturnType<typeof createDb>,
  args: Args,
): Promise<ResolvedProfile> {
  if (args.profileId) {
    const [row] = await db.select().from(profiles).where(eq(profiles.id, args.profileId));
    if (!row) throw new Error(`no profile with id ${args.profileId}`);
    return {
      name: row.name,
      id: row.id,
      parsedProfile: ParsedProfileSchema.parse(row.parsedProfile) as ParsedProfile,
      posture: PostureSchema.parse(row.posture),
    };
  }

  const file = ProfileFileSchema.parse(
    JSON.parse(fs.readFileSync(args.profileFile!, "utf8")),
  );

  // ownerEmail is the join back to the database row, which is what the ledger
  // hangs off. `pnpm add-profile` creates that row without needing a model.
  let id: string | null = null;
  try {
    const [row] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.ownerEmail, file.ownerEmail));
    id = row?.id ?? null;
  } catch (error) {
    console.warn(`profile lookup failed, continuing without a ledger: ${error}`);
  }

  return {
    name: file.name,
    id,
    parsedProfile: file.parsedProfile as ParsedProfile,
    posture: file.posture,
  };
}

/** An unreachable or empty database means an empty ledger, never a crash. */
async function loadLedgerKeys(
  db: ReturnType<typeof createDb>,
  profileId: string | null,
): Promise<Set<string>> {
  if (!profileId) return new Set();
  try {
    const rows = await db
      .select()
      .from(jobLedger)
      .where(eq(jobLedger.profileId, profileId));
    return new Set(
      rows.flatMap((r) => ledgerMatchKeys({ atsKey: r.atsKey, slugKey: r.slugKey })),
    );
  } catch (error) {
    console.warn(`ledger read failed, treating every job as unseen: ${error}`);
    return new Set();
  }
}

function renderBrief(
  profile: ResolvedProfile,
  jobs: NormalizedJob[],
  args: Args,
  stats: { fetched: number; deduped: number; kept: number },
  failed: string[],
  ledgerSize: number,
): string {
  const window = args.timeFrameDays === null ? "any" : `${args.timeFrameDays}d`;
  const lines = [
    `# Candidates for ${profile.name}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Time frame: ${window}`,
    `Fetched ${stats.fetched} -> deduped ${stats.deduped} -> kept ${stats.kept}`,
    `Ledger keys applied: ${ledgerSize}`,
    `Failed sources: ${failed.join(", ") || "none"}`,
    `Skipped: ${skipped.join(", ") || "nothing — every source ran"}`,
    "",
    "## Candidate",
    "",
    profileBrief(profile.parsedProfile),
    `India priority: ${profile.posture.indiaPriority ? "on" : "off"}`,
    "",
    "## Jobs",
    "",
    "Ordered India-located first, then India-eligible. Score each against the",
    "candidate above and return jobKey, score 0-100, tier, and why.",
    "",
  ];

  jobs.forEach((job, i) => {
    const posted = job.postedAt
      ? `${job.postedAt.toISOString().slice(0, 10)} (${job.dateFidelity})`
      : "unknown";
    lines.push(
      `### ${i + 1}. ${job.company} — ${job.title}`,
      "",
      `source: ${job.sourceKind} | posted: ${posted} | apply: ${job.applyUrl}`,
      "",
      jobBrief(job, args.descriptionChars),
      "",
    );
  });

  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
const db = createDb();
const profile = await resolveProfile(db, args);
const ledgerKeys = await loadLedgerKeys(db, profile.id);

if (!profile.id) {
  console.warn(
    "no database row for this profile — every job counts as unseen. Applied " +
      "jobs will keep reappearing until a profile row exists.",
  );
}

const boards = loadBoards(
  fs.readFileSync(path.join(ROOT, "sources", "boards.yaml"), "utf8"),
);

// Concurrency 8 rather than the client default of 4: this is a CLI with the
// whole machine to itself, not a request handler sharing one.
const client =
  args.client === "claude" ? createClaudeCliClient({ maxConcurrency: 8 }) : undefined;

const sources = buildSources({
  boards,
  profile: profile.parsedProfile,
  timeFrameDays: args.timeFrameDays,
  client,
  maxBoards: args.maxBoards ?? undefined,
  // Without a client this flag is moot — buildSources omits every model source.
  skipModelSources: !args.deep,
  bluesky:
    process.env.BLUESKY_IDENTIFIER && process.env.BLUESKY_APP_PASSWORD
      ? {
          identifier: process.env.BLUESKY_IDENTIFIER,
          appPassword: process.env.BLUESKY_APP_PASSWORD,
        }
      : undefined,
});

const skipped =
  args.client === "none"
    ? MODEL_BACKED_SOURCES
    : args.deep
      ? []
      : DEEP_ONLY_SOURCES;

console.log(
  `fetching ${sources.length} sources (client=${args.client}` +
    `${skipped.length > 0 ? `, skipping ${skipped.join(", ")}` : ", every source"})…`,
);

const result = await collectCandidates({
  profile: profile.parsedProfile,
  posture: profile.posture,
  sources,
  ledgerKeys,
  timeFrameDays: args.timeFrameDays,
  concurrency: args.concurrency,
  sourceTimeoutMs: args.sourceTimeoutMs,
});

if (result.allSourcesFailed) {
  console.error(`every source failed (${result.failed.join(", ")}) — check the network`);
  process.exit(1);
}

const jobs = profile.posture.indiaPriority
  ? sortByIndiaPriority(result.jobs)
  : result.jobs;

/**
 * Kept and rejected counts per platform. The aggregate stats hide which board
 * a feed actually came from, which is the first question asked of any run.
 */
const bySource: Record<string, { kept: number; rejected: number }> = {};
const bump = (kind: string, field: "kept" | "rejected") => {
  bySource[kind] ??= { kept: 0, rejected: 0 };
  bySource[kind][field] += 1;
};
for (const job of result.jobs) bump(job.sourceKind, "kept");
for (const { job } of result.rejected) bump(job.sourceKind, "rejected");

fs.mkdirSync(args.outDir, { recursive: true });
const jsonPath = path.join(args.outDir, "candidates.json");
const briefPath = path.join(args.outDir, "candidates.brief.md");

fs.writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      profile: { name: profile.name, id: profile.id },
      timeFrameDays: args.timeFrameDays,
      stats: result.stats,
      bySource,
      rejectionReasons: result.rejected.reduce<Record<string, number>>((acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1;
        return acc;
      }, {}),
      failed: result.failed,
      client: args.client,
      skipped,
      jobs,
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  briefPath,
  renderBrief(profile, jobs, args, result.stats, result.failed, ledgerKeys.size),
);

console.log(
  `fetched ${result.stats.fetched} -> deduped ${result.stats.deduped} -> kept ${result.stats.kept}`,
);
if (result.failed.length > 0) console.log(`failed sources: ${result.failed.join(", ")}`);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${briefPath}`);
process.exit(0);
