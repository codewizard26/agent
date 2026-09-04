import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { harvestFields } from "./harvest.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage();
});
afterAll(async () => await browser?.close());

async function loadFixture(name: string) {
  const html = fs.readFileSync(
    path.join(import.meta.dirname, "fixtures", `${name}.html`),
    "utf8",
  );
  await page.setContent(html, { waitUntil: "domcontentloaded" });
}

describe("harvestFields", () => {
  it("finds the identity fields on a real greenhouse form", async () => {
    await loadFixture("greenhouse-gitlab");
    const labels = (await harvestFields(page)).map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes("first name"))).toBe(true);
    expect(labels.some((l) => l.includes("email"))).toBe(true);
  });

  it("marks required fields from the asterisk in the label", async () => {
    await loadFixture("greenhouse-gitlab");
    const first = (await harvestFields(page)).find((f) =>
      f.label.toLowerCase().includes("first name"),
    );
    expect(first?.required).toBe(true);
  });

  it("strips the asterisk from the label text", async () => {
    await loadFixture("greenhouse-gitlab");
    const first = (await harvestFields(page)).find((f) =>
      f.label.toLowerCase().includes("first name"),
    );
    expect(first?.label).not.toContain("*");
  });

  it("finds the resume file input", async () => {
    await loadFixture("greenhouse-gitlab");
    expect((await harvestFields(page)).some((f) => f.type === "file")).toBe(true);
  });

  it("excludes the recaptcha hidden input", async () => {
    await loadFixture("greenhouse-gitlab");
    const selectors = (await harvestFields(page)).map((f) => f.selector);
    expect(selectors.some((s) => s.includes("g-recaptcha-response"))).toBe(false);
  });

  it("captures the free-text question that stalls applications", async () => {
    await loadFixture("greenhouse-discord");
    const labels = (await harvestFields(page)).map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes("why do you want to work"))).toBe(true);
  });

  it("is idempotent — a second harvest yields selectors pointing at the same labels", async () => {
    await loadFixture("greenhouse-gitlab");
    const first = await harvestFields(page);
    const second = await harvestFields(page);

    expect(second.map((f) => f.selector)).toEqual(first.map((f) => f.selector));
    expect(second.map((f) => f.label)).toEqual(first.map((f) => f.label));
  });

  it("leaves no duplicate markers after repeated harvests", async () => {
    await loadFixture("greenhouse-gitlab");
    await harvestFields(page);
    await harvestFields(page);
    const markers = await page.locator("[data-job-agent]").count();
    const harvested = (await harvestFields(page)).filter((f) =>
      f.selector.startsWith("[data-job-agent"),
    ).length;
    expect(markers).toBe(harvested);
  });
});
