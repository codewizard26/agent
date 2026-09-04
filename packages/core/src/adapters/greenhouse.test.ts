import { describe, it, expect } from "vitest";
import fixture from "./fixtures/greenhouse-discord.json" with { type: "json" };
import { normalizeGreenhouse, type GreenhouseJob } from "./greenhouse.js";

const jobs = (fixture as { jobs: GreenhouseJob[] }).jobs;

describe("greenhouse adapter", () => {
  it("reads postedAt from first_published, never updated_at", () => {
    const raw = jobs.find(
      (j) => j.first_published && j.updated_at && j.first_published !== j.updated_at,
    );
    expect(raw, "fixture needs a job where the two dates differ").toBeDefined();

    const job = normalizeGreenhouse(raw!, "discord");
    expect(job.postedAt?.toISOString()).toBe(new Date(raw!.first_published!).toISOString());
    expect(job.postedAt?.toISOString()).not.toBe(new Date(raw!.updated_at).toISOString());
  });

  it("marks date fidelity as true", () => {
    expect(normalizeGreenhouse(jobs[0]!, "discord").dateFidelity).toBe("true");
  });

  it("builds an exact ATS key from token and job id", () => {
    const job = normalizeGreenhouse(jobs[0]!, "discord");
    expect(job.key.atsKey).toBe(`greenhouse:discord/${jobs[0]!.id}`);
    expect(job.atsKind).toBe("greenhouse");
  });

  it("strips HTML entities and tags from the description", () => {
    const job = normalizeGreenhouse(
      { ...jobs[0]!, content: "<p>Build&nbsp;things &amp; ship</p>" },
      "discord",
    );
    expect(job.descriptionText).toBe("Build things & ship");
  });

  it("returns null postedAt when first_published is absent", () => {
    const job = normalizeGreenhouse({ ...jobs[0]!, first_published: null }, "discord");
    expect(job.postedAt).toBeNull();
  });
});
