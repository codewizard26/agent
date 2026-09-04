import { describe, it, expect } from "vitest";
import { normalizeTitle, buildJobKey, ledgerMatchKeys } from "./job-key.js";

describe("normalizeTitle", () => {
  it("strips parenthetical suffixes", () => {
    expect(normalizeTitle("Senior Software Engineer (Remote)")).toBe(
      "senior software engineer",
    );
  });

  it("strips trailing location fragments after a dash", () => {
    expect(normalizeTitle("Senior Software Engineer - Bangalore")).toBe(
      "senior software engineer",
    );
  });

  it("strips gendered posting markers", () => {
    expect(normalizeTitle("Backend Engineer (m/f/d)")).toBe("backend engineer");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeTitle("Full-Stack   Engineer,  II")).toBe(
      "full stack engineer ii",
    );
  });

  it("keeps genuinely different roles distinct", () => {
    expect(normalizeTitle("Frontend Engineer")).not.toBe(
      normalizeTitle("Backend Engineer"),
    );
  });
});

describe("buildJobKey", () => {
  it("prefers exact ATS identity when available", () => {
    const key = buildJobKey({
      company: "Discord",
      title: "Senior Software Engineer",
      atsKind: "greenhouse",
      atsRef: "discord/8599937002",
    });
    expect(key.atsKey).toBe("greenhouse:discord/8599937002");
    expect(key.slugKey).toBe("discord|senior software engineer");
  });

  it("falls back to slug key with no ATS identity", () => {
    const key = buildJobKey({
      company: "Acme Corp",
      title: "Full Stack Engineer (Remote)",
      atsKind: null,
      atsRef: null,
    });
    expect(key.atsKey).toBeNull();
    expect(key.slugKey).toBe("acme corp|full stack engineer");
  });

  it("gives the same slug key for the same role from different sources", () => {
    const fromBoard = buildJobKey({
      company: "Acme Corp",
      title: "Senior Software Engineer",
      atsKind: null,
      atsRef: null,
    });
    const fromAggregator = buildJobKey({
      company: "Acme  Corp.",
      title: "Senior Software Engineer (Remote)",
      atsKind: null,
      atsRef: null,
    });
    expect(fromAggregator.slugKey).toBe(fromBoard.slugKey);
  });
});

describe("ledgerMatchKeys", () => {
  it("returns both keys when ATS identity exists", () => {
    expect(
      ledgerMatchKeys({ atsKey: "lever:spotify/abc", slugKey: "spotify|engineer" }),
    ).toEqual(["lever:spotify/abc", "spotify|engineer"]);
  });

  it("returns only the slug key when there is no ATS identity", () => {
    expect(ledgerMatchKeys({ atsKey: null, slugKey: "acme|engineer" })).toEqual([
      "acme|engineer",
    ]);
  });
});
