import { isPreferredLocation } from "@job-agent/core/location-priority";

export interface FilterableJob {
  title: string;
  company: string;
  locationRaw: string;
  sourceKind: string;
  remote?: boolean;
  postedAt: string | null;
  rank: { score: number; tier: string } | null;
}
export interface FeedFilters {
  query: string;
  location: string[];
  role: string[];
  source: string[];
  tier: string[];
  employment: string[];
  sort: string;
}
export const DEFAULT_FEED_FILTERS: FeedFilters = {
  employment: [], query: "", location: [], role: [], source: [], tier: [], sort: "ncr",
};
const ROLE_PATTERNS: Record<string, RegExp> = {
  frontend: /front[ -]?end|\bui\b|react|angular|vue/i,
  backend: /back[ -]?end|node|python|java\b|\.net/i,
  fullstack: /full[ -]?stack|mern|mean/i,
  qa: /\bqa\b|test|sdet|quality assurance/i,
  mobile: /mobile|android|ios|react native/i,
  devops: /devops|infrastructure|site reliability|\bsre\b/i,
};
export function filterFeed<T extends FilterableJob>(jobs: T[], filters: FeedFilters): T[] {
  const terms = filters.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = jobs.filter((job) => {
    const text = `${job.title} ${job.company} ${job.locationRaw}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) return false;
    const locationMatches = (location: string) => {
      if (location === "ncr") return isPreferredLocation(job.locationRaw);
      if (location === "other") return !isPreferredLocation(job.locationRaw);
      if (location === "gurugram") return /\b(gurugram|gurgaon)\b/i.test(job.locationRaw);
      if (location === "noida") return /\bnoida\b/i.test(job.locationRaw);
      if (location === "delhi") return /\bdelhi\b/i.test(job.locationRaw);
      if (location === "remote") return job.remote || /\bremote\b/i.test(job.locationRaw);
      return false;
    };
    if (filters.location.length && !filters.location.some(locationMatches)) return false;
    if (filters.source.length && !filters.source.includes(job.sourceKind)) return false;
    if (filters.tier.length && !filters.tier.includes(job.rank?.tier ?? "unranked")) return false;
    if (filters.role.length && !filters.role.some((role) => ROLE_PATTERNS[role]?.test(job.title))) return false;
    const employment = /\bintern(?:ship)?\b/i.test(job.title) ? "internship" : "job";
    if (filters.employment.length && !filters.employment.includes(employment)) return false;
    return true;
  });
  const score = (job: T) => job.rank?.score ?? -1;
  const date = (job: T) => job.postedAt && Number.isFinite(Date.parse(job.postedAt)) ? Date.parse(job.postedAt) : 0;
  return result.sort((a, b) => {
    if (filters.sort === "newest") return date(b) - date(a) || score(b) - score(a);
    if (filters.sort === "ncr") {
      const preference = Number(isPreferredLocation(b.locationRaw)) - Number(isPreferredLocation(a.locationRaw));
      if (preference) return preference;
    }
    return score(b) - score(a) || date(b) - date(a);
  });
}
