import { buildJobKey } from "../job-key.js";
import { mapWithConcurrency } from "./index.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "./greenhouse.js";

type FeedSource = "offcampusjobs4u" | "hasjob";
type CommunitySource = FeedSource | "jobtankindia";

interface FeedItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  date: string;
  company?: string;
  location?: string;
}

interface JobPostingJsonLd {
  "@type"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
  jobLocationType?: string;
  applicantLocationRequirements?: { name?: string } | { name?: string }[];
  identifier?: { value?: string };
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function xmlTag(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(xml);
  return match ? decodeXml(match[1]!) : "";
}

export function parseCommunityRss(xml: string): FeedItem[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(([, body]) => {
    const title = xmlTag(body!, "title");
    const link = xmlTag(body!, "link");
    if (!title || !link) return [];
    return [{
      title,
      link,
      guid: xmlTag(body!, "guid") || link,
      description: xmlTag(body!, "content:encoded") || xmlTag(body!, "description"),
      date: xmlTag(body!, "pubDate") || xmlTag(body!, "dc:date"),
      company: companyFromTitle(title),
    }];
  });
}

function parseAtom(xml: string): FeedItem[] {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].flatMap(([, body]) => {
    const title = xmlTag(body!, "title");
    const href = /<link\b[^>]*href=["']([^"']+)["']/i.exec(body!)?.[1];
    const link = href ? decodeXml(href) : "";
    if (!title || !link) return [];
    return [{
      title,
      link,
      guid: xmlTag(body!, "id") || link,
      description: xmlTag(body!, "content") || xmlTag(body!, "summary"),
      date: xmlTag(body!, "published") || xmlTag(body!, "updated"),
      company: xmlTag(body!, "company") || companyFromHasjob(body!, xmlTag(body!, "content") || xmlTag(body!, "summary")),
      location: xmlTag(body!, "location"),
    }];
  });
}

function validDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function companyFromTitle(title: string): string | undefined {
  const at = /\s+at\s+(.+)$/i.exec(title)?.[1]?.trim();
  if (at) return at;
  const prefix = /^(.+?)\s+(?:recruitment|hiring|internship|off\s*campus|walk[- ]in)\b/i.exec(title)?.[1]?.trim();
  return prefix || undefined;
}

function companyFromHasjob(entry: string, content: string): string | undefined {
  const strong = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(content)?.[1];
  if (strong) {
    const company = htmlToText(strong).trim();
    if (company) return company;
  }
  const host = /<id>https?:\/\/hasjob\.co\/([^/]+)\//i.exec(entry)?.[1];
  return host?.replace(/\.(com|in|io|co|org|net)$/i, "").replace(/[._-]+/g, " ");
}

export function normalizeCommunityFeedItem(item: FeedItem, source: FeedSource): NormalizedJob {
  const titleMatch = /^(.*?)\s+at\s+(.+)$/i.exec(item.title);
  const title = titleMatch?.[1]?.trim() || item.title;
  const company = titleMatch?.[2]?.trim() || item.company || (source === "hasjob" ? "Hasjob listing" : "OffCampusJobs4u listing");
  const postedAt = validDate(item.date);
  return {
    key: buildJobKey({ company, title, atsKind: null, atsRef: null }),
    sourceKind: source,
    company,
    title,
    locationRaw: item.location || "India / see listing",
    remote: /remote|work\s+from\s+home/i.test(item.title + " " + item.description),
    locationRestrictions: source === "offcampusjobs4u" ? ["India"] : [],
    descriptionText: htmlToText(item.description),
    applyUrl: item.link,
    atsKind: null,
    atsRef: null,
    postedAt,
    dateFidelity: postedAt ? "true" : "none",
  };
}

const FEED_URLS: Record<FeedSource, string> = {
  offcampusjobs4u: "https://offcampusjobs4u.com/feed/",
  hasjob: "https://hasjob.co/feed",
};

async function fetchFeed(source: FeedSource, fetcher: typeof fetch): Promise<NormalizedJob[]> {
  const response = await fetcher(FEED_URLS[source], {
    headers: { "User-Agent": "job-agent/1.0 (+job listing feed reader)" },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  const xml = await response.text();
  const items = source === "hasjob" ? parseAtom(xml) : parseCommunityRss(xml);
  return items.map((item) => normalizeCommunityFeedItem(item, source));
}

function jsonLdPostings(html: string): JobPostingJsonLd[] {
  const postings: JobPostingJsonLd[] = [];
  for (const [, raw] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let value: unknown;
    try { value = JSON.parse(raw!); } catch { continue; }
    const values = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)["@graph"])
      ? (value as { "@graph": unknown[] })["@graph"] : [value];
    for (const row of values) {
      if (row && typeof row === "object" && (row as JobPostingJsonLd)["@type"] === "JobPosting") postings.push(row as JobPostingJsonLd);
    }
  }
  return postings;
}

function parseJobTankCards(html: string): { url: string; date: Date | null }[] {
  const items: { url: string; date: Date | null }[] = [];
  for (const [, href, card] of html.matchAll(/<a\b[^>]*href=["'](\/(?:experienced-job-detaild-pages|freshers-job)\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = htmlToText(card!);
    if (!/\bopen\b/i.test(text) || /\bclosed\b/i.test(text)) continue;
    const dateText = /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/.exec(text)?.[0];
    items.push({ url: new URL(href!, "https://www.jobtankindia.com").href, date: validDate(dateText ? new Date(dateText).toISOString() : undefined) });
  }
  return items;
}

async function fetchJobTankIndia(fetcher: typeof fetch): Promise<NormalizedJob[]> {
  const cities = ["bangalore", "hyderabad", "pune", "mumbai", "delhi-ncr", "chennai", "kolkata", "ahmedabad", "remote"];
  const listingResults = await mapWithConcurrency(cities, 3, async (city) => {
    const response = await fetcher(`https://www.jobtankindia.com/jobs/in/${city}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; job-agent/1.0)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`jobtankindia (${city}): HTTP ${response.status}`);
    return parseJobTankCards(await response.text());
  });
  const candidates = listingResults
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .reduce((all, item) => all.some((existing) => existing.url === item.url) ? all : [...all, item], [] as { url: string; date: Date | null }[])
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, 35);
  if (!candidates.length && listingResults.every((result) => result.status === "rejected")) {
    const first = listingResults.find((result) => result.status === "rejected");
    if (first?.status === "rejected") throw first.reason;
  }
  const details = await mapWithConcurrency(candidates, 5, async ({ url, date }) => {
    const detail = await fetcher(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; job-agent/1.0)" },
      signal: AbortSignal.timeout(14_000),
    });
    if (!detail.ok) throw new Error(`jobtankindia detail: HTTP ${detail.status}`);
    const html = await detail.text();
    return jsonLdPostings(html).flatMap((posting) => {
      const company = posting.hiringOrganization?.name?.trim();
      const title = posting.title?.trim();
      if (!company || !title) return [];
      if (posting.validThrough) {
        const deadline = new Date(posting.validThrough);
        if (Number.isFinite(deadline.getTime()) && deadline.getTime() < Date.now()) return [];
      }
      const address = posting.jobLocation?.address;
      const restrictions = (Array.isArray(posting.applicantLocationRequirements)
        ? posting.applicantLocationRequirements
        : posting.applicantLocationRequirements ? [posting.applicantLocationRequirements] : [])
        .flatMap((location) => location.name ? [location.name] : []);
      const location = [address?.addressLocality, address?.addressRegion, address?.addressCountry]
        .filter(Boolean).join(", ") || restrictions.join(", ") || "India";
      const postedAt = validDate(posting.datePosted) ?? date;
      const externalApply = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>\s*Apply(?:\s+Now)?\s*<\/a>/i.exec(html)?.[1];
      const job: NormalizedJob = {
        key: buildJobKey({ company, title, atsKind: null, atsRef: posting.identifier?.value ?? null }),
        sourceKind: "jobtankindia",
        company,
        title,
        locationRaw: location,
        remote: posting.jobLocationType === "TELECOMMUTE" || /remote/i.test(location),
        locationRestrictions: restrictions.length ? restrictions : ["India"],
        descriptionText: htmlToText(posting.description ?? ""),
        applyUrl: externalApply ? decodeXml(externalApply) : url,
        atsKind: null,
        atsRef: posting.identifier?.value ?? null,
        postedAt,
        dateFidelity: posting.datePosted && validDate(posting.datePosted) ? "true" : date ? "reported" : "none",
      };
      return [job];
    });
  });
  const jobs = details.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!jobs.length && candidates.length === 0) throw new Error("jobtankindia: no open job cards found");
  if (!jobs.length && candidates.length > 0) {
    const failure = details.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  const failures = details.filter((result) => result.status === "rejected").length;
  if (failures) console.warn(`jobtankindia: ${failures} of ${candidates.length} detail pages failed`);
  const listingFailures = listingResults.filter((result) => result.status === "rejected").length;
  if (listingFailures) console.warn(`jobtankindia: ${listingFailures} of ${cities.length} city pages failed`);
  return [...new Map(jobs.map((job) => [job.key.slugKey, job])).values()];
}

export async function fetchIndiaCommunityJobs(
  source: CommunitySource,
  fetcher: typeof fetch = fetch,
): Promise<NormalizedJob[]> {
  if (source === "jobtankindia") return fetchJobTankIndia(fetcher);
  return fetchFeed(source, fetcher);
}
