import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchCarrerlift, parseCarrerliftJob, parseCarrerliftLinks } from "./carrerlift.js";
import { deriveTitleKeywords } from "../resume.js";
const profile = { fullName: "Test", yearsExperience: 0.5, graduationYear: 2026, seniorityBands: ["entry" as const], coreStack: ["React"], bonusStack: [], ...deriveTitleKeywords(["entry"]) };
const detail = (extra = {}) => `<script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting", title: "Frontend Developer", hiringOrganization: {name: "Example"},
  description: "<p>React and Node.js. Freshers welcome.</p>", employmentType: "INTERN", datePosted: "2026-09-14",
  jobLocation: {address: {addressLocality: "Noida"}}, ...extra,
})}</script>`;
const listing = '<h2><a href="/jobs/example-1">Frontend Developer Intern</a></h2><h2>Share job</h2><a href="/jobs/example-1">Details</a><h2><a href="/jobs/example-2">Software Intern</a></h2>';
describe("Carrerlift public adapter", () => {
  it("reads observed headings without swallowing the next card after a share dialog", () => {
    const links = parseCarrerliftLinks(readFileSync(new URL("./fixtures/carrerlift-headings.html", import.meta.url), "utf8"));
    expect(links.some((link) => link.includes("software-intern"))).toBe(true);
    expect(links.some((link) => link.includes("franklin-templeton"))).toBe(true);
    expect(links.some((link) => link.includes("business-analyst"))).toBe(false);
  });
  it("retains full descriptions, exact dates and internship status", () => {
    expect(parseCarrerliftJob(detail(), "https://www.carrerlift.in/jobs/example", new Date("2026-09-14"))).toMatchObject({
      title: "Frontend Developer Intern", descriptionText: "React and Node.js. Freshers welcome.",
      sourceKind: "carrerlift", locationRaw: "Noida", postedAt: new Date("2026-09-14"), dateFidelity: "true",
    });
  });
  it("rejects expired details and never invents dates", () => {
    expect(parseCarrerliftJob(detail({validThrough: "2020-01-01"}), "https://www.carrerlift.in/jobs/example")).toBeNull();
    expect(parseCarrerliftJob(detail({datePosted: "unknown"}), "https://www.carrerlift.in/jobs/example")?.postedAt).toBeNull();
  });
  it("paginates, deduplicates detail requests and respects the detail cap", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => new Response(String(url).includes("?q=") ? listing : detail()));
    const result = await fetchCarrerlift(profile, {fetcher: fetcher as typeof fetch, maxDetails: 1});
    expect(result).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => !String(url).includes("?q="))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("page=2"))).toBe(true);
  });
  it("reports markup failures instead of silently returning zero", async () => {
    await expect(fetchCarrerlift(profile, {fetcher: vi.fn(async () => new Response("<html>Changed markup</html>")) as typeof fetch})).rejects.toThrow("no job links");
  });
});
