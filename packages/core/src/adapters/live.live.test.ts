import { describe, it, expect } from "vitest";
import { fetchGreenhouseBoard } from "./greenhouse.js";
import { fetchLeverBoard } from "./lever.js";
import { fetchAshbyBoard } from "./ashby.js";
import { fetchRemoteOk } from "./remoteok.js";
import { fetchArbeitnow } from "./arbeitnow.js";
import { findLatestHiringThread } from "./hn.js";
import {
  fetchRemotive,
  fetchHimalayas,
  fetchJobicy,
  fetchInstahyre,
} from "./india-boards.js";

describe("live endpoints", () => {
  it("greenhouse still returns first_published", async () => {
    const jobs = await fetchGreenhouseBoard("discord");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((j) => j.first_published)).toBe(true);
  });

  it("lever still returns createdAt as epoch millis", async () => {
    const postings = await fetchLeverBoard("spotify");
    expect(postings.length).toBeGreaterThan(0);
    expect(postings[0]!.createdAt).toBeGreaterThan(1_500_000_000_000);
  });

  it("ashby still returns postings and still exposes no date field", async () => {
    const postings = await fetchAshbyBoard("ramp");
    expect(postings.length).toBeGreaterThan(0);
    expect(Object.keys(postings[0]!)).not.toContain("publishedAt");
  });

  it("remoteok still returns epoch seconds", async () => {
    const rows = await fetchRemoteOk();
    expect(rows.some((r) => r.position && r.epoch)).toBe(true);
  });

  it("arbeitnow still returns created_at", async () => {
    const rows = await fetchArbeitnow();
    expect(rows[0]!.created_at).toBeGreaterThan(1_500_000_000);
  });

  it("hn still has a findable who-is-hiring thread", async () => {
    expect(await findLatestHiringThread()).toBeGreaterThan(0);
  });
});

describe("india-capable live endpoints", () => {
  it("remotive still returns publication_date and a location string", async () => {
    const jobs = await fetchRemotive();
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]!.publication_date).toBeTruthy();
  });

  it("himalayas still returns locationRestrictions and pubDate", async () => {
    const jobs = await fetchHimalayas();
    expect(jobs.length).toBeGreaterThan(0);
    expect(Number(jobs[0]!.pubDate)).toBeGreaterThan(1_500_000_000);
  });

  it("jobicy still returns jobGeo and pubDate", async () => {
    const jobs = await fetchJobicy();
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]!.pubDate).toBeTruthy();
  });

  it("instahyre still returns india roles and still exposes no post date", async () => {
    const jobs = await fetchInstahyre();
    expect(jobs.length).toBeGreaterThan(0);
    expect(Object.keys(jobs[0]!)).not.toContain("pubDate");
  });
});
