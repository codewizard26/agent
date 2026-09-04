import { describe, it, expect } from "vitest";
import { selectFiller } from "./select.js";
import type { AtsFiller } from "./types.js";

const stub = (name: string, host: string): AtsFiller => ({
  name,
  matches: (url) => url.includes(host),
  fill: async () => ({ filled: [], blocked: [] }),
});

const generic: AtsFiller = {
  name: "generic",
  matches: () => true,
  fill: async () => ({ filled: [], blocked: [] }),
};

describe("selectFiller", () => {
  it("picks the ats filler whose host matches", () => {
    const chosen = selectFiller("https://jobs.lever.co/spotify/abc/apply", [
      stub("greenhouse", "greenhouse.io"),
      stub("lever", "jobs.lever.co"),
      generic,
    ]);
    expect(chosen.name).toBe("lever");
  });

  it("falls back to generic for a company-wrapped site", () => {
    const chosen = selectFiller("https://www.coinbase.com/careers/positions/1", [
      stub("greenhouse", "greenhouse.io"),
      generic,
    ]);
    expect(chosen.name).toBe("generic");
  });

  it("prefers a specific filler over generic even when generic is listed first", () => {
    const chosen = selectFiller("https://job-boards.greenhouse.io/gitlab/jobs/1", [
      generic,
      stub("greenhouse", "greenhouse.io"),
    ]);
    expect(chosen.name).toBe("greenhouse");
  });
});
