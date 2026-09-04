import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
import type { NormalizedJob } from "../types.js";

export interface RemoteOkJob {
  id?: string;
  slug?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  epoch?: number; // seconds
  tags?: string[];
}

/** Returns null for rows that are not job postings (element 0 is a legal notice). */
export function normalizeRemoteOk(raw: RemoteOkJob): NormalizedJob | null {
  if (!raw.position || !raw.company) return null;
  return {
    key: buildJobKey({
      company: raw.company,
      title: raw.position,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "remoteok",
    company: raw.company,
    title: raw.position,
    locationRaw: raw.location ?? "Remote",
    remote: true, // every RemoteOK posting is remote by definition
    locationRestrictions: [],
    descriptionText: raw.description ? htmlToText(raw.description) : "",
    applyUrl: raw.apply_url ?? raw.url ?? "",
    atsKind: null,
    atsRef: null,
    postedAt: raw.epoch ? new Date(raw.epoch * 1000) : null,
    dateFidelity: "true",
  };
}

export async function fetchRemoteOk(): Promise<RemoteOkJob[]> {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "job-agent" },
  });
  if (!res.ok) throw new Error(`remoteok: HTTP ${res.status}`);
  return (await res.json()) as RemoteOkJob[];
}
