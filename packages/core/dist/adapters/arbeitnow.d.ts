import type { NormalizedJob } from "../types.js";
export interface ArbeitnowJob {
    slug: string;
    company_name: string;
    title: string;
    description: string;
    remote: boolean;
    url: string;
    location: string;
    created_at: number;
    tags?: string[];
}
export declare function normalizeArbeitnow(raw: ArbeitnowJob): NormalizedJob;
export declare function fetchArbeitnow(): Promise<ArbeitnowJob[]>;
