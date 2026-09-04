import { describe, it, expect } from "vitest";
import fixture from "./fixtures/lever-spotify.json" with { type: "json" };
import { normalizeLever, type LeverPosting } from "./lever.js";

const postings = fixture as LeverPosting[];

describe("lever adapter", () => {
  it("converts createdAt epoch millis to a Date", () => {
    const raw = postings[0]!;
    const job = normalizeLever(raw, "spotify");
    expect(job.postedAt?.getTime()).toBe(raw.createdAt);
    expect(job.dateFidelity).toBe("true");
  });

  it("builds an exact ATS key from token and posting id", () => {
    const job = normalizeLever(postings[0]!, "spotify");
    expect(job.key.atsKey).toBe(`lever:spotify/${postings[0]!.id}`);
  });

  it("prefers applyUrl over hostedUrl", () => {
    const job = normalizeLever(
      { ...postings[0]!, hostedUrl: "https://h", applyUrl: "https://a" },
      "spotify",
    );
    expect(job.applyUrl).toBe("https://a");
  });

  it("falls back to hostedUrl when applyUrl is missing", () => {
    const { applyUrl: _drop, ...rest } = postings[0]!;
    const job = normalizeLever({ ...rest, hostedUrl: "https://h" } as LeverPosting, "spotify");
    expect(job.applyUrl).toBe("https://h");
  });

  it("detects remote from workplaceType", () => {
    const job = normalizeLever(
      { ...postings[0]!, workplaceType: "remote" },
      "spotify",
    );
    expect(job.remote).toBe(true);
  });
});
