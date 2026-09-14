import { buildJobKey } from "../job-key.js";
import { isEngineeringRole } from "../roles.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "./greenhouse.js";
import { mapWithConcurrency } from "./index.js";

const ORIGIN = "https://www.carrerlift.in";

/** Follow only observed public listing links, never scripts or private APIs. */
export function parseCarrerliftLinks(html: string): string[] {
  const links = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .flatMap((heading) => [...heading[1]!.matchAll(/<a\b[^>]*href="(\/jobs\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi)]);
  return [...new Set(links.filter((match) => isEngineeringRole(htmlToText(match[2]!)))
    .map((match) => new URL(match[1]!, ORIGIN).href))];
}

export function parseCarrerliftJob(html: string, url: string, now = new Date()): NormalizedJob | null {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(match[1]!); } catch { continue; }
    if (!data || data["@type"] !== "JobPosting" || !data.title || !data.hiringOrganization?.name) continue;
    if (data.validThrough && new Date(data.validThrough).getTime() < now.getTime()) return null;
    const internship = /intern/i.test(data.employmentType ?? "");
    const title = String(data.title) + (internship && !/\bintern/i.test(data.title) ? " Intern" : "");
    const company = String(data.hiringOrganization.name);
    const location = data.jobLocation?.address?.addressLocality ?? "";
    const remote = data.jobLocationType === "TELECOMMUTE" || /\bremote\b/i.test(location);
    const postedAt = data.datePosted ? new Date(data.datePosted) : null;
    return {
      key: buildJobKey({ company, title, atsKind: null, atsRef: null }),
      sourceKind: "carrerlift", company, title, locationRaw: String(location || (remote ? "Remote" : "")), remote,
      locationRestrictions: [],
      descriptionText: htmlToText(String(data.description ?? "")),
      // The public detail page carries the original apply link and full context.
      applyUrl: url, atsKind: null, atsRef: null,
      postedAt: postedAt && Number.isFinite(postedAt.getTime()) ? postedAt : null,
      dateFidelity: postedAt && Number.isFinite(postedAt.getTime()) ? "true" : "none",
    };
  }
  return null;
}

export async function fetchCarrerlift(profile: ParsedProfile, options: {
  fetcher?: typeof fetch; maxDetails?: number; pagesPerQuery?: number;
} = {}): Promise<NormalizedJob[]> {
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(110_000);
  const read = async (url: string) => {
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error(`carrerlift: HTTP ${response.status}`);
    return response.text();
  };
  // Public search prevents a latest-only page from burying relevant older roles.
  const queries = [...new Set(["software", "intern", ...profile.coreStack.slice(0, 3).map((skill) => skill.replace(/\.js$/i, ""))])];
  const pages = queries.flatMap((q) => Array.from({ length: options.pagesPerQuery ?? 2 }, (_, index) =>
    `${ORIGIN}/jobs?${new URLSearchParams({ q, page: String(index + 1) })}`));
  const listings = await mapWithConcurrency(pages, 3, read);
  if (listings.every((result) => result.status === "rejected")) throw new Error("carrerlift: all listing pages failed");
  const batches = listings.flatMap((result) => result.status === "fulfilled" ? [parseCarrerliftLinks(result.value)] : []);
  // Interleave query pages so the cap cannot be consumed by the first search.
  const unique = new Set<string>();
  for (let index = 0; index < Math.max(0, ...batches.map((batch) => batch.length)); index++) {
    for (const batch of batches) if (batch[index]) unique.add(batch[index]!);
  }
  const links = [...unique].slice(0, options.maxDetails ?? 100);
  if (!links.length) throw new Error("carrerlift: no job links found; listing markup or search results may have changed");
  const details = await mapWithConcurrency(links, 5, async (url) => {
    const job = parseCarrerliftJob(await read(url), url);
    if (!job) return null;
    return job;
  });
  const jobs = details.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (!jobs.length) throw new Error("carrerlift: no active job details could be parsed");
  const failed = listings.filter((r) => r.status === "rejected").length + details.filter((r) => r.status === "rejected").length;
  if (failed) console.warn(`carrerlift: ${failed} pages failed; returning ${jobs.length} verified postings`);
  return jobs;
}
