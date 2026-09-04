import { describe, it, expect } from "vitest";
import { canApplyHere } from "./apply-availability";

describe("canApplyHere", () => {
  it("is available where a real browser can be launched", () => {
    expect(canApplyHere({})).toBe(true);
  });

  it("is unavailable on Vercel", () => {
    // Applying drives a non-headless Chrome with a persistent profile and hands
    // the tab to a person. A serverless function has nowhere to put that, so a
    // click there queues a task nothing will ever pick up — which is exactly
    // what happened: two tasks sat at "queued" with no worker in existence.
    expect(canApplyHere({ VERCEL: "1" })).toBe(false);
  });
});
