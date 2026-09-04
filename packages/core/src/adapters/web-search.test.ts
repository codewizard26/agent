import { describe, it, expect, vi } from "vitest";
import { buildSearchQueries, fetchViaWebSearch } from "./web-search.js";
import { deriveTitleKeywords } from "../resume.js";
import type { ParsedProfile } from "../resume.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React", "Next.js"],
  bonusStack: ["Solidity"],
  ...deriveTitleKeywords(["mid", "senior"]),
};

describe("buildSearchQueries", () => {
  it("includes a general remote job query using the core stack", () => {
    const queries = buildSearchQueries(profile, 7);
    expect(queries.some((q) => q.includes("TypeScript"))).toBe(true);
  });

  it("includes X and Twitter site queries for hiring posts", () => {
    const queries = buildSearchQueries(profile, 7);
    expect(queries.some((q) => q.includes("site:x.com"))).toBe(true);
    expect(queries.some((q) => q.includes("site:twitter.com"))).toBe(true);
  });

  it("uses the profile's own seniority words, not fixed ones", () => {
    const grad = { ...profile, ...deriveTitleKeywords(["entry", "junior"]) };
    const queries = buildSearchQueries(grad, 7);
    expect(queries.join(" ")).toContain("new grad");
    expect(queries.join(" ")).not.toContain("principal");
  });

  it("names the recency window in the query text", () => {
    expect(buildSearchQueries(profile, 1).join(" ")).toMatch(/24 hours|past day/i);
    expect(buildSearchQueries(profile, null).join(" ")).not.toMatch(/past day/i);
  });
});

describe("fetchViaWebSearch", () => {
  function fakeClient(searchText: string, extracted: unknown) {
    return {
      searchWeb: vi.fn().mockResolvedValue(searchText),
      parse: vi.fn().mockResolvedValue(extracted),
    } as never;
  }

  const oneJob = {
    jobs: [
      {
        company: "Acme Robotics",
        title: "Senior Full Stack Engineer",
        location: "Remote (worldwide)",
        remote: true,
        applyUrl: "https://acme.example/jobs/42",
        postedAtIso: "2026-08-27",
        sourcePage: "https://x.com/acmerobotics/status/1",
      },
    ],
  };

  it("marks web-search results as reported fidelity, not true", async () => {
    const jobs = await fetchViaWebSearch(
      profile,
      7,
      fakeClient("found some jobs", oneJob),
    );
    expect(jobs[0]!.dateFidelity).toBe("reported");
  });

  it("uses the reported date when the model supplies one", async () => {
    const jobs = await fetchViaWebSearch(profile, 7, fakeClient("x", oneJob));
    expect(jobs[0]!.postedAt?.toISOString().slice(0, 10)).toBe("2026-08-27");
  });

  it("falls back to no date when the reported date is unparseable", async () => {
    const jobs = await fetchViaWebSearch(
      profile,
      7,
      fakeClient("x", {
        jobs: [{ ...oneJob.jobs[0], postedAtIso: "sometime recently" }],
      }),
    );
    expect(jobs[0]!.postedAt).toBeNull();
    expect(jobs[0]!.dateFidelity).toBe("none");
  });

  it("drops entries with no apply url", async () => {
    const jobs = await fetchViaWebSearch(
      profile,
      7,
      fakeClient("x", { jobs: [{ ...oneJob.jobs[0], applyUrl: "" }] }),
    );
    expect(jobs).toHaveLength(0);
  });

  it("sends the profile-derived queries to the search call", async () => {
    const client = fakeClient("x", oneJob);
    await fetchViaWebSearch(profile, 7, client);
    const call = (
      client as unknown as { searchWeb: { mock: { calls: { prompt: string }[][] } } }
    ).searchWeb.mock.calls[0]![0];
    for (const query of buildSearchQueries(profile, 7)) {
      expect(call.prompt).toContain(query);
    }
  });

  it("skips extraction entirely when the search returns nothing", async () => {
    const client = fakeClient("   ", oneJob);
    expect(await fetchViaWebSearch(profile, 7, client)).toEqual([]);
    expect(
      (client as unknown as { parse: { mock: { calls: unknown[] } } }).parse.mock.calls,
    ).toHaveLength(0);
  });

  it("returns an empty list rather than throwing when extraction fails", async () => {
    const client = fakeClient("x", null);
    expect(await fetchViaWebSearch(profile, 7, client)).toEqual([]);
  });
});
