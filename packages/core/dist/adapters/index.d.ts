import type { NormalizedJob } from "../types.js";
export interface BoardsConfig {
    greenhouse: string[];
    lever: string[];
    ashby: string[];
}
export declare function loadBoards(yamlText: string): BoardsConfig;
export declare function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[];
/**
 * Runs fn over items with at most `limit` in flight. Never throws — every
 * outcome comes back as a settled result so one dead board cannot abort a fetch.
 */
export declare function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]>;
