import { describe, it, expect } from "vitest";
import { leverFiller } from "./lever.js";
import { ashbyFiller } from "./ashby.js";
import { workableFiller } from "./workable.js";

describe("host matching", () => {
  it("lever matches its hosted apply urls", () => {
    expect(leverFiller.matches("https://jobs.lever.co/spotify/abc/apply")).toBe(true);
    expect(leverFiller.matches("https://job-boards.greenhouse.io/x/jobs/1")).toBe(false);
  });

  it("ashby matches its hosted urls", () => {
    expect(ashbyFiller.matches("https://jobs.ashbyhq.com/ramp/abc")).toBe(true);
  });

  it("workable matches its hosted urls", () => {
    expect(workableFiller.matches("https://apply.workable.com/acme/j/ABC123/")).toBe(true);
  });

  it("no filler claims a company-wrapped careers site", () => {
    const wrapped = "https://consensys.io/open-roles/1";
    expect(leverFiller.matches(wrapped)).toBe(false);
    expect(ashbyFiller.matches(wrapped)).toBe(false);
    expect(workableFiller.matches(wrapped)).toBe(false);
  });
});

describe("lever-specific vocabulary", () => {
  it("maps Lever's own resume-source label", () => {
    expect(leverFiller.name).toBe("lever");
  });
});
