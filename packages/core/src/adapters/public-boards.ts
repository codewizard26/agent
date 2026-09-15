import { buildJobKey } from "../job-key.js";
import { isEngineeringRole } from "../roles.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "./greenhouse.js";
import { mapWithConcurrency } from "./index.js";

export type PublicBoard = "builtin" | "bebee" | "indeed";
const ORIGINS: Record<PublicBoard, string> = { builtin: "https://builtin.com", bebee: "https://bebee.com", indeed: "https://in.indeed.com" };
const decode = (text: string) => text.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** JSON-LD can be a single object, an array, or an @graph document. */
export function readJobPosting(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    if ([value["@type"]].flat().includes("JobPosting")) out.push(value);
    if (value["@graph"]) visit(value["@graph"]);
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type=["']application\/ld\+json["']/i.test(decode(match[1]!))) continue;
    try { visit(JSON.parse(match[2]!)); } catch { /* Ignore unrelated malformed metadata. */ }
  }
  return out;
}

export function parsePublicJob(html: string, url: string, board: PublicBoard, now = new Date()): NormalizedJob | null {
  const data = readJobPosting(html)[0];
  if (!data || typeof data.title !== "string" || !data.hiringOrganization?.name) return null;
  if (data.validThrough && Date.parse(data.validThrough) < now.getTime()) return null;
  const internship = /intern/i.test(String(data.employmentType ?? ""));
  const title = data.title + (internship && !/\bintern/i.test(data.title) ? " Intern" : "");
  const company = String(data.hiringOrganization.name);
  const locations = [data.jobLocation ?? []].flat().map((place: any) => {
    const address = place?.address;
    if (typeof address === "string") return address;
    return [address?.addressLocality, address?.addressRegion, typeof address?.addressCountry === "string" ? address.addressCountry : address?.addressCountry?.name].filter(Boolean).join(", ");
  }).filter(Boolean);
  const remote = data.jobLocationType === "TELECOMMUTE" || locations.some((location: string) => /\bremote\b/i.test(location));
  const restrictions = [data.applicantLocationRequirements ?? []].flat().map((place: any) => typeof place === "string" ? place : place?.name).filter(Boolean);
  const timestamp = Date.parse(data.datePosted);
  return {
    key: buildJobKey({ company, title, atsKind: null, atsRef: null }), sourceKind: board,
    company, title, locationRaw: locations.join(" / ") || (remote ? "Remote" : ""), remote,
    locationRestrictions: restrictions, descriptionText: htmlToText(data.description ?? ""),
    applyUrl: url, atsKind: null, atsRef: null,
    postedAt: Number.isFinite(timestamp) ? new Date(timestamp) : null,
    dateFidelity: Number.isFinite(timestamp) ? "true" : "none",
  };
}

export function publicJobLinks(html: string, board: PublicBoard): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(decode(match[1]!), ORIGINS[board]); } catch { continue; }
    if (url.origin !== ORIGINS[board]) continue;
    const isDetail = board === "builtin" ? /^\/job\/[^/]+\/\d+\/?$/.test(url.pathname)
      : board === "bebee" ? /^\/in\/jobs\/[^/]+--[^/]+$/.test(url.pathname)
      : url.pathname === "/viewjob" && url.searchParams.has("jk");
    if (!isDetail) continue;
    // beBee marks these syndicated redirect-only pages as unavailable to crawlers.
    if (board === "bebee" && /--(?:buscojob|clickajo|jvers|j-vers|jobget|jblead|jobleads|jobrapid|tideri|whatjobs|yadajobs)-/.test(url.pathname)) continue;
    if (!isEngineeringRole(htmlToText(match[2]!))) continue;
    if (board !== "indeed") url.search = "";
    links.push(url.href);
  }
  return [...new Set(links)];
}

export async function readPublicPage(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await fetcher(url, { signal });
  if ([401, 403, 429].includes(response.status)) throw new Error(`Direct access blocked (HTTP ${response.status}); login, security check or rate limit. Open this board manually.`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (/<title[^>]*>[^<]*(?:security check|just a moment|access denied)/i.test(html)) throw new Error("Direct access blocked by a security check. Open this board manually.");
  return html;
}

/** Crawl public category pages and observed detail links, with bounded concurrency. */
export async function fetchPublicBoard(board: PublicBoard, options: {
  fetcher?: typeof fetch; maxDetails?: number; pages?: string[];
} = {}): Promise<NormalizedJob[]> {
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(100_000);
  const defaults: Record<PublicBoard, string[]> = {
    builtin: ["/jobs/dev-engineering/search/software-engineer", "/jobs/dev-engineering/search/full-stack-developer", "/jobs/dev-engineering/search/backend-developer"],
    bebee: ["/in/jobs/role/software-engineer/noida", "/in/jobs/role/frontend-developer", "/in/jobs/role/full-stack-developer", "/in/jobs/role/software-engineer"],
    indeed: ["/jobs?q=software+intern&l=India", "/jobs?q=frontend+developer&l=India"],
  };
  const pages = (options.pages ?? defaults[board]).map((path) => new URL(path, ORIGINS[board]).href);
  // One request first: stop immediately on access challenges instead of retrying them.
  const first = await readPublicPage(pages[0]!, fetcher, signal);
  const remaining = await mapWithConcurrency(pages.slice(1), 2, (url) => readPublicPage(url, fetcher, signal));
  const batches = [first, ...remaining.flatMap((r) => r.status === "fulfilled" ? [r.value] : [])].map((html) => publicJobLinks(html, board));
  const links = new Set<string>();
  for (let index = 0; index < Math.max(0, ...batches.map((batch) => batch.length)); index++) {
    for (const batch of batches) if (batch[index]) links.add(batch[index]!);
  }
  if (!links.size) throw new Error("No public job links found; this board may require login or its page layout changed.");
  const details = await mapWithConcurrency([...links].slice(0, options.maxDetails ?? 40), 3, async (url) => parsePublicJob(await readPublicPage(url, fetcher, signal), url, board));
  const jobs = details.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : []);
  if (!jobs.length) throw new Error("No readable active job details; public structured job data is unavailable.");
  const failures = [...remaining, ...details].filter((r) => r.status === "rejected").length;
  if (failures) console.warn(`${board}: ${failures} pages failed; returning ${jobs.length} postings`);
  return jobs;
}
