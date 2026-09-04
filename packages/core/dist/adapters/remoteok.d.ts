import type { NormalizedJob } from "../types.js";
export interface RemoteOkJob {
    id?: string;
    slug?: string;
    company?: string;
    position?: string;
    description?: string;
    location?: string;
    url?: string;
    apply_url?: string;
    epoch?: number;
    tags?: string[];
}
/** Returns null for rows that are not job postings (element 0 is a legal notice). */
export declare function normalizeRemoteOk(raw: RemoteOkJob): NormalizedJob | null;
export declare function fetchRemoteOk(): Promise<RemoteOkJob[]>;
