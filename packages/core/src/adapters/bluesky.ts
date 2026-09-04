import { z } from "zod";
import { buildJobKey } from "../job-key.js";
import type { LlmClient } from "../llm.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";

export interface BlueskyPost {
  uri: string;
  author: { handle: string; displayName?: string };
  record: {
    text: string;
    createdAt: string;
    facets?: { features: { uri?: string }[] }[];
  };
}

const HiringPostSchema = z.object({
  isHiringPost: z.boolean(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  remote: z.boolean(),
  applyUrl: z.string(),
});

/** Exchanges an app password for a session token. Create the app password in Bluesky settings. */
export async function createBlueskySession(
  identifier: string,
  appPassword: string,
): Promise<string> {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: appPassword }),
  });
  if (!res.ok) throw new Error(`bluesky auth: HTTP ${res.status}`);
  const body = (await res.json()) as { accessJwt: string };
  return body.accessJwt;
}

export async function searchBlueskyPosts(
  accessJwt: string,
  query: string,
  limit = 50,
): Promise<BlueskyPost[]> {
  const url = new URL("https://bsky.social/xrpc/app.bsky.feed.searchPosts");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "latest");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessJwt}` } });
  if (!res.ok) throw new Error(`bluesky search: HTTP ${res.status}`);
  const body = (await res.json()) as { posts?: BlueskyPost[] };
  return body.posts ?? [];
}

export function buildBlueskyQueries(profile: ParsedProfile): string[] {
  const stack = profile.coreStack.slice(0, 3);
  return [
    `hiring remote ${stack[0] ?? "developer"}`,
    `"we're hiring" full stack ${stack[1] ?? "react"}`,
    `hiring ${profile.seniorityBands[0] ?? "senior"} engineer remote`,
    `hiring India ${stack[0] ?? "developer"}`,
  ];
}

/** First link in the post's facets — more reliable than a URL the model retyped. */
function firstLink(post: BlueskyPost): string | null {
  for (const facet of post.record.facets ?? []) {
    for (const feature of facet.features) {
      if (feature.uri) return feature.uri;
    }
  }
  return null;
}

export async function parseBlueskyPost(
  post: BlueskyPost,
  client: LlmClient,
): Promise<NormalizedJob | null> {
  const parsed = await client.parse({
    schema: HiringPostSchema,
    schemaName: "bluesky_hiring_post",
    tier: "utility",
    maxOutputTokens: 4096,
    prompt:
      "Does this Bluesky post advertise a specific open job? Set isHiringPost " +
      "false for job seekers, commentary, or general company news. Use empty " +
      "strings for anything not stated.\n\n" +
      `Author: ${post.author.displayName ?? post.author.handle}\n${post.record.text}`,
  });

  if (!parsed?.isHiringPost || !parsed.company || !parsed.title) return null;

  const applyUrl = firstLink(post) ?? parsed.applyUrl;
  if (!applyUrl) return null;

  return {
    key: buildJobKey({
      company: parsed.company,
      title: parsed.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "bluesky",
    company: parsed.company,
    title: parsed.title,
    locationRaw: parsed.location,
    remote: parsed.remote,
    locationRestrictions: [],
    descriptionText: post.record.text,
    applyUrl,
    atsKind: null,
    atsRef: null,
    postedAt: new Date(post.record.createdAt),
    dateFidelity: "true",
  };
}
