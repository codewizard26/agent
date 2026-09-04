import { describe, it, expect } from "vitest";
import { matchAnswerKey, greenhouseFiller } from "./greenhouse.js";

describe("matchAnswerKey", () => {
  it("maps the identity labels a real greenhouse form uses", () => {
    expect(matchAnswerKey("First Name")).toBe("full_name");
    expect(matchAnswerKey("Email")).toBe("email");
    expect(matchAnswerKey("Phone")).toBe("phone");
    expect(matchAnswerKey("Location (City)")).toBe("location");
    expect(matchAnswerKey("LinkedIn Profile")).toBe("linkedin_url");
  });

  it("is case and whitespace insensitive", () => {
    expect(matchAnswerKey("  EMAIL  ")).toBe("email");
  });

  it("returns null for a company-specific question", () => {
    expect(matchAnswerKey("Why do you want to work at Discord?")).toBeNull();
  });

  it("returns null for an unrecognised label", () => {
    expect(matchAnswerKey("Favourite programming language")).toBeNull();
  });
});

describe("greenhouseFiller", () => {
  it("matches greenhouse-hosted urls", () => {
    expect(
      greenhouseFiller.matches("https://job-boards.greenhouse.io/gitlab/jobs/1"),
    ).toBe(true);
    expect(greenhouseFiller.matches("https://boards.greenhouse.io/figma/jobs/1")).toBe(true);
  });

  it("does not match a company-wrapped careers site", () => {
    expect(greenhouseFiller.matches("https://stripe.com/careers/search?gh_jid=1")).toBe(false);
  });
});
