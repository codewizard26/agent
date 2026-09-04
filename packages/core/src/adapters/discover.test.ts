import { describe, it, expect, vi } from "vitest";
import { candidateTokens, discoverBoards } from "./discover.js";

const empty = { greenhouse: [], lever: [], ashby: [] };

describe("candidateTokens", () => {
  it("lowercases and strips punctuation and spaces", () => {
    expect(candidateTokens("Acme Robotics, Inc.")).toContain("acmerobotics");
  });

  it("offers a hyphenated variant too", () => {
    expect(candidateTokens("Acme Robotics")).toContain("acme-robotics");
  });

  it("drops corporate suffixes", () => {
    const tokens = candidateTokens("Acme Labs Ltd");
    expect(tokens).toContain("acmelabs");
  });
});

describe("discoverBoards", () => {
  it("adds tokens that probe successfully", async () => {
    const probe = vi.fn(async (provider: string, token: string) =>
      provider === "greenhouse" && token === "acme",
    );
    const result = await discoverBoards(["Acme"], empty, probe);
    expect(result.greenhouse).toContain("acme");
    expect(result.lever).toEqual([]);
  });

  it("never duplicates a token already present", async () => {
    const probe = vi.fn(async () => true);
    const result = await discoverBoards(["Acme"], { ...empty, greenhouse: ["acme"] }, probe);
    expect(result.greenhouse.filter((t) => t === "acme")).toHaveLength(1);
  });

  it("skips probing companies already known on some provider", async () => {
    const probe = vi.fn(async () => true);
    await discoverBoards(["Acme"], { ...empty, lever: ["acme"] }, probe);
    expect(probe).not.toHaveBeenCalledWith("greenhouse", "acme");
  });

  it("treats a probe failure as a miss rather than throwing", async () => {
    const probe = vi.fn(async () => {
      throw new Error("network");
    });
    const result = await discoverBoards(["Acme"], empty, probe);
    expect(result.greenhouse).toEqual([]);
  });
});

describe("probe precision", () => {
  it("rejects a provider that answers 200 with an empty list", async () => {
    // Greenhouse, Lever and Ashby all return a successful response for tokens
    // that do not exist; only a non-empty posting list proves a board is real.
    const probe = vi.fn(async () => false);
    const result = await discoverBoards(["Canada Goose"], empty, probe);
    expect(result.greenhouse).toEqual([]);
    expect(result.lever).toEqual([]);
    expect(result.ashby).toEqual([]);
  });
});
