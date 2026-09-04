import { describe, it, expect, vi } from "vitest";
import {
  parseBlueskyPost,
  buildBlueskyQueries,
  type BlueskyPost,
} from "./bluesky.js";
import { deriveTitleKeywords } from "../resume.js";
import type { ParsedProfile } from "../resume.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: [],
  ...deriveTitleKeywords(["mid", "senior"]),
};

const post: BlueskyPost = {
  uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
  author: { handle: "acme.bsky.social", displayName: "Acme Robotics" },
  record: {
    text: "We're hiring a Senior Full Stack Engineer, fully remote. TypeScript + React. Apply: https://acme.example/jobs/42",
    createdAt: "2026-08-27T10:00:00.000Z",
    facets: [
      {
        features: [
          { $type: "app.bsky.richtext.facet#link", uri: "https://acme.example/jobs/42" },
        ],
      },
    ],
  },
};

function fakeClient(parsed: unknown) {
  return {
    parse: vi.fn().mockResolvedValue(parsed),
    searchWeb: vi.fn(),
  } as never;
}

const hiring = {
  isHiringPost: true,
  company: "Acme Robotics",
  title: "Senior Full Stack Engineer",
  location: "Remote",
  remote: true,
  applyUrl: "https://acme.example/jobs/42",
};

describe("buildBlueskyQueries", () => {
  it("derives queries from the profile stack and seniority", () => {
    const queries = buildBlueskyQueries(profile);
    expect(queries.join(" ")).toContain("TypeScript");
    expect(queries.some((q) => q.includes("hiring"))).toBe(true);
  });
});

describe("parseBlueskyPost", () => {
  it("builds a normalized job from a hiring post", async () => {
    const job = await parseBlueskyPost(post, fakeClient(hiring));
    expect(job).not.toBeNull();
    expect(job!.company).toBe("Acme Robotics");
    expect(job!.sourceKind).toBe("bluesky");
  });

  it("uses the post createdAt as a true post date", async () => {
    const job = await parseBlueskyPost(post, fakeClient(hiring));
    expect(job!.dateFidelity).toBe("true");
    expect(job!.postedAt?.toISOString()).toBe("2026-08-27T10:00:00.000Z");
  });

  it("prefers a facet link over the model's applyUrl", async () => {
    const job = await parseBlueskyPost(
      post,
      fakeClient({ ...hiring, applyUrl: "https://wrong.example" }),
    );
    expect(job!.applyUrl).toBe("https://acme.example/jobs/42");
  });

  it("drops posts the model says are not hiring posts", async () => {
    const job = await parseBlueskyPost(
      post,
      fakeClient({ ...hiring, isHiringPost: false }),
    );
    expect(job).toBeNull();
  });

  it("drops hiring posts that carry no application link at all", async () => {
    const linkless: BlueskyPost = {
      ...post,
      record: { ...post.record, facets: [] },
    };
    const job = await parseBlueskyPost(
      linkless,
      fakeClient({ ...hiring, applyUrl: "" }),
    );
    expect(job).toBeNull();
  });
});
