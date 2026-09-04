import type { LlmClient } from "../llm.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";
/**
 * Search queries derived from the profile — never a fixed list.
 *
 * The roles come from `deriveRoleFamilies`, so a resume built on React and Node
 * searches for frontend, backend and full stack work while a data resume would
 * not. The queries used to hardcode "full stack developer", which is one
 * person's title, and is why the results drifted off what the resume says.
 *
 * The `site:` queries are the whole point of this adapter. LinkedIn, Naukri,
 * Wellfound, Foundit, Cutshort and Hirist all refuse programmatic access
 * (401/403/404/406) and forbid scraping, so their postings are reached the way
 * design §3 reaches X: as pages a search engine has already indexed. Nothing
 * here logs into anything or fetches those sites directly.
 */
export declare function buildSearchQueries(profile: ParsedProfile, timeFrameDays: number | null): string[];
/**
 * Two calls by design: one search call that reads the web, then one extraction
 * call that structures what it found. Keeping them separate avoids relying on
 * an undocumented interaction between server tools and output_config.format.
 */
export declare function fetchViaWebSearch(profile: ParsedProfile, timeFrameDays: number | null, client: LlmClient): Promise<NormalizedJob[]>;
