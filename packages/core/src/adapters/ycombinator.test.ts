import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractYcPayload,
  normalizeYc,
  parseRelativeAge,
  YC_PATHS,
  type YcJobPosting,
} from "./ycombinator.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixturePostings(): YcJobPosting[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "ycombinator.json"), "utf8"),
  ) as { props: { jobPostings: YcJobPosting[] } };
  return raw.props.jobPostings;
}

describe("parseRelativeAge", () => {
  // YC states age as prose — "19 days" — not a timestamp, so the date is
  // derived and `dateFidelity` says "reported" rather than "true".
  const now = new Date("2026-09-04T00:00:00Z");

  it("reads days", () => {
    expect(parseRelativeAge("19 days", now)?.toISOString().slice(0, 10)).toBe("2026-08-16");
  });

  it("reads a single day, hours and months", () => {
    expect(parseRelativeAge("1 day", now)?.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(parseRelativeAge("6 hours", now)?.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(parseRelativeAge("2 months", now)?.toISOString().slice(0, 10)).toBe("2026-07-06");
  });

  it("returns null for prose it cannot read, rather than guessing a date", () => {
    expect(parseRelativeAge("", now)).toBeNull();
    expect(parseRelativeAge("recently", now)).toBeNull();
  });
});

describe("extractYcPayload", () => {
  it("reads the Inertia data-page attribute out of the HTML", () => {
    const html =
      '<div id="app" data-page="{&quot;props&quot;:{&quot;jobPostings&quot;:[{&quot;id&quot;:1,&quot;title&quot;:&quot;X&quot;}]}}"></div>';
    expect(extractYcPayload(html)).toEqual([{ id: 1, title: "X" }]);
  });

  it("returns an empty list when the page carries no payload", () => {
    // A redesign that drops the attribute must read as "no jobs today", not a
    // crash that fails the whole fetch.
    expect(extractYcPayload("<html><body>nothing here</body></html>")).toEqual([]);
  });
});

describe("normalizeYc", () => {
  const now = new Date("2026-09-04T00:00:00Z");

  it("maps a real posting onto the shared job shape", () => {
    const [first] = fixturePostings();
    const job = normalizeYc(first!, now);

    expect(job.sourceKind).toBe("ycombinator");
    expect(job.company).toBe("LiteLLM");
    expect(job.title).toBe("Forward Deployed Engineer - India");
    expect(job.dateFidelity).toBe("reported");
    // The payload's own applyUrl is an account.ycombinator.com auth redirect
    // carrying a signup id. The public job page is what a person can open.
    expect(job.applyUrl).toBe(
      "https://www.ycombinator.com/companies/litellm/jobs/8ya5TlZ-forward-deployed-engineer-india",
    );
  });

  it("keeps the visa line, since it is what the sponsorship gate reads", () => {
    const [first] = fixturePostings();
    expect(normalizeYc(first!, now).descriptionText).toContain("US citizen/visa only");
  });

  it("marks a remote posting remote", () => {
    const postings = fixturePostings();
    const remote = postings.find((p) => p.location.includes("Remote"));
    expect(normalizeYc(remote!, now).remote).toBe(true);
  });

  it("leaves postedAt null when the age is unreadable", () => {
    const [first] = fixturePostings();
    const job = normalizeYc({ ...first!, createdAt: "" }, now);
    expect(job.postedAt).toBeNull();
  });
});

describe("YC_PATHS", () => {
  it("covers the India list and the engineering role list", () => {
    // robots.txt allows /jobs and disallows /companies?*, so these two filtered
    // lists plus the landing page are the whole compliant surface.
    expect(YC_PATHS).toContain("/jobs/location/india");
    expect(YC_PATHS).toContain("/jobs/role/software-engineer");
  });
});
