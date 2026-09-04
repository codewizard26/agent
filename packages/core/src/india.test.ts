import { describe, it, expect } from "vitest";
import {
  isIndiaEligible,
  isIndiaLocated,
  isIndiaExcluded,
  sortByIndiaPriority,
} from "./india.js";
import type { NormalizedJob } from "./types.js";

function job(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: "acme|engineer" },
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
    ...over,
  };
}

describe("isIndiaEligible", () => {
  it("treats an empty restriction list as eligible", () => {
    expect(isIndiaEligible(job({ locationRestrictions: [] }))).toBe(true);
  });

  it("accepts an explicit India restriction", () => {
    expect(isIndiaEligible(job({ locationRestrictions: ["India"] }))).toBe(true);
  });

  it("accepts a worldwide marker", () => {
    expect(isIndiaEligible(job({ locationRestrictions: ["Worldwide"] }))).toBe(true);
    expect(isIndiaEligible(job({ locationRestrictions: ["Anywhere"] }))).toBe(true);
  });

  it("accepts a list that includes India among others", () => {
    expect(
      isIndiaEligible(job({ locationRestrictions: ["United States", "India"] })),
    ).toBe(true);
  });

  it("rejects a non-empty list naming neither India nor worldwide", () => {
    expect(
      isIndiaEligible(job({ locationRestrictions: ["United States", "Canada"] })),
    ).toBe(false);
  });
});

describe("isIndiaLocated", () => {
  it("recognises Indian cities in the location text", () => {
    expect(isIndiaLocated(job({ locationRaw: "Bangalore" }))).toBe(true);
    expect(isIndiaLocated(job({ locationRaw: "Gurgaon, Haryana" }))).toBe(true);
  });

  it("recognises India in a restriction list", () => {
    expect(
      isIndiaLocated(job({ locationRaw: "Remote", locationRestrictions: ["India"] })),
    ).toBe(true);
  });

  it("is false for a purely US posting", () => {
    expect(
      isIndiaLocated(job({ locationRaw: "San Francisco, CA", locationRestrictions: [] })),
    ).toBe(false);
  });
});

describe("isIndiaExcluded", () => {
  it("never excludes when no restriction is stated", () => {
    expect(isIndiaExcluded(job({ locationRestrictions: [] }))).toBe(false);
  });

  it("excludes only on a positive exclusion", () => {
    expect(
      isIndiaExcluded(job({ locationRestrictions: ["United States"] })),
    ).toBe(true);
    expect(isIndiaExcluded(job({ locationRestrictions: ["India"] }))).toBe(false);
  });
});

describe("sortByIndiaPriority", () => {
  const located = job({ company: "Located", locationRaw: "Bengaluru, India" });
  const eligible = job({ company: "Eligible", locationRestrictions: [] });
  const excluded = job({ company: "Excluded", locationRestrictions: ["US only"] });

  it("orders located, then eligible, then excluded", () => {
    const sorted = sortByIndiaPriority([excluded, eligible, located]);
    expect(sorted.map((j) => j.company)).toEqual(["Located", "Eligible", "Excluded"]);
  });

  it("drops nothing — India priority is ordering, not filtering", () => {
    expect(sortByIndiaPriority([excluded, eligible, located])).toHaveLength(3);
  });

  it("keeps incoming order inside a tier and does not mutate the input", () => {
    const a = job({ company: "A" });
    const b = job({ company: "B" });
    const input = [a, b];
    expect(sortByIndiaPriority(input).map((j) => j.company)).toEqual(["A", "B"]);
    expect(input[0]!.company).toBe("A");
  });
});

describe("India term matching is whole-word", () => {
  it("does not read the IST marker out of Specialist or Scientist", () => {
    expect(isIndiaLocated(job({ title: "Solutions Specialist", locationRaw: "SF" }))).toBe(
      false,
    );
    expect(isIndiaLocated(job({ title: "Data Scientist", locationRaw: "Austin, TX" }))).toBe(
      false,
    );
    expect(
      isIndiaLocated(job({ title: "Network Administrator", locationRaw: "Reston, VA" })),
    ).toBe(false);
  });

  it("does not read India out of Indiana, or apac out of Apache", () => {
    expect(isIndiaLocated(job({ locationRaw: "Indianapolis, Indiana" }))).toBe(false);
    expect(isIndiaLocated(job({ title: "Apache Kafka Engineer", locationRaw: "Berlin" }))).toBe(
      false,
    );
  });

  it("still matches the real markers", () => {
    expect(isIndiaLocated(job({ locationRaw: "Remote (IST hours)" }))).toBe(true);
    expect(isIndiaLocated(job({ locationRaw: "APAC" }))).toBe(true);
    expect(isIndiaLocated(job({ locationRaw: "Mumbai, India" }))).toBe(true);
  });
});
