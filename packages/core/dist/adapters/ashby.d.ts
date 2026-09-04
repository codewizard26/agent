import type { NormalizedJob } from "../types.js";
export interface AshbyPosting {
    id: string;
    title: string;
    locationName?: string;
    employmentType?: string;
}
export declare function normalizeAshby(raw: AshbyPosting, org: string): NormalizedJob;
export declare function fetchAshbyBoard(org: string): Promise<AshbyPosting[]>;
