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
      descriptionText: z.string(),
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
 * The `site:` queries reach boards without an open search API through pages a
 * search engine has indexed. This can surface relevant postings, but it cannot
 * guarantee complete coverage. Nothing here logs into a board or fetches those
 * sites directly.
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
    `${roleOr} jobs (Gurugram OR Gurgaon OR Noida OR Delhi) ${profile.yearsExperience < 2 ? 'fresher "0-2 years"' : stack}${recency}`,
    // Search the largest India boards separately with broad terms: long OR
    // chains plus stack requirements tend to hide otherwise relevant results.
    `site:linkedin.com/jobs ${primary} jobs India ${stack}${recency}`,
    `site:linkedin.com/jobs ${roleOr} India${recency}`,
    // Naukri gets a deliberately loose query. Its listing pages are thinly
    // indexed — a probe on 2026-08-31 returned nothing for
    // `site:naukri.com "software engineer" India` and nothing for a
    // stack-qualified variant, but did return a listing for the bare
    // `site:naukri.com frontend developer jobs`. Quoting the role chain and
    // appending stack terms and a recency phrase over-constrains it to zero.
    `site:naukri.com ${primary} jobs India`,
    `site:naukri.com/job-listings ${roleOr} (Bengaluru OR Bangalore OR Hyderabad OR Pune OR Gurgaon OR Noida)${recency}`,
    `site:glassdoor.co.in/Job OR site:glassdoor.com/Job ${primary} India${recency}`,
    `site:in.indeed.com/viewjob OR site:in.indeed.com/jobs ${primary} India${recency}`,
    `site:dice.com/job-detail OR site:ziprecruiter.com/jobs ${primary} India remote${recency}`,
    `site:wellfound.com OR site:cutshort.io ${roleOr} ${stack} India${recency}`,
    `site:hirist.tech ${primary} jobs India${recency}`,
    `site:foundit.in OR site:timesjobs.com OR site:shine.com OR site:freshersworld.com ${primary} jobs India${recency}`,
    `${seniority} ${roleOr} jobs India Bangalore Hyderabad Pune ${stack}${recency}`,
    `remote ${seniority} ${roleOr} jobs ${stack} (India OR worldwide OR "work from anywhere")${recency}`,
    `site:weworkremotely.com OR site:remote.co OR site:remotive.com ${primary} remote (India OR worldwide OR "work from anywhere")${recency}`,
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
    maxSearches: queries.length,
    prompt:
      "Do not search Carrerlift, Built In, Indeed or beBee: dedicated direct sources handle those boards. " +
      "Search the web for currently-open job postings matching this " +
      `candidate. Run these searches:\n${queries.map((q) => `- ${q}`).join("\n")}\n\n` +
      "For each real posting you find, note the company, exact role title, " +
      "location, whether it is remote, the direct application URL, the date " +
      "it was posted if the page states one, and the page you found it on. " +
      "Read each posting and retain its required skills, minimum experience, " +
      "eligibility, and location restrictions as descriptionText. Never invent missing requirements. " +
      "Skip aggregator index pages, listicles, and posts that are not a " +
      "specific open role. Skip anything that is not a software engineering " +
      "role — no sales, solutions, support, recruiting, marketing or " +
      "non-software engineering positions, however well the company matches." +
      "\n\nCANDIDATE\n" +
      `Target roles: ${deriveRoleFamilies(profile).join(", ")}\n` +
      `Years of experience: ${profile.yearsExperience}\n` +
      (profile.yearsExperience < 2
        ? "Include software internships, fresher jobs or explicit experience requirements entirely within 0–2 years. Exclude unknown experience, open-ended requirements and ranges above 2 years. Preserve the exact experience wording.\n"
        : "") +
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
      "string for postedAtIso when no date was stated — do not guess one. " +
      "Preserve actual job requirements in descriptionText; use an empty string " +
      "if none were found. Never substitute the candidate skills for job requirements.\n\n" +
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
        descriptionText: j.descriptionText ?? "",
        applyUrl: j.applyUrl,
        atsKind: null,
        atsRef: null,
        postedAt: validDate,
        // A date read off a page is weaker evidence than a machine field.
        dateFidelity: validDate ? "reported" : "none",
      };
    });
}
