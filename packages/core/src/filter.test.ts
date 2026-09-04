import { describe, it, expect } from "vitest";
import { filterJobs } from "./filter.js";
import { deriveTitleKeywords, DEFAULT_POSTURE_REMOTE_GLOBAL } from "./resume.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const NOW = new Date("2026-08-29T00:00:00Z");

const seniorProfile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL"],
  bonusStack: ["Solidity"],
  ...deriveTitleKeywords(["mid", "senior"]),
};

const gradProfile: ParsedProfile = {
  fullName: "Shambhavi Soumya",
  yearsExperience: 1,
  graduationYear: 2026,
  seniorityBands: ["entry", "junior"],
  coreStack: ["React", "Node.js", "MongoDB", "Express"],
  bonusStack: [],
  ...deriveTitleKeywords(["entry", "junior"]),
};

function job(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: "acme|engineer" },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Senior Software Engineer",
    locationRaw: "Remote",
    remote: true,
    locationRestrictions: [],
    descriptionText: "We use TypeScript, React and Node.js to build things.",
    applyUrl: "https://acme.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-28T00:00:00Z"),
    dateFidelity: "true",
    ...over,
  };
}

const base = {
  now: NOW,
  timeFrameDays: 7,
  ledgerKeys: new Set<string>(),
};

describe("seniority is derived, not hardcoded", () => {
  const gradRole = job({
    title: "New Grad Software Engineer",
    key: { atsKey: null, slugKey: "acme|new grad software engineer" },
    locationRestrictions: [],
    descriptionText: "React, Node.js and MongoDB. Graduating 2026 welcome.",
  });

  it("passes a new-grad role for the graduate profile", () => {
    const result = filterJobs([gradRole], gradProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(1);
  });

  it("rejects the same role for the senior profile", () => {
    const result = filterJobs([gradRole], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/seniority/);
  });

  it("passes a senior role for the senior profile and rejects it for the graduate", () => {
    const seniorRole = job();
    expect(
      filterJobs([seniorRole], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base).passed,
    ).toHaveLength(1);
    expect(
      filterJobs([seniorRole], gradProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base).passed,
    ).toHaveLength(0);
  });
});

describe("time frame", () => {
  it("rejects postings older than the window", () => {
    const old = job({ postedAt: new Date("2026-07-01T00:00:00Z") });
    const result = filterJobs([old], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/time frame/);
  });

  it("rejects postings with no date when a time frame is set", () => {
    const undated = job({ postedAt: null, dateFidelity: "none" });
    const result = filterJobs([undated], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/no post date/);
  });

  it("keeps undated postings when the time frame is null (any)", () => {
    const undated = job({ postedAt: null, dateFidelity: "none" });
    const result = filterJobs([undated], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, {
      ...base,
      timeFrameDays: null,
    });
    expect(result.passed).toHaveLength(1);
  });

  it("keeps a reported-fidelity posting inside the window", () => {
    const reported = job({ dateFidelity: "reported" });
    const result = filterJobs([reported], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(1);
  });
});

describe("geography and stack", () => {
  it("rejects a posting gated to US work authorization", () => {
    const gated = job({
      locationRestrictions: [],
      descriptionText: "TypeScript and React. Must be authorized to work in the US.",
    });
    const result = filterJobs([gated], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/geography/);
  });

  it("rejects a posting with fewer than two core stack matches", () => {
    const offStack = job({
      locationRestrictions: [],
      descriptionText: "We are a Salesforce and Apex shop looking for an engineer.",
    });
    const result = filterJobs([offStack], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/stack/);
  });
});

describe("ledger", () => {
  it("rejects a job whose slug key is already in the ledger", () => {
    const result = filterJobs([job()], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, {
      ...base,
      ledgerKeys: new Set(["acme|engineer"]),
    });
    expect(result.rejected[0]!.reason).toMatch(/already/);
  });

  it("rejects a job matched by its ATS key even when the slug differs", () => {
    const withAts = job({
      key: { atsKey: "greenhouse:acme/1", slugKey: "acme|senior software engineer" },
    });
    const result = filterJobs([withAts], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, {
      ...base,
      ledgerKeys: new Set(["greenhouse:acme/1"]),
    });
    expect(result.passed).toHaveLength(0);
  });
});

describe("india priority", () => {
  it("rejects a posting that positively excludes India", () => {
    const excluded = job({ locationRestrictions: ["United States", "Canada"] });
    const result = filterJobs([excluded], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/will not hire from India/);
  });

  it("keeps a posting with no stated restriction", () => {
    const open = job({ locationRestrictions: [] });
    expect(
      filterJobs([open], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base).passed,
    ).toHaveLength(1);
  });

  it("keeps an on-site role in India even under a remote-global posture", () => {
    const bangalore = job({
      remote: false,
      locationRaw: "Bangalore",
      locationRestrictions: ["India"],
    });
    expect(
      filterJobs([bangalore], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base).passed,
    ).toHaveLength(1);
  });

  it("still rejects an on-site role outside India under a remote-global posture", () => {
    const onsiteUs = job({ remote: false, locationRaw: "San Francisco, CA" });
    const result = filterJobs([onsiteUs], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/outside profile regions/);
  });
});
