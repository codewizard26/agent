import { z } from "zod";
import { buildJobKey } from "../job-key.js";
import type { LlmClient } from "../llm.js";
import type { ParsedProfile } from "../resume.js";
import { deriveRoleFamilies } from "../roles.js";
import type { NormalizedJob } from "../types.js";

const FoundJobsSchema = z.object({
  jobs: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string(),
      remote: z.boolean(),
      applyUrl: z.string(),
      /** ISO date if the page stated one, else an empty string. */
      postedAtIso: z.string(),
      sourcePage: z.string(),
    }),
  ),
});

function recencyPhrase(timeFrameDays: number | null): string {
  if (timeFrameDays === null) return "";
  if (timeFrameDays <= 1) return " posted in the past 24 hours";
  return ` posted in the past ${timeFrameDays} days`;
}

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
export function buildSearchQueries(
  profile: ParsedProfile,
  timeFrameDays: number | null,
): string[] {
  const stack = profile.coreStack.slice(0, 4).join(" ");
  const seniority = profile.titlesAccept.slice(0, 3).join(" OR ");
  const roles = deriveRoleFamilies(profile);
  const roleOr = roles.map((r) => `"${r}"`).join(" OR ");
  const primary = roles[roles.length - 1] ?? "software engineer";
  const recency = recencyPhrase(timeFrameDays);

  return [
    // LinkedIn and Naukri first — they carry the most India postings of any
    // site here, and they are reachable no other way.
    `site:linkedin.com/jobs ${roleOr} ${stack} India${recency}`,
    // Naukri gets a deliberately loose query. Its listing pages are thinly
    // indexed — a probe on 2026-08-31 returned nothing for
    // `site:naukri.com "software engineer" India` and nothing for a
    // stack-qualified variant, but did return a listing for the bare
    // `site:naukri.com frontend developer jobs`. Quoting the role chain and
    // appending stack terms and a recency phrase over-constrains it to zero.
    `site:naukri.com ${primary} jobs India`,
    `site:wellfound.com OR site:hirist.tech OR site:cutshort.io ${roleOr} ${stack} India${recency}`,
    `${seniority} ${roleOr} jobs India Bangalore Hyderabad Pune ${stack}${recency}`,
    `remote ${seniority} ${roleOr} jobs ${stack} hiring from India${recency}`,
    `site:x.com OR site:twitter.com "we're hiring" OR "we are hiring" ${primary} ${stack}${recency}`,
    `"now hiring" ${primary} ${stack} apply${recency}`,
  ];
}

/**
 * Two calls by design: one search call that reads the web, then one extraction
 * call that structures what it found. Keeping them separate avoids relying on
 * an undocumented interaction between server tools and output_config.format.
 */
export async function fetchViaWebSearch(
  profile: ParsedProfile,
  timeFrameDays: number | null,
  client: LlmClient,
): Promise<NormalizedJob[]> {
  const queries = buildSearchQueries(profile, timeFrameDays);

  const findings = await client.searchWeb({
    maxSearches: 8,
    prompt:
      "Search the web for currently-open job postings matching this " +
      `candidate. Run these searches:\n${queries.map((q) => `- ${q}`).join("\n")}\n\n` +
      "For each real posting you find, note the company, exact role title, " +
      "location, whether it is remote, the direct application URL, the date " +
      "it was posted if the page states one, and the page you found it on. " +
      "Skip aggregator index pages, listicles, and posts that are not a " +
      "specific open role. Skip anything that is not a software engineering " +
      "role — no sales, solutions, support, recruiting, marketing or " +
      "non-software engineering positions, however well the company matches." +
      "\n\nCANDIDATE\n" +
      `Target roles: ${deriveRoleFamilies(profile).join(", ")}\n` +
      `Target seniority: ${profile.seniorityBands.join(", ")}\n` +
      `Core stack: ${profile.coreStack.join(", ")}`,
  });

  if (!findings.trim()) return [];

  const found = await client.parse({
    schema: FoundJobsSchema,
    schemaName: "found_jobs",
    tier: "utility",
    maxOutputTokens: 16000,
    prompt:
      "Convert these search findings into structured job rows. Use an empty " +
      "string for postedAtIso when no date was stated — do not guess one.\n\n" +
      findings,
  });

  if (!found) return [];

  return found.jobs
    .filter((j) => j.applyUrl && j.company && j.title)
    .map((j): NormalizedJob => {
      const parsedDate = j.postedAtIso ? new Date(j.postedAtIso) : null;
      const validDate =
        parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
      return {
        key: buildJobKey({
          company: j.company,
          title: j.title,
          atsKind: null,
          atsRef: null,
        }),
        sourceKind: "websearch",
        company: j.company,
        title: j.title,
        locationRaw: j.location,
        remote: j.remote,
        locationRestrictions: [],
        // Empty, not a provenance sentence. A search result carries no job
        // description, and writing prose here made the row look like it had
        // one — the stack filter then read that sentence, found no React or
        // Node in it, and rejected every LinkedIn and Naukri posting on
        // evidence that was never there. Provenance is already in
        // `sourceKind` and the apply URL.
        descriptionText: "",
        applyUrl: j.applyUrl,
        atsKind: null,
        atsRef: null,
        postedAt: validDate,
        // A date read off a page is weaker evidence than a machine field.
        dateFidelity: validDate ? "reported" : "none",
      };
    });
}
