import { describe, it, expect, vi } from "vitest";
import { parseResume, DEFAULT_POSTURE_INDIA } from "./resume.js";

function fakeClient(parsed: unknown) {
  return {
    parse: vi.fn().mockResolvedValue(parsed),
    searchWeb: vi.fn(),
  } as never;
}

const senior = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React", "Next.js", "Node.js"],
  bonusStack: ["Solidity", "EVM"],
};

describe("parseResume", () => {
  it("returns the model's structured extraction", async () => {
    const profile = await parseResume("…resume text…", fakeClient(senior));
    expect(profile.seniorityBands).toEqual(["mid", "senior"]);
    expect(profile.coreStack).toContain("Next.js");
  });

  it("derives accepted title keywords from the seniority bands", async () => {
    const profile = await parseResume("…", fakeClient(senior));
    expect(profile.titlesReject).toContain("new grad");
    expect(profile.titlesReject).toContain("principal");
    expect(profile.titlesAccept).toContain("senior");
  });

  it("derives the opposite keywords for an entry-level profile", async () => {
    const profile = await parseResume(
      "…",
      fakeClient({
        fullName: "Shambhavi Soumya",
        yearsExperience: 1,
        graduationYear: 2026,
        seniorityBands: ["entry", "junior"],
        coreStack: ["React", "Node.js", "MongoDB"],
        bonusStack: [],
      }),
    );
    expect(profile.titlesAccept).toContain("new grad");
    expect(profile.titlesAccept).toContain("junior");
    expect(profile.titlesReject).toContain("senior");
    expect(profile.titlesReject).not.toContain("new grad");
  });

  it("throws rather than returning a half-built profile", async () => {
    await expect(parseResume("…", fakeClient(null))).rejects.toThrow(
      /could not be parsed/i,
    );
  });
});

describe("DEFAULT_POSTURE_INDIA", () => {
  it("is india plus remote and needs no sponsorship", () => {
    expect(DEFAULT_POSTURE_INDIA).toEqual({
      regions: ["india", "remote"],
      remoteGlobal: false,
      needsSponsorship: false,
      indiaPriority: true,
    });
  });
});
