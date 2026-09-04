import { describe, it, expect } from "vitest";
import { shouldAutoSubmit, confirmsSubmission, SUBMIT_SELECTORS } from "./submit.js";

describe("shouldAutoSubmit", () => {
  it("submits when the profile authorized it and every field was filled", () => {
    expect(shouldAutoSubmit({ authorized: true, blocked: [] })).toBe(true);
  });

  it("never submits a profile that has not authorized it", () => {
    // The flag is per profile and only its owner sets it. A second person's
    // board running in the same database must not inherit the first's consent.
    expect(shouldAutoSubmit({ authorized: false, blocked: [] })).toBe(false);
  });

  it("stops when a field was left unanswered, authorized or not", () => {
    // A required question the answer bank could not answer is still required.
    // Submitting anyway either trips the form's own validation or sends an
    // application with a blank answer — and a sent application is not undoable.
    expect(shouldAutoSubmit({ authorized: true, blocked: ["Why this company?"] })).toBe(
      false,
    );
  });
});

describe("confirmsSubmission", () => {
  it("recognises the usual post-submit copy", () => {
    expect(confirmsSubmission("Thanks for applying! We'll be in touch.")).toBe(true);
    expect(confirmsSubmission("Your application has been submitted")).toBe(true);
    expect(confirmsSubmission("Application received")).toBe(true);
  });

  it("does not mistake the form itself for a confirmation", () => {
    // "Submit application" is the button's own label and is on the page before
    // anything is sent. Reading it as success would mark unsent applications
    // applied, which is the one error this whole path must not make.
    expect(confirmsSubmission("Submit application")).toBe(false);
    expect(confirmsSubmission("Please complete the required fields")).toBe(false);
    expect(confirmsSubmission("")).toBe(false);
  });
});

describe("SUBMIT_SELECTORS", () => {
  it("is ordered from the most specific ATS control to the generic fallback", () => {
    // First match wins, so a bare button[type=submit] — which on several boards
    // is a newsletter sign-up in the footer — has to come last.
    expect(SUBMIT_SELECTORS[0]).toContain("Submit application");
    expect(SUBMIT_SELECTORS[SUBMIT_SELECTORS.length - 1]).toBe('button[type="submit"]');
  });
});
