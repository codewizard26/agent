import type { NormalizedJob } from "../types.js";
export interface RemotiveJob {
    id: number;
    title: string;
    company_name: string;
    url: string;
    description?: string;
    /** Free text, e.g. "Worldwide", "Europe", "India". */
    candidate_required_location?: string;
    publication_date: string;
}
export declare function normalizeRemotive(raw: RemotiveJob): NormalizedJob;
export declare function fetchRemotive(): Promise<RemotiveJob[]>;
export interface HimalayasJob {
    guid: string;
    title: string;
    companyName: string;
    applicationLink: string;
    description?: string;
    excerpt?: string;
    /** Array of countries the employer will hire from. */
    locationRestrictions?: string[];
    /** Epoch seconds, as a string or number. */
    pubDate: string | number;
}
export declare function normalizeHimalayas(raw: HimalayasJob): NormalizedJob;
export declare function fetchHimalayas(): Promise<HimalayasJob[]>;
export interface JobicyJob {
    id: number;
    jobTitle: string;
    companyName: string;
    url: string;
    jobDescription?: string;
    jobExcerpt?: string;
    /** Comma-separated region string, e.g. "Denmark,  Finland" or "Anywhere". */
    jobGeo?: string;
    pubDate: string;
}
export declare function normalizeJobicy(raw: JobicyJob): NormalizedJob;
export declare function fetchJobicy(): Promise<JobicyJob[]>;
export interface InstahyreJob {
    id: number;
    title: string;
    locations?: string;
    keywords?: string[];
    public_url: string;
    employer?: {
        company_name?: string;
    };
}
/**
 * India-native, ~13k live roles. It exposes NO post date — `reviewed_at` is null
 * on every record — so it carries dateFidelity 'none' and, like Ashby, is
 * excluded from time-framed fetches.
 */
export declare function normalizeInstahyre(raw: InstahyreJob): NormalizedJob | null;
export declare function fetchInstahyre(): Promise<InstahyreJob[]>;
