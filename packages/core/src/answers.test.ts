import { describe, it, expect } from "vitest";
import { ANSWER_KEYS, seedAnswerRows, resolveAnswer } from "./answers.js";

describe("ANSWER_KEYS", () => {
  it("covers the mechanical identity fields", () => {
    const keys = ANSWER_KEYS.map((k) => k.key);
    for (const k of ["full_name", "email", "phone", "location", "linkedin_url", "github_url"]) {
      expect(keys).toContain(k);
    }
  });

  it("covers the gating fields that stall applications", () => {
    const keys = ANSWER_KEYS.map((k) => k.key);
    for (const k of ["work_authorization", "requires_sponsorship", "notice_period", "expected_compensation"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("seedAnswerRows", () => {
  it("creates a row per key for the profile", () => {
    const rows = seedAnswerRows("profile-1");
    expect(rows).toHaveLength(ANSWER_KEYS.length);
    expect(rows.every((r) => r.profileId === "profile-1")).toBe(true);
  });

  it("defaults every EEO field to decline to self-identify", () => {
    const rows = seedAnswerRows("profile-1");
    const eeo = rows.filter((r) => r.key.startsWith("eeo_"));
    expect(eeo.length).toBeGreaterThan(0);
    expect(eeo.every((r) => r.value === "Decline to self-identify")).toBe(true);
  });

  it("leaves non-EEO answers empty for the owner to fill", () => {
    const rows = seedAnswerRows("profile-1");
    expect(rows.find((r) => r.key === "expected_compensation")!.value).toBeNull();
  });
});

describe("resolveAnswer", () => {
  const rows = [
    { key: "email", value: "nikhilmishra2608@gmail.com" },
    { key: "notice_period", value: "" },
  ];

  it("returns a stored answer", () => {
    expect(resolveAnswer(rows, "email")).toBe("nikhilmishra2608@gmail.com");
  });

  it("treats an empty string as unanswered", () => {
    expect(resolveAnswer(rows, "notice_period")).toBeNull();
  });

  it("returns null for a key with no row at all", () => {
    expect(resolveAnswer(rows, "phone")).toBeNull();
  });
});
