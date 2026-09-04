import { describe, it, expect } from "vitest";
import { buildComposePrompt, coerceToOption } from "./compose.js";
import type { HarvestedField } from "./fillers/types.js";

const field = (over: Partial<HarvestedField> = {}): HarvestedField => ({
  selector: "#q", label: "Why do you want to work here?", type: "text",
  required: true, options: [], ...over,
});

describe("buildComposePrompt", () => {
  it("grounds the answer in the resume rather than letting it invent one", () => {
    const prompt = buildComposePrompt(field(), {
      resumeText: "Nikhil Mishra. Five years building React and Node platforms.",
      known: new Map([["location", "Remote, India"]]),
      company: "GitLab",
      title: "Senior Fullstack Engineer",
    });
    expect(prompt).toContain("Five years building React");
    expect(prompt).toContain("GitLab");
    expect(prompt).toContain("Senior Fullstack Engineer");
    expect(prompt).toContain("Why do you want to work here?");
  });

  it("offers the field's own options when it has them", () => {
    const prompt = buildComposePrompt(
      field({ type: "select", options: ["Yes", "No"] }),
      { resumeText: "", known: new Map(), company: "X", title: "Y" },
    );
    expect(prompt).toContain("Yes");
    expect(prompt).toContain("No");
  });
});

describe("coerceToOption", () => {
  it("passes free text through untouched", () => {
    expect(coerceToOption("Because I like it", [])).toBe("Because I like it");
  });

  it("snaps an answer onto the option the control actually offers", () => {
    // A select only accepts its own labels. "yes" typed into a control whose
    // option reads "Yes, I am authorized" selects nothing at all, and the form
    // submits with the field empty.
    expect(coerceToOption("yes", ["Yes, I am authorized", "No"])).toBe("Yes, I am authorized");
    expect(coerceToOption("No", ["Yes, I am authorized", "No"])).toBe("No");
  });

  it("returns null when nothing offered matches, so the field is left alone", () => {
    expect(coerceToOption("Maybe", ["Yes", "No"])).toBeNull();
  });
});
