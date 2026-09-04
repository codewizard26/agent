import type { BoardsConfig } from "./adapters/index.js";
import type { LlmClient } from "./llm.js";
import type { ParsedProfile } from "./resume.js";
import type { SourceTask } from "./pipeline.js";
import type { NormalizedJob } from "./types.js";

import { mapWithConcurrency } from "./adapters/index.js";
import { fetchGreenhouseBoard, normalizeGreenhouse } from "./adapters/greenhouse.js";
import { fetchLeverBoard, normalizeLever } from "./adapters/lever.js";
import { fetchAshbyBoard, normalizeAshby } from "./adapters/ashby.js";
import { fetchRemoteOk, normalizeRemoteOk } from "./adapters/remoteok.js";
import { fetchYcombinator, normalizeYc } from "./adapters/ycombinator.js";
import { fetchArbeitnow, normalizeArbeitnow } from "./adapters/arbeitnow.js";
import {
  fetchRemotive,
  normalizeRemotive,
  fetchHimalayas,
  normalizeHimalayas,
  fetchJobicy,
  normalizeJobicy,
  fetchInstahyre,
  normalizeInstahyre,
} from "./adapters/india-boards.js";
import {
  findLatestHiringThread,
  fetchThreadComments,
  parseHnComment,
} from "./adapters/hn.js";
import { fetchViaWebSearch } from "./adapters/web-search.js";
import {
  createBlueskySession,
  searchBlueskyPosts,
  buildBlueskyQueries,
  parseBlueskyPost,
} from "./adapters/bluesky.js";

export interface BuildSourcesOptions {
  boards: BoardsConfig;
  profile: ParsedProfile;
  timeFrameDays: number | null;
  /**
   * Omit to skip every source that needs a model. Without it you get the ten
   * pure-HTTP sources and no API cost at all — which is what the candidates
   * CLI uses so Claude Code can do the ranking instead.
   */
  client?: LlmClient;
  bluesky?: { identifier: string; appPassword: string };
  /** Cap on company board tokens per provider. Omit to use every token. */
  maxBoards?: number;
  /**
   * Skip the per-item model sources — hn and bluesky — even with a client. They
   * make one model call per comment or post and add minutes; this is the
   * difference between a 20s fetch and a four-minute one.
   *
   * It does NOT skip web search, which costs two calls total no matter how many
   * postings come back, and is the only route to LinkedIn and Naukri.
   */
  skipModelSources?: boolean;
}

/** Per-item model calls in flight at once, for the sources that make one call per item. */
const MODEL_CONCURRENCY = 8;

/**
 * Comments parsed from one "Who is hiring" thread. Measured 2026-08-29: 782
 * comments at ~471ms each with concurrency 8 is 368s — past the fetch route's
 * 300s ceiling on its own, before ranking. This cap keeps hn inside the budget.
 */
const HN_COMMENT_LIMIT = 200;

/**
 * Model-backed sources make one call per item, so they run in minutes, not
 * seconds. `collectCandidates`'s default ceiling is sized for an HTTP board and
 * would kill every one of them.
 */
const MODEL_SOURCE_TIMEOUT_MS = 240_000;

/** Sources that cannot run without a model client. */
export const MODEL_BACKED_SOURCES = ["hn", "websearch", "bluesky"] as const;

/**
 * The subset `skipModelSources` drops. Web search is deliberately not here: it
 * is two calls for the whole fetch, and dropping it dropped LinkedIn, Naukri
 * and Wellfound with it — the sites with the most India postings, and the ones
 * the "fast" default meant nobody ever saw.
 */
export const DEEP_ONLY_SOURCES = ["hn", "bluesky"] as const;

export function buildSources(opts: BuildSourcesOptions): SourceTask[] {
  const { boards, profile, timeFrameDays, client } = opts;
  const cap = <T,>(tokens: T[]): T[] =>
    opts.maxBoards == null ? tokens : tokens.slice(0, opts.maxBoards);

  const sources: SourceTask[] = [
    ...cap(boards.greenhouse).map((token) => ({
      kind: "greenhouse" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchGreenhouseBoard(token)).map((j) => normalizeGreenhouse(j, token)),
    })),
    ...cap(boards.lever).map((token) => ({
      kind: "lever" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchLeverBoard(token)).map((j) => normalizeLever(j, token)),
    })),
    {
      kind: "remoteok" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchRemoteOk())
          .map(normalizeRemoteOk)
          .filter((j): j is NormalizedJob => j !== null),
    },
    {
      // YC states an age ("19 days") rather than a timestamp, so its dates are
      // derived and marked "reported" — good enough to survive a time window,
      // which is why this sits with the dated sources and not with Ashby.
      kind: "ycombinator" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchYcombinator()).map((j) => normalizeYc(j)),
    },
    {
      kind: "arbeitnow" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchArbeitnow()).map(normalizeArbeitnow),
    },
    {
      kind: "remotive" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchRemotive()).map(normalizeRemotive),
    },
    {
      kind: "himalayas" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchHimalayas()).map(normalizeHimalayas),
    },
    {
      kind: "jobicy" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchJobicy()).map(normalizeJobicy),
    },
  ];

  // Ashby and Instahyre expose no post date, so they only join an unbounded
  // fetch. Instahyre is the largest India-native source (~13k roles) and this
  // is the one place India priority and freshness genuinely conflict.
  if (timeFrameDays === null) {
    sources.push(
      ...cap(boards.ashby).map((org) => ({
        kind: "ashby" as const,
        run: async (): Promise<NormalizedJob[]> =>
          (await fetchAshbyBoard(org)).map((j) => normalizeAshby(j, org)),
      })),
      {
        kind: "instahyre" as const,
        run: async (): Promise<NormalizedJob[]> =>
          (await fetchInstahyre())
            .map(normalizeInstahyre)
            .filter((j): j is NormalizedJob => j !== null),
      },
    );
  }

  if (!client) return sources;

  // Web search runs on every fetch that has a client. Two model calls total —
  // one to search, one to structure — regardless of how many postings return.
  sources.push({
    kind: "websearch" as const,
    timeoutMs: MODEL_SOURCE_TIMEOUT_MS,
    run: (): Promise<NormalizedJob[]> =>
      fetchViaWebSearch(profile, timeFrameDays, client),
  });

  if (opts.skipModelSources) return sources;

  sources.push(
    {
      kind: "hn" as const,
      timeoutMs: MODEL_SOURCE_TIMEOUT_MS,
      run: async (): Promise<NormalizedJob[]> => {
        const comments = (await fetchThreadComments(await findLatestHiringThread())).slice(
          0,
          HN_COMMENT_LIMIT,
        );
        // A "Who is hiring" thread runs to several hundred comments. Firing one
        // model call per comment at once earns rate limits, and every rejected
        // call is billed effort thrown away — so this is bounded.
        const parsed = await mapWithConcurrency(comments, MODEL_CONCURRENCY, (c) =>
          parseHnComment(c, client),
        );
        return parsed.flatMap((r) =>
          r.status === "fulfilled" && r.value ? [r.value] : [],
        );
      },
    },
  );

  // Missing Bluesky credentials disable the source rather than failing a fetch.
  if (opts.bluesky) {
    const { identifier, appPassword } = opts.bluesky;
    sources.push({
      kind: "bluesky" as const,
      timeoutMs: MODEL_SOURCE_TIMEOUT_MS,
      run: async (): Promise<NormalizedJob[]> => {
        const token = await createBlueskySession(identifier, appPassword);
        const batches = await Promise.all(
          buildBlueskyQueries(profile).map((q) =>
            searchBlueskyPosts(token, q).catch(() => []),
          ),
        );
        const parsed = await mapWithConcurrency(batches.flat(), MODEL_CONCURRENCY, (p) =>
          parseBlueskyPost(p, client),
        );
        return parsed.flatMap((r) =>
          r.status === "fulfilled" && r.value ? [r.value] : [],
        );
      },
    });
  }

  return sources;
}
