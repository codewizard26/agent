import { buildJobKey } from "../job-key.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "./greenhouse.js";

interface CareerjetRawJob {
  title?: string;
  company?: string;
  date?: string;
  description?: string;
  locations?: string;
  url?: string;
}

interface CareerjetResponse {
  pages?: number;
  jobs?: CareerjetRawJob[];
}

export interface CareerjetAccess {
  apiKey: string;
  userIp: string;
  userAgent: string;
  referer: string;
}

function normalizeCareerjet(raw: CareerjetRawJob): NormalizedJob | null {
  if (!raw.title || !raw.company || !raw.url) return null;
  const parsedDate = raw.date ? new Date(raw.date) : null;
  const postedAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
  return {
    key: buildJobKey({ company: raw.company, title: raw.title, atsKind: null, atsRef: null }),
    sourceKind: "careerjet",
    company: raw.company,
    title: raw.title,
    locationRaw: raw.locations ?? "India",
    remote: /remote|work from home/i.test(`${raw.locations ?? ""} ${raw.title}`),
    locationRestrictions: [],
    descriptionText: htmlToText(raw.description ?? ""),
    applyUrl: raw.url,
    atsKind: null,
    atsRef: null,
    postedAt,
    dateFidelity: postedAt ? "true" : "none",
  };
}

/** Uses Careerjet's publisher API; each call requires the real viewer IP and UA. */
export async function fetchCareerjet(
  profile: ParsedProfile,
  access: CareerjetAccess,
  fetcher: typeof fetch = fetch,
): Promise<NormalizedJob[]> {
  const keywords = [...new Set([
    ...(profile.targetRoles ?? []),
    ...profile.titlesAccept,
    "software developer",
  ].map((item) => item.trim()).filter(Boolean))].slice(0, 3);

  const search = async (term: string): Promise<CareerjetRawJob[]> => {
    const jobs: CareerjetRawJob[] = [];
    let pages = 1;
    for (let page = 1; page <= pages && page <= 10; page += 1) {
      const url = new URL("https://search.api.careerjet.net/v4/query");
      url.search = new URLSearchParams({
        locale_code: "en_IN",
        keywords: term,
        sort: "date",
        page: String(page),
        page_size: "100",
        fragment_size: "2000",
        user_ip: access.userIp,
        user_agent: access.userAgent,
      }).toString();
      const response = await fetcher(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${access.apiKey}:`).toString("base64")}`,
          Referer: access.referer,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Careerjet: HTTP ${response.status}`);
      const body = (await response.json()) as CareerjetResponse;
      jobs.push(...(body.jobs ?? []));
      pages = Math.min(10, Math.max(1, Number(body.pages) || 1));
    }
    return jobs;
  };

  const results = await Promise.allSettled(keywords.map(search));
  const rawJobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!rawJobs.length && results.length) {
    const failure = results.find((result) => result.status === "rejected");
    throw failure?.status === "rejected" ? failure.reason : new Error("Careerjet returned no jobs");
  }
  const jobs = new Map<string, NormalizedJob>();
  for (const raw of rawJobs) {
    const job = normalizeCareerjet(raw);
    if (job) jobs.set(job.key.slugKey, job);
  }
  return [...jobs.values()];
}
