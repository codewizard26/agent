import { describe, it, expect } from "vitest";
import {
  normalizeRemotive,
  normalizeHimalayas,
  normalizeJobicy,
  normalizeInstahyre,
} from "./india-boards.js";
import { isIndiaEligible } from "../india.js";

describe("remotive adapter", () => {
  const raw = {
    id: 1,
    title: "Senior Full Stack Engineer",
    company_name: "Acme",
    url: "https://remotive.com/jobs/1",
    candidate_required_location: "Worldwide",
    publication_date: "2026-08-26T13:10:58",
  };

  it("uses publication_date as a true post date", () => {
    const job = normalizeRemotive(raw);
    expect(job.dateFidelity).toBe("true");
    expect(job.postedAt?.getFullYear()).toBe(2026);
  });

  it("splits the location string into restrictions", () => {
    const job = normalizeRemotive({ ...raw, candidate_required_location: "India, USA" });
    expect(job.locationRestrictions).toEqual(["India", "USA"]);
    expect(isIndiaEligible(job)).toBe(true);
  });

  it("marks a Europe-only posting as not India eligible", () => {
    const job = normalizeRemotive({ ...raw, candidate_required_location: "Europe" });
    expect(isIndiaEligible(job)).toBe(false);
  });

  it("treats Worldwide as India eligible", () => {
    expect(isIndiaEligible(normalizeRemotive(raw))).toBe(true);
  });
});

describe("himalayas adapter", () => {
  const raw = {
    guid: "g1",
    title: "Backend Engineer",
    companyName: "Gardens",
    applicationLink: "https://himalayas.app/jobs/1",
    locationRestrictions: ["Canada", "United States"],
    pubDate: "1787939050",
  };

  it("converts pubDate epoch seconds to a Date", () => {
    const job = normalizeHimalayas(raw);
    expect(job.postedAt?.getTime()).toBe(1787939050 * 1000);
    expect(job.dateFidelity).toBe("true");
  });

  it("carries the restriction array straight through", () => {
    expect(normalizeHimalayas(raw).locationRestrictions).toEqual([
      "Canada",
      "United States",
    ]);
    expect(isIndiaEligible(normalizeHimalayas(raw))).toBe(false);
  });

  it("is India eligible when the list names India", () => {
    const job = normalizeHimalayas({ ...raw, locationRestrictions: ["India"] });
    expect(isIndiaEligible(job)).toBe(true);
  });

  it("is India eligible when no restriction is stated", () => {
    const job = normalizeHimalayas({ ...raw, locationRestrictions: [] });
    expect(isIndiaEligible(job)).toBe(true);
  });
});

describe("jobicy adapter", () => {
  const raw = {
    id: 1,
    jobTitle: "Solutions Architect",
    companyName: "Databricks",
    url: "https://jobicy.com/jobs/1",
    jobGeo: "Denmark,  Finland,  Sweden",
    pubDate: "2026-08-28T12:44:33+00:00",
  };

  it("splits jobGeo into restrictions", () => {
    expect(normalizeJobicy(raw).locationRestrictions).toEqual([
      "Denmark",
      "Finland",
      "Sweden",
    ]);
  });

  it("uses pubDate as a true post date", () => {
    expect(normalizeJobicy(raw).dateFidelity).toBe("true");
  });

  it("treats Anywhere as India eligible", () => {
    expect(isIndiaEligible(normalizeJobicy({ ...raw, jobGeo: "Anywhere" }))).toBe(true);
  });
});

describe("instahyre adapter", () => {
  const raw = {
    id: 440767,
    title: "SDE III (Backend)",
    locations: "Gurgaon",
    keywords: ["go", "kafka", "kubernetes"],
    public_url: "https://www.instahyre.com/job-440767",
    employer: { company_name: "GreyOrange" },
  };

  it("reports no date fidelity — reviewed_at is null on every record", () => {
    const job = normalizeInstahyre(raw)!;
    expect(job.dateFidelity).toBe("none");
    expect(job.postedAt).toBeNull();
  });

  it("marks every posting as hiring in India", () => {
    const job = normalizeInstahyre(raw)!;
    expect(job.locationRestrictions).toEqual(["India"]);
    expect(isIndiaEligible(job)).toBe(true);
  });

  it("keeps the Indian city as the location", () => {
    expect(normalizeInstahyre(raw)!.locationRaw).toBe("Gurgaon");
  });

  it("drops records with no employer company name", () => {
    expect(normalizeInstahyre({ ...raw, employer: {} })).toBeNull();
  });
});
