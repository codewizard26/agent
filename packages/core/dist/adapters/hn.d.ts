import type { LlmClient } from "../llm.js";
import type { NormalizedJob } from "../types.js";
export interface HnComment {
    objectID: string;
    comment_text: string;
    created_at_i: number;
}
/** Finds the newest "Ask HN: Who is hiring?" story id. */
export declare function findLatestHiringThread(): Promise<number>;
export declare function fetchThreadComments(storyId: number): Promise<HnComment[]>;
export declare function parseHnComment(comment: HnComment, client: LlmClient): Promise<NormalizedJob | null>;
