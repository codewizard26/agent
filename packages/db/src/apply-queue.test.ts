import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db.js";
import { profiles, applyTasks, jobLedger } from "./schema.js";

let handle: TestDb;
afterEach(async () => await handle?.close());

async function seedProfile(h: TestDb) {
  const [p] = await h.db
    .insert(profiles)
    .values({ name: "T", ownerEmail: "t@example.com", resumeText: "" })
    .returning();
  return p!.id;
}

describe("apply queue", () => {
  it("queues a task in the queued state", async () => {
    handle = await createTestDb();
    const profileId = await seedProfile(handle);
    const [task] = await handle.db
      .insert(applyTasks)
      .values({
        profileId,
        atsKey: "greenhouse:discord/1",
        slugKey: "discord|senior engineer",
        company: "Discord",
        title: "Senior Engineer",
        applyUrl: "https://job-boards.greenhouse.io/discord/jobs/1",
      })
      .returning();
    expect(task!.status).toBe("queued");
    expect(task!.blockedFields).toBeNull();
  });

  it("records blocked fields when a task halts for the human", async () => {
    handle = await createTestDb();
    const profileId = await seedProfile(handle);
    const [task] = await handle.db
      .insert(applyTasks)
      .values({
        profileId,
        slugKey: "discord|senior engineer",
        company: "Discord",
        title: "Senior Engineer",
        applyUrl: "https://example.com",
      })
      .returning();

    await handle.db
      .update(applyTasks)
      .set({
        status: "awaiting_human",
        blockedFields: ["Why do you want to work at Discord?"],
      })
      .where(eq(applyTasks.id, task!.id));

    const [updated] = await handle.db
      .select()
      .from(applyTasks)
      .where(eq(applyTasks.id, task!.id));
    expect(updated!.status).toBe("awaiting_human");
    expect(updated!.blockedFields).toEqual(["Why do you want to work at Discord?"]);
  });

  it("writes both keys to the ledger when marked applied", async () => {
    handle = await createTestDb();
    const profileId = await seedProfile(handle);
    await handle.db.insert(jobLedger).values({
      profileId,
      atsKey: "greenhouse:discord/1",
      slugKey: "discord|senior engineer",
      state: "applied",
      company: "Discord",
      title: "Senior Engineer",
      applyUrl: "https://example.com",
    });
    const rows = await handle.db
      .select()
      .from(jobLedger)
      .where(eq(jobLedger.profileId, profileId));
    expect(rows[0]!.atsKey).toBe("greenhouse:discord/1");
    expect(rows[0]!.slugKey).toBe("discord|senior engineer");
  });
});
