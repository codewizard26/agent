import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
import type { NormalizedJob } from "../types.js";

export interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  location: string;
  created_at: number; // seconds
  tags?: string[];
}

export function normalizeArbeitnow(raw: ArbeitnowJob): NormalizedJob {
  return {
    key: buildJobKey({
      company: raw.company_name,
      title: raw.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "arbeitnow",
    company: raw.company_name,
    title: raw.title,
    locationRaw: raw.location,
    remote: raw.remote,
    locationRestrictions: [],
    descriptionText: htmlToText(raw.description),
    applyUrl: raw.url,
    atsKind: null,
    atsRef: null,
    postedAt: new Date(raw.created_at * 1000),
    dateFidelity: "true",
  };
}

const ARBEITNOW_MAX_PAGES = 10;

/**
 * Fetch several pages from the public, paginated API. It returns 175 jobs per
 * page, so the bounded default can collect up to 1,750 listings without
 * repeatedly walking an unbounded public feed on every refresh.
 */
export async function fetchArbeitnow(maxPages = ARBEITNOW_MAX_PAGES): Promise<ArbeitnowJob[]> {
  const jobs: ArbeitnowJob[] = [];
  let next: string | null = "https://www.arbeitnow.com/api/job-board-api";
  const pageLimit = Math.max(1, Math.min(ARBEITNOW_MAX_PAGES, Math.floor(maxPages)));

  for (let page = 0; page < pageLimit && next; page += 1) {
    const res = await fetch(next, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`arbeitnow: HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: ArbeitnowJob[];
      links?: { next?: string | null };
    };
    jobs.push(...(body.data ?? []));
    next = body.links?.next ?? null;
  }

  return jobs;
}
