import { describe, it, expect, afterAll } from "vitest";
import { openWorkerBrowser } from "./browser.js";

let session: Awaited<ReturnType<typeof openWorkerBrowser>>;
afterAll(async () => await session?.close());

describe("worker browser", () => {
  it("loads a live Greenhouse form without a Cloudflare challenge", async () => {
    session = await openWorkerBrowser();
    const response = await session.page.goto(
      "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
      { waitUntil: "networkidle", timeout: 45_000 },
    );

    expect(response?.status()).toBe(200);
    expect(await session.page.title()).not.toContain("Just a moment");

    const fields = await session.page
      .locator("input:visible, textarea:visible, select:visible")
      .count();
    expect(fields).toBeGreaterThan(10);
  });
});
