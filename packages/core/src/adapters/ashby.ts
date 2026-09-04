import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

export interface AshbyPosting {
  id: string;
  title: string;
  locationName?: string;
  employmentType?: string;
}

const QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings { id title locationName employmentType }
  }
}`;

export function normalizeAshby(raw: AshbyPosting, org: string): NormalizedJob {
  const location = raw.locationName ?? "";
  return {
    key: buildJobKey({
      company: org,
      title: raw.title,
      atsKind: "ashby",
      atsRef: `${org}/${raw.id}`,
    }),
    sourceKind: "ashby",
    company: org,
    title: raw.title,
    locationRaw: location,
    remote: /remote/i.test(location) || /remote/i.test(raw.title),
    locationRestrictions: [],
    descriptionText: "",
    applyUrl: `https://jobs.ashbyhq.com/${org}/${raw.id}`,
    atsKind: "ashby",
    atsRef: `${org}/${raw.id}`,
    // Ashby's public board exposes no date field. Do not substitute "now".
    postedAt: null,
    dateFidelity: "none",
  };
}

export async function fetchAshbyBoard(org: string): Promise<AshbyPosting[]> {
  const res = await fetch(
    "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "ApiJobBoardWithTeams",
        variables: { organizationHostedJobsPageName: org },
        query: QUERY,
      }),
    },
  );
  if (!res.ok) throw new Error(`ashby ${org}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { jobBoard?: { jobPostings?: AshbyPosting[] } };
    errors?: unknown[];
  };
  if (body.errors) throw new Error(`ashby ${org}: ${JSON.stringify(body.errors)}`);
  return body.data?.jobBoard?.jobPostings ?? [];
}
