import { describe, it, expect } from "vitest";
import { buildSources, MODEL_BACKED_SOURCES } from "./sources.js";
import { deriveTitleKeywords } from "./resume.js";
import type { ParsedProfile } from "./resume.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: [],
  ...deriveTitleKeywords(["mid", "senior"]),
};

const boards = { greenhouse: ["discord"], lever: ["spotify"], ashby: ["ramp"] };
const fakeClient = {} as never;

function kinds(sources: { kind: string }[]) {
  return [...new Set(sources.map((s) => s.kind))];
}

describe("buildSources", () => {
  it("omits every model-backed source when no client is given", () => {
    const built = kinds(buildSources({ boards, profile, timeFrameDays: 7 }));
    for (const kind of MODEL_BACKED_SOURCES) {
      expect(built).not.toContain(kind);
    }
  });

  it("still returns the pure-HTTP sources with no client", () => {
    const built = kinds(buildSources({ boards, profile, timeFrameDays: 7 }));
    expect(built).toEqual(
      expect.arrayContaining([
        "greenhouse",
        "lever",
        "remoteok",
        "arbeitnow",
        "remotive",
        "himalayas",
        "jobicy",
      ]),
    );
  });

  it("adds hn and websearch once a client is supplied", () => {
    const built = kinds(
      buildSources({ boards, profile, timeFrameDays: 7, client: fakeClient }),
    );
    expect(built).toContain("hn");
    expect(built).toContain("websearch");
  });

  it("adds bluesky only when credentials are supplied", () => {
    const without = kinds(
      buildSources({ boards, profile, timeFrameDays: 7, client: fakeClient }),
    );
    expect(without).not.toContain("bluesky");

    const with_ = kinds(
      buildSources({
        boards,
        profile,
        timeFrameDays: 7,
        client: fakeClient,
        bluesky: { identifier: "a.bsky.social", appPassword: "x" },
      }),
    );
    expect(with_).toContain("bluesky");
  });

  it("excludes the dateless sources from a time-framed fetch", () => {
    const framed = kinds(buildSources({ boards, profile, timeFrameDays: 7 }));
    expect(framed).not.toContain("ashby");
    expect(framed).not.toContain("instahyre");
  });

  it("includes the dateless sources when the time frame is any", () => {
    const any = kinds(buildSources({ boards, profile, timeFrameDays: null }));
    expect(any).toContain("ashby");
    expect(any).toContain("instahyre");
  });

  it("creates one task per board token", () => {
    const sources = buildSources({
      boards: { greenhouse: ["a", "b", "c"], lever: [], ashby: [] },
      profile,
      timeFrameDays: 7,
    });
    expect(sources.filter((s) => s.kind === "greenhouse")).toHaveLength(3);
  });
});
