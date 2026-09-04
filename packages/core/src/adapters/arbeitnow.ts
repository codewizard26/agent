import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
import type { NormalizedJob } from "../types.js";

export interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  location: string;
  created_at: number; // seconds
  tags?: string[];
}

export function normalizeArbeitnow(raw: ArbeitnowJob): NormalizedJob {
  return {
    key: buildJobKey({
      company: raw.company_name,
      title: raw.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "arbeitnow",
    company: raw.company_name,
    title: raw.title,
    locationRaw: raw.location,
    remote: raw.remote,
    locationRestrictions: [],
    descriptionText: htmlToText(raw.description),
    applyUrl: raw.url,
    atsKind: null,
    atsRef: null,
    postedAt: new Date(raw.created_at * 1000),
    dateFidelity: "true",
  };
}

export async function fetchArbeitnow(): Promise<ArbeitnowJob[]> {
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
  if (!res.ok) throw new Error(`arbeitnow: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: ArbeitnowJob[] };
  return body.data ?? [];
}
