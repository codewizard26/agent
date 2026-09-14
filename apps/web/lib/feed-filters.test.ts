import { describe, expect, it } from "vitest";
import { DEFAULT_FEED_FILTERS, filterFeed, type FilterableJob } from "./feed-filters";
const jobs: FilterableJob[] = [
  { title: "Backend Developer", company: "A", locationRaw: "Bangalore", sourceKind: "lever", postedAt: "2026-09-14", rank: { score: 95, tier: "strong" } },
  { title: "Frontend Developer", company: "B", locationRaw: "Gurgaon", sourceKind: "websearch", postedAt: "2026-09-12", rank: { score: 60, tier: "stretch" } },
  { title: "QA Tester", company: "C", locationRaw: "Greater Noida", sourceKind: "lever", postedAt: null, rank: null },
  { title: "Full Stack Developer", company: "D", locationRaw: "Remote", remote: true, sourceKind: "websearch", postedAt: "2026-09-13", rank: { score: 80, tier: "strong" } },
];
describe("feed controls", () => {
  it("prioritizes NCR without removing other jobs or mutating the feed", () => {
    expect(filterFeed(jobs, DEFAULT_FEED_FILTERS).map((job) => job.company)).toEqual(["B", "C", "A", "D"]);
    expect(jobs[0].company).toBe("A");
  });
  it("combines keyword, role, source and match filters", () => {
    expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, query: "frontend B", role: ["frontend"], source: ["websearch"], tier: ["stretch"] })).toHaveLength(1);
  });
  it("handles Gurgaon aliases, Greater Noida, remote and other locations", () => {
    for (const [location, companies] of [["gurugram", ["B"]], ["noida", ["C"]], ["remote", ["D"]], ["other", ["A", "D"]]] as const) {
      expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, location: [location] }).map((job) => job.company)).toEqual(companies);
    }
  });
  it("supports independent sorting and unranked filtering", () => {
    expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, sort: "newest" }).map((job) => job.company)).toEqual(["A", "D", "B", "C"]);
    expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, tier: ["unranked"] }).map((job) => job.company)).toEqual(["C"]);
  });
  it("returns an empty view for unmatched filters", () => {
    expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, query: "unmatched" })).toEqual([]);
  });
});

it("ORs options within a filter and ANDs separate filters", () => {
  expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, location: ["gurugram", "noida"], tier: ["stretch", "unranked"] }).map((job) => job.company)).toEqual(["B", "C"]);
  expect(filterFeed(jobs, { ...DEFAULT_FEED_FILTERS, location: ["gurugram", "noida"], source: ["lever"] }).map((job) => job.company)).toEqual(["C"]);
});
it("includes internships by default and lets users select jobs, internships, or both", () => {
  const intern = { ...jobs[0], title: "Software Intern" };
  expect(filterFeed([jobs[0], intern], DEFAULT_FEED_FILTERS)).toHaveLength(2);
  expect(filterFeed([jobs[0], intern], { ...DEFAULT_FEED_FILTERS, employment: ["internship"] })).toEqual([intern]);
});
