import type { NormalizedJob } from "../types.js";
export interface GreenhouseJob {
    id: number;
    title: string;
    absolute_url: string;
    content?: string;
    location: {
        name: string;
    };
    /** True first-publish date. THE field to filter on. */
    first_published: string | null;
    /** Reflects edits. Filtering on this reports stale jobs as fresh — never use it. */
    updated_at: string;
}
/** Decode the entities Greenhouse emits, then strip tags. */
export declare function htmlToText(html: string): string;
export declare function normalizeGreenhouse(raw: GreenhouseJob, token: string): NormalizedJob;
export declare function fetchGreenhouseBoard(token: string): Promise<GreenhouseJob[]>;
