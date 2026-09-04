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
