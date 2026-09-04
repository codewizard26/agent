import { z } from "zod";
import { buildJobKey } from "../job-key.js";
import type { LlmClient } from "../llm.js";
import type { NormalizedJob } from "../types.js";

export interface HnComment {
  objectID: string;
  comment_text: string;
  created_at_i: number; // epoch seconds
}

const HnJobSchema = z.object({
  isJobPosting: z.boolean(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  remote: z.boolean(),
  applyUrl: z.string(),
});

/** Finds the newest "Ask HN: Who is hiring?" story id. */
export async function findLatestHiringThread(): Promise<number> {
  const res = await fetch(
    "https://hn.algolia.com/api/v1/search?tags=story,author_whoishiring&query=Who%20is%20hiring&hitsPerPage=5",
  );
  if (!res.ok) throw new Error(`hn search: HTTP ${res.status}`);
  const body = (await res.json()) as {
    hits: { objectID: string; title: string; created_at_i: number }[];
  };
  const hiring = body.hits
    .filter((h) => /who is hiring/i.test(h.title))
    .sort((a, b) => b.created_at_i - a.created_at_i)[0];
  if (!hiring) throw new Error("hn: no who-is-hiring thread found");
  return Number(hiring.objectID);
}

export async function fetchThreadComments(storyId: number): Promise<HnComment[]> {
  const res = await fetch(
    `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=1000`,
  );
  if (!res.ok) throw new Error(`hn comments: HTTP ${res.status}`);
  const body = (await res.json()) as { hits: HnComment[] };
  return body.hits.filter((h) => h.comment_text);
}

export async function parseHnComment(
  comment: HnComment,
  client: LlmClient,
): Promise<NormalizedJob | null> {
  const parsed = await client.parse({
    schema: HnJobSchema,
    schemaName: "hn_job",
    tier: "utility",
    maxOutputTokens: 4096,
    prompt:
      "Extract the job posting from this Hacker News comment. " +
      "Set isJobPosting false if it is not a job posting (meta commentary, a " +
      "job seeker, a question). Use an empty string for anything absent.\n\n" +
      comment.comment_text,
  });

  if (!parsed || !parsed.isJobPosting || !parsed.company || !parsed.title) {
    return null;
  }

  return {
    key: buildJobKey({
      company: parsed.company,
      title: parsed.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "hn",
    company: parsed.company,
    title: parsed.title,
    locationRaw: parsed.location,
    remote: parsed.remote,
    locationRestrictions: [],
    descriptionText: comment.comment_text,
    applyUrl: parsed.applyUrl,
    atsKind: null,
    atsRef: null,
    // The comment's own timestamp — never the model's guess.
    postedAt: new Date(comment.created_at_i * 1000),
    dateFidelity: "true",
  };
}
