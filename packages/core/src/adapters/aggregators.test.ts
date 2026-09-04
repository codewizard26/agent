import { describe, it, expect } from "vitest";
import remoteokFixture from "./fixtures/remoteok.json" with { type: "json" };
import arbeitnowFixture from "./fixtures/arbeitnow.json" with { type: "json" };
import { normalizeRemoteOk, type RemoteOkJob } from "./remoteok.js";
import { normalizeArbeitnow, type ArbeitnowJob } from "./arbeitnow.js";

describe("remoteok adapter", () => {
  const rows = remoteokFixture as RemoteOkJob[];

  it("skips the legal-notice element that has no position", () => {
    expect(normalizeRemoteOk(rows[0]!)).toBeNull();
  });

  it("converts epoch seconds to a Date", () => {
    const raw = rows.find((r) => r.position && r.epoch)!;
    const job = normalizeRemoteOk(raw)!;
    expect(job.postedAt?.getTime()).toBe(raw.epoch! * 1000);
    expect(job.dateFidelity).toBe("true");
  });

  it("has no ATS key, only a slug key", () => {
    const raw = rows.find((r) => r.position)!;
    const job = normalizeRemoteOk(raw)!;
    expect(job.key.atsKey).toBeNull();
    expect(job.key.slugKey).toContain("|");
  });

  it("marks every posting remote", () => {
    const raw = rows.find((r) => r.position)!;
    expect(normalizeRemoteOk(raw)!.remote).toBe(true);
  });
});

describe("arbeitnow adapter", () => {
  const rows = (arbeitnowFixture as { data: ArbeitnowJob[] }).data;

  it("converts created_at epoch seconds to a Date", () => {
    const job = normalizeArbeitnow(rows[0]!);
    expect(job.postedAt?.getTime()).toBe(rows[0]!.created_at * 1000);
    expect(job.dateFidelity).toBe("true");
  });

  it("carries the remote flag through", () => {
    const job = normalizeArbeitnow({ ...rows[0]!, remote: true });
    expect(job.remote).toBe(true);
  });
});
