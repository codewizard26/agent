import { describe, it, expect } from "vitest";
import { loadBoards, dedupeJobs, mapWithConcurrency } from "./index.js";
import type { NormalizedJob } from "../types.js";

function job(over: Partial<NormalizedJob>): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: "acme|engineer" },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Engineer",
    locationRaw: "Remote",
    remote: true,
    locationRestrictions: [],
    descriptionText: "",
    applyUrl: "https://aggregator.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-20T00:00:00Z"),
    dateFidelity: "true",
    ...over,
  };
}

describe("loadBoards", () => {
  it("parses provider tokens from yaml", () => {
    const cfg = loadBoards("greenhouse:\n  - discord\nlever:\n  - spotify\n");
    expect(cfg.greenhouse).toEqual(["discord"]);
    expect(cfg.lever).toEqual(["spotify"]);
    expect(cfg.ashby).toEqual([]);
  });
});

describe("dedupeJobs", () => {
  it("collapses the same role seen from two sources", () => {
    const result = dedupeJobs([
      job({ sourceKind: "remoteok" }),
      job({ sourceKind: "arbeitnow" }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("prefers the ATS-direct posting as canonical", () => {
    const result = dedupeJobs([
      job({ sourceKind: "remoteok", applyUrl: "https://aggregator.example/1" }),
      job({
        sourceKind: "greenhouse",
        atsKind: "greenhouse",
        atsRef: "acme/1",
        key: { atsKey: "greenhouse:acme/1", slugKey: "acme|engineer" },
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.applyUrl).toBe("https://job-boards.greenhouse.io/acme/jobs/1");
  });

  it("keeps genuinely different roles", () => {
    const result = dedupeJobs([
      job({ key: { atsKey: null, slugKey: "acme|frontend engineer" } }),
      job({ key: { atsKey: null, slugKey: "acme|backend engineer" } }),
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return true;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("returns rejections instead of throwing", async () => {
    const results = await mapWithConcurrency([1, 2], 2, async (n) => {
      if (n === 1) throw new Error("boom");
      return n;
    });
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
  });
});
