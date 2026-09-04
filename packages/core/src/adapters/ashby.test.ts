import { describe, it, expect } from "vitest";
import { normalizeAshby, type AshbyPosting } from "./ashby.js";

const raw: AshbyPosting = {
  id: "abc-123",
  title: "Senior Full Stack Engineer",
  locationName: "Remote - US",
  employmentType: "FullTime",
};

describe("ashby adapter", () => {
  it("reports no date fidelity", () => {
    const job = normalizeAshby(raw, "ramp");
    expect(job.dateFidelity).toBe("none");
  });

  it("leaves postedAt null rather than guessing", () => {
    expect(normalizeAshby(raw, "ramp").postedAt).toBeNull();
  });

  it("builds an exact ATS key", () => {
    expect(normalizeAshby(raw, "ramp").key.atsKey).toBe("ashby:ramp/abc-123");
  });

  it("builds the hosted apply url from org and posting id", () => {
    expect(normalizeAshby(raw, "ramp").applyUrl).toBe(
      "https://jobs.ashbyhq.com/ramp/abc-123",
    );
  });
});
