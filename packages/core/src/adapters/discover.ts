import { mapWithConcurrency, type BoardsConfig } from "./index.js";

export type Provider = "greenhouse" | "lever" | "ashby";
export type ProbeFn = (provider: Provider, token: string) => Promise<boolean>;

const PROVIDERS: Provider[] = ["greenhouse", "lever", "ashby"];
const SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|gmbh|technologies|pvt)\b/gi;

/** Plausible board tokens for a company name — providers use varied conventions. */
export function candidateTokens(companyName: string): string[] {
  const cleaned = companyName.replace(SUFFIXES, " ").replace(/[^a-zA-Z0-9\s]/g, " ");
  const words = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return [...new Set([words.join(""), words.join("-"), words[0]!])];
}

const ASHBY_PROBE_QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings { id }
  }
}`;

/**
 * A 200 means the board exists; a 404 means this company is not on this provider.
 *
 * Ashby is the exception and must go through GraphQL. Its hosted board URL is a
 * client-rendered SPA that returns HTTP 200 for ANY string — probing it by status
 * code accepted "canada", "retail", and "notarealcompanyxyz123" as real boards.
 * Only a non-empty jobPostings array proves the org exists.
 */
export async function probeBoardToken(
  provider: Provider,
  token: string,
): Promise<boolean> {
  if (provider === "ashby") {
    const res = await fetch(
      "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationName: "ApiJobBoardWithTeams",
          variables: { organizationHostedJobsPageName: token },
          query: ASHBY_PROBE_QUERY,
        }),
      },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as {
      data?: { jobBoard?: { jobPostings?: unknown[] } | null };
    };
    return (body.data?.jobBoard?.jobPostings?.length ?? 0) > 0;
  }

  // Greenhouse and Lever both answer 200 with an EMPTY list for tokens that do
  // not exist — "canada", "locals" and "retail" all returned 200/0 jobs. Only a
  // non-empty posting list proves a board is real.
  if (provider === "greenhouse") {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
    if (!res.ok) return false;
    const body = (await res.json()) as { jobs?: unknown[] };
    return (body.jobs?.length ?? 0) > 0;
  }

  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
  if (!res.ok) return false;
  const body = (await res.json()) as unknown[];
  return Array.isArray(body) && body.length > 0;
}

export async function discoverBoards(
  companyNames: string[],
  existing: BoardsConfig,
  probe: ProbeFn = probeBoardToken,
): Promise<BoardsConfig> {
  const known = new Set([...existing.greenhouse, ...existing.lever, ...existing.ashby]);
  const result: BoardsConfig = {
    greenhouse: [...existing.greenhouse],
    lever: [...existing.lever],
    ashby: [...existing.ashby],
  };

  const attempts = companyNames
    .flatMap(candidateTokens)
    .filter((token) => !known.has(token))
    .flatMap((token) => PROVIDERS.map((provider) => ({ provider, token })));

  const settled = await mapWithConcurrency(attempts, 10, async ({ provider, token }) => {
    return { provider, token, hit: await probe(provider, token) };
  });

  for (const outcome of settled) {
    // A network failure is a miss, not a crash — discovery is best-effort.
    if (outcome.status !== "fulfilled" || !outcome.value.hit) continue;
    const { provider, token } = outcome.value;
    if (known.has(token)) continue;
    result[provider].push(token);
    known.add(token);
  }

  return result;
}
