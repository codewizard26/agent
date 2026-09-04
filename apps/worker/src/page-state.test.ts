import { describe, it, expect } from "vitest";
import { classifyPage } from "./page-state.js";

describe("classifyPage", () => {
  it("accepts a real application form", () => {
    expect(classifyPage({ status: 200, text: "Apply for this job", fieldCount: 12 }))
      .toEqual({ kind: "form" });
  });

  it("treats an HTTP error as a posting that is gone", () => {
    // A removed posting is the common case, not an edge case: boards delete
    // filled roles constantly and the board keeps the row until the next fetch.
    expect(classifyPage({ status: 404, text: "", fieldCount: 0 }).kind).toBe("gone");
    expect(classifyPage({ status: 410, text: "", fieldCount: 0 }).kind).toBe("gone");
  });

  it("reads the wording boards use when a role has closed", () => {
    for (const text of [
      "This job is no longer available",
      "Job not found",
      "This position has been filled",
      "The posting you are looking for has been removed",
      "This role is closed",
    ]) {
      expect(classifyPage({ status: 200, text, fieldCount: 0 }).kind).toBe("gone");
    }
  });

  it("separates a live page that is not an application from a dead one", () => {
    // A LinkedIn or Instahyre listing answers 200 with plenty of text and no
    // form worth filling. It is not gone — a person can still apply on it — so
    // it goes to the human rather than being marked dead.
    expect(classifyPage({ status: 200, text: "Full Stack Developer at Starstack", fieldCount: 0 }))
      .toEqual({ kind: "no-form" });
  });

  it("does not call a page gone just because a word appears in a job description", () => {
    expect(
      classifyPage({
        status: 200,
        text: "You will help close the loop on incidents. Apply below.",
        fieldCount: 9,
      }).kind,
    ).toBe("form");
  });
});

import { withDeadline } from "./page-state.js";

describe("withDeadline", () => {
  it("returns the value when the work finishes in time", async () => {
    await expect(withDeadline(async () => "done", 1000, "apply")).resolves.toBe("done");
  });

  it("gives up rather than letting one task hold the queue for ever", async () => {
    // Playwright's own timeouts cover a navigation or a click, not a task that
    // wanders — a redirect chain, a consent wall, a page that never settles.
    // Without a ceiling on the whole task the queue stops at the first one.
    await expect(
      withDeadline(() => new Promise((r) => setTimeout(r, 200)), 20, "apply"),
    ).rejects.toThrow(/apply.*20ms/);
  });
});
