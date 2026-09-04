import type { BoardsConfig } from "./adapters/index.js";
import type { LlmClient } from "./llm.js";
import type { ParsedProfile } from "./resume.js";
import type { SourceTask } from "./pipeline.js";
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
    bluesky?: {
        identifier: string;
        appPassword: string;
    };
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
/** Sources that cannot run without a model client. */
export declare const MODEL_BACKED_SOURCES: readonly ["hn", "websearch", "bluesky"];
/**
 * The subset `skipModelSources` drops. Web search is deliberately not here: it
 * is two calls for the whole fetch, and dropping it dropped LinkedIn, Naukri
 * and Wellfound with it — the sites with the most India postings, and the ones
 * the "fast" default meant nobody ever saw.
 */
export declare const DEEP_ONLY_SOURCES: readonly ["hn", "bluesky"];
export declare function buildSources(opts: BuildSourcesOptions): SourceTask[];
