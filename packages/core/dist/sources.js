import { mapWithConcurrency } from "./adapters/index.js";
import { fetchGreenhouseBoard, normalizeGreenhouse } from "./adapters/greenhouse.js";
import { fetchLeverBoard, normalizeLever } from "./adapters/lever.js";
import { fetchAshbyBoard, normalizeAshby } from "./adapters/ashby.js";
import { fetchRemoteOk, normalizeRemoteOk } from "./adapters/remoteok.js";
import { fetchArbeitnow, normalizeArbeitnow } from "./adapters/arbeitnow.js";
import { fetchRemotive, normalizeRemotive, fetchHimalayas, normalizeHimalayas, fetchJobicy, normalizeJobicy, fetchInstahyre, normalizeInstahyre, } from "./adapters/india-boards.js";
import { findLatestHiringThread, fetchThreadComments, parseHnComment, } from "./adapters/hn.js";
import { fetchViaWebSearch } from "./adapters/web-search.js";
import { createBlueskySession, searchBlueskyPosts, buildBlueskyQueries, parseBlueskyPost, } from "./adapters/bluesky.js";
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
export const MODEL_BACKED_SOURCES = ["hn", "websearch", "bluesky"];
/**
 * The subset `skipModelSources` drops. Web search is deliberately not here: it
 * is two calls for the whole fetch, and dropping it dropped LinkedIn, Naukri
 * and Wellfound with it — the sites with the most India postings, and the ones
 * the "fast" default meant nobody ever saw.
 */
export const DEEP_ONLY_SOURCES = ["hn", "bluesky"];
export function buildSources(opts) {
    const { boards, profile, timeFrameDays, client } = opts;
    const cap = (tokens) => opts.maxBoards == null ? tokens : tokens.slice(0, opts.maxBoards);
    const sources = [
        ...cap(boards.greenhouse).map((token) => ({
            kind: "greenhouse",
            run: async () => (await fetchGreenhouseBoard(token)).map((j) => normalizeGreenhouse(j, token)),
        })),
        ...cap(boards.lever).map((token) => ({
            kind: "lever",
            run: async () => (await fetchLeverBoard(token)).map((j) => normalizeLever(j, token)),
        })),
        {
            kind: "remoteok",
            run: async () => (await fetchRemoteOk())
                .map(normalizeRemoteOk)
                .filter((j) => j !== null),
        },
        {
            kind: "arbeitnow",
            run: async () => (await fetchArbeitnow()).map(normalizeArbeitnow),
        },
        {
            kind: "remotive",
            run: async () => (await fetchRemotive()).map(normalizeRemotive),
        },
        {
            kind: "himalayas",
            run: async () => (await fetchHimalayas()).map(normalizeHimalayas),
        },
        {
            kind: "jobicy",
            run: async () => (await fetchJobicy()).map(normalizeJobicy),
        },
    ];
    // Ashby and Instahyre expose no post date, so they only join an unbounded
    // fetch. Instahyre is the largest India-native source (~13k roles) and this
    // is the one place India priority and freshness genuinely conflict.
    if (timeFrameDays === null) {
        sources.push(...cap(boards.ashby).map((org) => ({
            kind: "ashby",
            run: async () => (await fetchAshbyBoard(org)).map((j) => normalizeAshby(j, org)),
        })), {
            kind: "instahyre",
            run: async () => (await fetchInstahyre())
                .map(normalizeInstahyre)
                .filter((j) => j !== null),
        });
    }
    if (!client)
        return sources;
    // Web search runs on every fetch that has a client. Two model calls total —
    // one to search, one to structure — regardless of how many postings return.
    sources.push({
        kind: "websearch",
        timeoutMs: MODEL_SOURCE_TIMEOUT_MS,
        run: () => fetchViaWebSearch(profile, timeFrameDays, client),
    });
    if (opts.skipModelSources)
        return sources;
    sources.push({
        kind: "hn",
        timeoutMs: MODEL_SOURCE_TIMEOUT_MS,
        run: async () => {
            const comments = (await fetchThreadComments(await findLatestHiringThread())).slice(0, HN_COMMENT_LIMIT);
            // A "Who is hiring" thread runs to several hundred comments. Firing one
            // model call per comment at once earns rate limits, and every rejected
            // call is billed effort thrown away — so this is bounded.
            const parsed = await mapWithConcurrency(comments, MODEL_CONCURRENCY, (c) => parseHnComment(c, client));
            return parsed.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : []);
        },
    });
    // Missing Bluesky credentials disable the source rather than failing a fetch.
    if (opts.bluesky) {
        const { identifier, appPassword } = opts.bluesky;
        sources.push({
            kind: "bluesky",
            timeoutMs: MODEL_SOURCE_TIMEOUT_MS,
            run: async () => {
                const token = await createBlueskySession(identifier, appPassword);
                const batches = await Promise.all(buildBlueskyQueries(profile).map((q) => searchBlueskyPosts(token, q).catch(() => [])));
                const parsed = await mapWithConcurrency(batches.flat(), MODEL_CONCURRENCY, (p) => parseBlueskyPost(p, client));
                return parsed.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : []);
            },
        });
    }
    return sources;
}
