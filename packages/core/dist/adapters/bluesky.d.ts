import type { LlmClient } from "../llm.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";
export interface BlueskyPost {
    uri: string;
    author: {
        handle: string;
        displayName?: string;
    };
    record: {
        text: string;
        createdAt: string;
        facets?: {
            features: {
                uri?: string;
            }[];
        }[];
    };
}
/** Exchanges an app password for a session token. Create the app password in Bluesky settings. */
export declare function createBlueskySession(identifier: string, appPassword: string): Promise<string>;
export declare function searchBlueskyPosts(accessJwt: string, query: string, limit?: number): Promise<BlueskyPost[]>;
export declare function buildBlueskyQueries(profile: ParsedProfile): string[];
export declare function parseBlueskyPost(post: BlueskyPost, client: LlmClient): Promise<NormalizedJob | null>;
