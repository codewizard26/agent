import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "./greenhouse.js";

interface IndianApiJob {
  id?: number | string;
  title?: string;
  job_title?: string;
  company?: string;
  job_description?: string;
  about_company?: string;
  role_and_responsibility?: string;
  education_and_skills?: string;
  job_type?: string;
  location?: string;
  experience?: string;
  apply_link?: string;
  posted_date?: string;
}

function normalizeIndianApi(raw: IndianApiJob): NormalizedJob | null {
  const title = raw.title || raw.job_title;
  const company = raw.company;
  if (!title || !company || !raw.apply_link) return null;
  const parsedDate = raw.posted_date ? new Date(raw.posted_date) : null;
  const postedAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
  const descriptionText = [
    raw.job_description,
    raw.about_company,
    raw.role_and_responsibility,
    raw.education_and_skills,
    raw.job_type && `Job type: ${raw.job_type}`,
    raw.experience && `Experience: ${raw.experience}`,
  ].filter(Boolean).map((part) => htmlToText(String(part))).join("\n");
  const location = raw.location ?? "India";
  return {
    key: buildJobKey({ company, title, atsKind: null, atsRef: raw.id ? String(raw.id) : null }),
    sourceKind: "indianapi",
    company,
    title,
    locationRaw: location,
    remote: /remote|work from home/i.test(`${location} ${raw.job_type ?? ""}`),
    locationRestrictions: [],
    descriptionText,
    applyUrl: raw.apply_link,
    atsKind: null,
    atsRef: null,
    postedAt,
    dateFidelity: postedAt ? "true" : "none",
  };
}

/** Fetch the India-focused listings supplied by the IndianAPI jobs aggregator. */
export async function fetchIndianApi(apiKey: string, fetcher: typeof fetch = fetch): Promise<NormalizedJob[]> {
  const url = new URL("https://jobs.indianapi.in/jobs");
  url.searchParams.set("limit", "200");
  const response = await fetcher(url, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`IndianAPI: HTTP ${response.status}`);
  const body = (await response.json()) as IndianApiJob[];
  if (!Array.isArray(body)) throw new Error("IndianAPI: expected a job array");
  return body.flatMap((item) => {
    const job = normalizeIndianApi(item);
    return job ? [job] : [];
  });
}
