import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db.js";
import { profiles, jobLedger } from "./schema.js";

let handle: TestDb;
afterEach(async () => await handle?.close());

describe("schema", () => {
  it("stores a profile and reads it back", async () => {
    handle = await createTestDb();
    const [row] = await handle.db
      .insert(profiles)
      .values({
        name: "Nikhil Mishra",
        ownerEmail: "nikhilmishra2608@gmail.com",
        resumeText: "Full Stack Blockchain Developer",
        parsedProfile: { yearsExperience: 5 },
        posture: { regions: ["global"], remoteGlobal: true, needsSponsorship: false },
      })
      .returning();
    expect(row!.autoSubmitAuthorized).toBe(false);
    expect(row!.parsedProfile).toEqual({ yearsExperience: 5 });
  });

  it("excludes a job by either key", async () => {
    handle = await createTestDb();
    const [p] = await handle.db
      .insert(profiles)
      .values({ name: "T", ownerEmail: "t@example.com", resumeText: "" })
      .returning();

    await handle.db.insert(jobLedger).values({
      profileId: p!.id,
      atsKey: "greenhouse:discord/1",
      slugKey: "discord|senior software engineer",
      state: "applied",
    });

    const rows = await handle.db
      .select()
      .from(jobLedger)
      .where(eq(jobLedger.profileId, p!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("applied");
  });
});

describe("createDb without DATABASE_URL", () => {
  it("names the missing variable when running on Vercel", async () => {
    // The local PGlite fallback is right for tests and a fresh clone, and wrong
    // in a deployed function: PGlite is not installed there, so the fallback
    // fails with "Cannot find module '@electric-sql/pglite'" — an error that
    // points at a dependency rather than at the unset variable that caused it.
    const { createDb } = await import("./client.js");
    const prevUrl = process.env.DATABASE_URL;
    const prevVercel = process.env.VERCEL;
    delete process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    try {
      expect(() => createDb()).toThrow(/DATABASE_URL/);
    } finally {
      if (prevUrl) process.env.DATABASE_URL = prevUrl;
      if (prevVercel) process.env.VERCEL = prevVercel;
      else delete process.env.VERCEL;
    }
  });
});
