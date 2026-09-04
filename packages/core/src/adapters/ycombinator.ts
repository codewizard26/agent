import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

/**
 * Y Combinator's own job board.
 *
 * The page is an Inertia.js app: the server renders the listing into a
 * `data-page` attribute as HTML-escaped JSON, so the postings arrive without
 * running any JavaScript. No API key, no login.
 *
 * Scope is set by their robots.txt, which allows `/jobs` and disallows
 * `/companies?*`. The three paths below are therefore the whole compliant
 * surface — the full catalogue lives behind workatastartup.com, which needs an
 * account and is not fetched here.
 */

export interface YcJobPosting {
  id: number;
  title: string;
  /** Path to the public job page, e.g. "/companies/acme/jobs/abc-engineer". */
  url: string;
  location: string;
  companyName?: string;
  companyOneLiner?: string;
  type?: string;
  prettyRole?: string;
  roleSpecificType?: string;
  salaryRange?: string;
  minExperience?: string;
  /** Free text such as "US citizen/visa only" — read by the sponsorship gate. */
  visa?: string;
  skills?: string[];
  /** Prose age, e.g. "19 days". Not a timestamp. */
  createdAt?: string;
}

const ORIGIN = "https://www.ycombinator.com";

/** Landing page plus the two filters that matter to an India-priority profile. */
export const YC_PATHS = [
  "/jobs",
  "/jobs/location/india",
  "/jobs/role/software-engineer",
] as const;

const UNITS: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/**
 * "19 days" -> a Date. YC states an age, not a timestamp, so every date this
 * produces is `dateFidelity: "reported"`.
 *
 * Unreadable prose returns null rather than a guess: a wrong date silently
 * moves a posting in or out of the caller's time window, which is worse than
 * having no date at all — the filter already knows how to handle none.
 */
export function parseRelativeAge(text: string, now: Date): Date | null {
  const match = /^\s*(\d+)\s+(hour|day|week|month|year)s?\s*$/i.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = UNITS[match[2]!.toLowerCase()];
  if (!unit) return null;
  return new Date(now.getTime() - amount * unit);
}

/**
 * Pulls the posting list out of the rendered page. A markup change that drops
 * the attribute yields an empty list, so YC reports as an empty source rather
 * than failing the fetch it is one of seventy participants in.
 */
export function extractYcPayload(html: string): YcJobPosting[] {
  const match = /data-page="([^"]+)"/.exec(html);
  if (!match) return [];
  const json = match[1]!
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  try {
    const parsed = JSON.parse(json) as { props?: { jobPostings?: YcJobPosting[] } };
    return parsed.props?.jobPostings ?? [];
  } catch {
    return [];
  }
}

export function normalizeYc(raw: YcJobPosting, now: Date = new Date()): NormalizedJob {
  const company = raw.companyName ?? "unknown";
  // Everything the listing states, in one block. The ranker and the filter both
  // read `descriptionText`, and `visa` in particular is what the work
  // authorization gate keys off — dropping it would let a "US citizen only"
  // role through to an India-based candidate's board.
  const description = [
    raw.companyOneLiner,
    raw.prettyRole && `Role: ${raw.prettyRole}${raw.roleSpecificType ? ` (${raw.roleSpecificType})` : ""}`,
    raw.type && `Type: ${raw.type}`,
    raw.minExperience && `Experience: ${raw.minExperience}`,
    raw.salaryRange && `Salary: ${raw.salaryRange}`,
    raw.visa && `Visa: ${raw.visa}`,
    raw.skills?.length ? `Skills: ${raw.skills.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const postedAt = raw.createdAt ? parseRelativeAge(raw.createdAt, now) : null;

  return {
    key: buildJobKey({ company, title: raw.title, atsKind: null, atsRef: null }),
    sourceKind: "ycombinator",
    company,
    title: raw.title,
    locationRaw: raw.location,
    remote: /remote/i.test(raw.location),
    locationRestrictions: [],
    descriptionText: description,
    // The payload's applyUrl is an account.ycombinator.com redirect carrying a
    // signup id; the public job page is what a person can actually open.
    applyUrl: raw.url.startsWith("http") ? raw.url : `${ORIGIN}${raw.url}`,
    atsKind: null,
    atsRef: null,
    postedAt,
    dateFidelity: postedAt ? "reported" : "none",
  };
}

async function fetchPath(path: string): Promise<YcJobPosting[]> {
  const res = await fetch(`${ORIGIN}${path}`, {
    headers: { "User-Agent": "job-agent (personal job search)" },
  });
  if (!res.ok) throw new Error(`ycombinator: HTTP ${res.status} for ${path}`);
  return extractYcPayload(await res.text());
}

/**
 * All three lists, deduped by posting id. They overlap heavily by design — the
 * India list and the engineering list both include India-based engineering
 * roles, which is exactly the intersection this feed wants.
 */
export async function fetchYcombinator(): Promise<YcJobPosting[]> {
  const settled = await Promise.allSettled(YC_PATHS.map(fetchPath));
  const byId = new Map<number, YcJobPosting>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const posting of result.value) byId.set(posting.id, posting);
  }
  // Every path failing is a real failure; a partial one is just a smaller list.
  if (byId.size === 0 && settled.every((r) => r.status === "rejected")) {
    throw new Error("ycombinator: every listing path failed");
  }
  return [...byId.values()];
}
