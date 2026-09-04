/**
 * Deep links to the job sites this app deliberately does not ingest.
 *
 * LinkedIn, Naukri and their peers are excluded from the fetch pipeline by
 * design §3 — their terms forbid it, their anti-bot systems defend it, and
 * driving them from a user's own logged-in session risks that account. They
 * stay *manual* discovery surfaces, so the most this app does is hand the user
 * a prefilled search and let them browse and click as themselves.
 *
 * Every function here returns a URL. Nothing fetches, and nothing here is ever
 * called from the server.
 */

/** A profile is a person, so only the two fields these searches key off. */
export interface SearchProfile {
  titlesAccept: string[];
  coreStack: string[];
}

/**
 * LinkedIn and Naukri both accept a bare keyword string. Quoting the multi-word
 * title keywords keeps "new grad" from matching "grad" anywhere in a posting.
 */
function quoteMultiWord(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

function keywordQuery(profile: SearchProfile, titles: number, stack: number): string {
  const titlePart = profile.titlesAccept.slice(0, titles).map(quoteMultiWord).join(" OR ");
  const stackPart = profile.coreStack.slice(0, stack).join(" OR ");
  return [titlePart && `(${titlePart})`, stackPart && `(${stackPart})`]
    .filter(Boolean)
    .join(" ");
}

/** LinkedIn job search, scoped to India, prefilled from the profile. */
export function linkedInJobsUrl(profile: SearchProfile): string {
  const params = new URLSearchParams({
    keywords: keywordQuery(profile, 3, 3),
    location: "India",
  });
  return `https://www.linkedin.com/jobs/search/?${params}`;
}

/**
 * Naukri's keyword field is comma-separated rather than boolean, and its path
 * carries the location. `experience=0` is its fresher filter.
 */
export function naukriJobsUrl(profile: SearchProfile): string {
  const keywords = [...profile.titlesAccept.slice(0, 2), ...profile.coreStack.slice(0, 3)]
    .join(", ")
    .toLowerCase();
  const params = new URLSearchParams({ k: keywords, experience: "0" });
  return `https://www.naukri.com/jobs-in-india?${params}`;
}

/**
 * People at one company on LinkedIn — the list to send connection requests
 * from. Built from the company name alone, which every job row carries, so it
 * never needs a company-page slug that may not exist.
 */
export function linkedInPeopleUrl(company: string): string {
  const params = new URLSearchParams({ keywords: company });
  return `https://www.linkedin.com/search/results/people/?${params}`;
}
