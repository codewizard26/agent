import { describe, it, expect, vi } from "vitest";
import { rankJobs } from "./rank.js";
import { deriveTitleKeywords } from "./resume.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: ["Solidity"],
  ...deriveTitleKeywords(["mid", "senior"]),
};

function job(slug: string): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: slug },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Senior Engineer",
    locationRaw: "Remote",
    remote: true,
    locationRestrictions: [],
    descriptionText: "TypeScript and React",
    applyUrl: "https://acme.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-28T00:00:00Z"),
    dateFidelity: "true",
  };
}

function ranked(slug: string, score: number) {
  return {
    jobKey: slug,
    score,
    tier: "strong" as const,
    why: "Stack matches",
    redFlags: [],
    sponsorshipGate: false,
    indiaEligible: true,
    timezoneGate: null,
    resumeHooks: ["EuclidSwap"],
  };
}

describe("rankJobs", () => {
  it("returns a map keyed by slug key", async () => {
    const client = {
      parse: vi.fn().mockResolvedValue({ rankings: [ranked("acme|a", 90)] }),
      searchWeb: vi.fn(),
    } as never;

    const result = await rankJobs([job("acme|a")], profile, client);
    expect(result.get("acme|a")?.score).toBe(90);
  });

  it("batches so a large set makes multiple calls", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({ rankings: [ranked("acme|a", 90)] })
      .mockResolvedValueOnce({ rankings: [ranked("acme|b", 80)] });
    const client = { parse, searchWeb: vi.fn() } as never;

    await rankJobs([job("acme|a"), job("acme|b")], profile, client, 1);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("keeps jobs from surviving batches when one batch fails", async () => {
    const parse = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ rankings: [ranked("acme|b", 80)] });
    const client = { parse, searchWeb: vi.fn() } as never;

    const result = await rankJobs([job("acme|a"), job("acme|b")], profile, client, 1);
    expect(result.has("acme|a")).toBe(false);
    expect(result.get("acme|b")?.score).toBe(80);
  });

  it("makes no call for an empty job list", async () => {
    const parse = vi.fn();
    const result = await rankJobs([], profile, { parse, searchWeb: vi.fn() } as never);
    expect(parse).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});
