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

describe("held tasks", () => {
  it("are invisible to the worker until a run is started", async () => {
    // Queueing now parks a job at "held". The worker only ever selects
    // "queued", so nothing is applied to until Start applying flips the batch
    // over — which is the whole point: build the list first, run it on purpose.
    handle = await createTestDb();
    const db = handle.db;
    {
      const [profile] = await db.insert(profiles).values({
        name: "Held", ownerEmail: "held@example.test", resumeText: "",
      }).returning();

      await db.insert(applyTasks).values({
        profileId: profile!.id, atsKey: null, slugKey: "acme|engineer",
        company: "acme", title: "Engineer", applyUrl: "https://example.test/1",
        status: "held",
      });

      const pickedUp = await db.select().from(applyTasks)
        .where(eq(applyTasks.status, "queued"));
      expect(pickedUp).toHaveLength(0);

      await db.update(applyTasks).set({ status: "queued" })
        .where(eq(applyTasks.profileId, profile!.id));

      const afterStart = await db.select().from(applyTasks)
        .where(eq(applyTasks.status, "queued"));
      expect(afterStart).toHaveLength(1);
    }
  });
});
