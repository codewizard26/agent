import { buildJobKey } from "../job-key.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "./greenhouse.js";

const ORIGIN = "https://remotefirstjobs.com";
const MAX_FEEDS = 6;

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

function readTag(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i").exec(xml);
  return match ? decodeXml(match[1]!) : "";
}

export interface RemoteFirstJobsItem {
  title: string;
  description: string;
  link: string;
  guid: string;
  pubDate: string;
}

export function parseRemoteFirstJobsFeed(xml: string): RemoteFirstJobsItem[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const title = readTag(item!, "title");
    const link = readTag(item!, "link");
    if (!title || !link) return [];
    return [{
      title,
      description: readTag(item!, "description") || readTag(item!, "content:encoded"),
      link,
      guid: readTag(item!, "guid") || link,
      pubDate: readTag(item!, "pubDate"),
    }];
  });
}

export function normalizeRemoteFirstJobs(raw: RemoteFirstJobsItem): NormalizedJob {
  // The feed combines title and employer in some items ("Role at Company");
  // preserve the complete title if it does not provide that separator.
  const split = /^(.*?)\s+at\s+(.+)$/i.exec(raw.title);
  const title = split?.[1]?.trim() || raw.title;
  const company = split?.[2]?.trim() || "Remote First Jobs listing";
  const postedAt = raw.pubDate ? new Date(raw.pubDate) : null;
  const validDate = postedAt && Number.isFinite(postedAt.getTime()) ? postedAt : null;
  return {
    key: buildJobKey({ company, title, atsKind: null, atsRef: null }),
    sourceKind: "remotefirstjobs",
    company,
    title,
    locationRaw: "Remote",
    remote: true,
    locationRestrictions: [],
    descriptionText: htmlToText(raw.description),
    applyUrl: raw.link,
    atsKind: null,
    atsRef: null,
    postedAt: validDate,
    dateFidelity: validDate ? "true" : "none",
  };
}

export async function fetchRemoteFirstJobs(
  profile: ParsedProfile,
  fetcher: typeof fetch = fetch,
): Promise<NormalizedJob[]> {
  const skillSlugs = profile.coreStack
    .map((skill) => skill.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter((slug) => slug.length >= 3);
  const feeds = [...new Set(["software-development", ...skillSlugs])].slice(0, MAX_FEEDS);
  const responses = await Promise.allSettled(feeds.map(async (slug) => {
    const response = await fetcher(`${ORIGIN}/rss/jobs/${encodeURIComponent(slug)}.rss`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Remote First Jobs (${slug}): HTTP ${response.status}`);
    return parseRemoteFirstJobsFeed(await response.text());
  }));
  const successful = responses.flatMap((response) => response.status === "fulfilled" ? response.value : []);
  if (!successful.length && responses.length) {
    const firstFailure = responses.find((response) => response.status === "rejected");
    throw firstFailure?.status === "rejected" ? firstFailure.reason : new Error("Remote First Jobs: empty feed");
  }
  const jobs = new Map<string, NormalizedJob>();
  for (const item of successful) {
    const job = normalizeRemoteFirstJobs(item);
    jobs.set(job.key.slugKey, job);
  }
  return [...jobs.values()];
}
