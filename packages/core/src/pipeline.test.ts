import { describe, it, expect, vi } from "vitest";
import { runFetch, type ProgressEvent } from "./pipeline.js";
import { deriveTitleKeywords, DEFAULT_POSTURE_REMOTE_GLOBAL } from "./resume.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: [],
  ...deriveTitleKeywords(["mid", "senior"]),
};

function job(slug: string): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: slug },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Senior Engineer",
    locationRaw: "Remote",
    remote: true,
    locationRestrictions: [],
    descriptionText: "TypeScript and React",
    applyUrl: "https://acme.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-28T00:00:00Z"),
    dateFidelity: "true",
  };
}

const client = {
  parse: vi.fn().mockResolvedValue({
        rankings: [
          {
            jobKey: "acme|senior engineer",
            score: 88,
            tier: "strong",
            why: "Stack matches",
            redFlags: [],
            sponsorshipGate: false,
            indiaEligible: true,
            timezoneGate: null,
            resumeHooks: [],
          },
        ],
      }), searchWeb: vi.fn(),
} as never;

async function collect(gen: AsyncGenerator<ProgressEvent>): Promise<ProgressEvent[]> {
  const events: ProgressEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const base = {
  profile,
  posture: DEFAULT_POSTURE_REMOTE_GLOBAL,
  ledgerKeys: new Set<string>(),
  timeFrameDays: 7,
  client,
  now: new Date("2026-08-29T00:00:00Z"),
};

describe("runFetch", () => {
  it("emits progress events in order and ends with done", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          { kind: "remoteok", run: async () => [job("acme|senior engineer")] },
        ],
      }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "fetching",
      "fetched",
      "filtered",
      "ranking",
      "done",
    ]);
  });

  it("attaches rankings to the jobs in the done event", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          { kind: "remoteok", run: async () => [job("acme|senior engineer")] },
        ],
      }),
    );
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type !== "done") throw new Error("unreachable");
    expect(done.results[0]!.rank?.score).toBe(88);
  });

  it("reports a failed source but still completes", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          { kind: "remoteok", run: async () => [job("acme|senior engineer")] },
          {
            kind: "arbeitnow",
            run: async () => {
              throw new Error("HTTP 503");
            },
          },
        ],
      }),
    );
    const fetched = events.find((e) => e.type === "fetched")!;
    if (fetched.type !== "fetched") throw new Error("unreachable");
    expect(fetched.failed).toEqual(["arbeitnow"]);
    expect(events.at(-1)!.type).toBe("done");
  });

  it("emits error rather than done when every source fails", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          {
            kind: "remoteok",
            run: async () => {
              throw new Error("HTTP 503");
            },
          },
        ],
      }),
    );
    expect(events.at(-1)!.type).toBe("error");
  });
});

describe("india priority ordering", () => {
  function ranked(slug: string, score: number, indiaEligible: boolean) {
    return {
      jobKey: slug,
      score,
      tier: "strong",
      why: "",
      redFlags: [],
      sponsorshipGate: false,
      indiaEligible,
      timezoneGate: null,
      resumeHooks: [],
    };
  }

  it("sorts an India-located job above a higher-scoring non-India job", async () => {
    const india = { ...job("acme|india engineer"), locationRaw: "Bangalore" };
    const usa = { ...job("acme|usa engineer"), locationRaw: "Austin, TX" };

    const rankingClient = {
      parse: vi.fn().mockResolvedValue({
            rankings: [
              ranked("acme|india engineer", 70, true),
              ranked("acme|usa engineer", 95, false),
            ],
          }), searchWeb: vi.fn(),
    } as never;

    const events = await collect(
      runFetch({
        ...base,
        client: rankingClient,
        sources: [{ kind: "remoteok", run: async () => [india, usa] }],
      }),
    );
    const done = events.at(-1)!;
    if (done.type !== "done") throw new Error("unreachable");
    expect(done.results[0]!.locationRaw).toBe("Bangalore");
    expect(done.results[1]!.locationRaw).toBe("Austin, TX");
  });

  it("falls back to score order when india priority is off", async () => {
    const india = { ...job("acme|india engineer"), locationRaw: "Bangalore" };
    const usa = { ...job("acme|usa engineer"), locationRaw: "Austin, TX" };

    const rankingClient = {
      parse: vi.fn().mockResolvedValue({
            rankings: [
              ranked("acme|india engineer", 70, true),
              ranked("acme|usa engineer", 95, false),
            ],
          }), searchWeb: vi.fn(),
    } as never;

    const events = await collect(
      runFetch({
        ...base,
        client: rankingClient,
        posture: { ...DEFAULT_POSTURE_REMOTE_GLOBAL, indiaPriority: false },
        sources: [{ kind: "remoteok", run: async () => [india, usa] }],
      }),
    );
    const done = events.at(-1)!;
    if (done.type !== "done") throw new Error("unreachable");
    expect(done.results[0]!.locationRaw).toBe("Austin, TX");
  });
});
