import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

export interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt: number; // epoch millis
  descriptionPlain?: string;
  workplaceType?: string;
  categories?: { location?: string; team?: string; commitment?: string };
}

export function normalizeLever(raw: LeverPosting, token: string): NormalizedJob {
  const location = raw.categories?.location ?? "";
  return {
    key: buildJobKey({
      company: token,
      title: raw.text,
      atsKind: "lever",
      atsRef: `${token}/${raw.id}`,
    }),
    sourceKind: "lever",
    company: token,
    title: raw.text,
    locationRaw: location,
    remote:
      raw.workplaceType === "remote" ||
      /remote/i.test(location) ||
      /remote/i.test(raw.text),
    locationRestrictions: [],
    descriptionText: raw.descriptionPlain ?? "",
    applyUrl: raw.applyUrl ?? raw.hostedUrl,
    atsKind: "lever",
    atsRef: `${token}/${raw.id}`,
    postedAt: new Date(raw.createdAt),
    dateFidelity: "true",
  };
}

export async function fetchLeverBoard(token: string): Promise<LeverPosting[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
  if (!res.ok) throw new Error(`lever ${token}: HTTP ${res.status}`);
  return (await res.json()) as LeverPosting[];
}
