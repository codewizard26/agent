import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

export interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
  location: { name: string };
  /** True first-publish date. THE field to filter on. */
  first_published: string | null;
  /** Reflects edits. Filtering on this reports stale jobs as fresh — never use it. */
  updated_at: string;
}

/** Decode the entities Greenhouse emits, then strip tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeGreenhouse(
  raw: GreenhouseJob,
  token: string,
): NormalizedJob {
  const location = raw.location?.name ?? "";
  return {
    key: buildJobKey({
      company: token,
      title: raw.title,
      atsKind: "greenhouse",
      atsRef: `${token}/${raw.id}`,
    }),
    sourceKind: "greenhouse",
    company: token,
    title: raw.title,
    locationRaw: location,
    remote: /remote/i.test(location) || /remote/i.test(raw.title),
    locationRestrictions: [],
    descriptionText: raw.content ? htmlToText(raw.content) : "",
    applyUrl: raw.absolute_url,
    atsKind: "greenhouse",
    atsRef: `${token}/${raw.id}`,
    // first_published, NOT updated_at. See Global Constraints.
    postedAt: raw.first_published ? new Date(raw.first_published) : null,
    dateFidelity: "true",
  };
}

export async function fetchGreenhouseBoard(token: string): Promise<GreenhouseJob[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  );
  if (!res.ok) throw new Error(`greenhouse ${token}: HTTP ${res.status}`);
  const body = (await res.json()) as { jobs?: GreenhouseJob[] };
  return body.jobs ?? [];
}
