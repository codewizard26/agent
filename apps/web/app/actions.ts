"use server";

import { and, eq } from "drizzle-orm";
import {
  createDb,
  jobLedger,
  answerBank,
  applyTasks,
  profiles,
  removeFromFeed,
} from "@job-agent/db";

function db() {
  return createDb();
}

export async function dismissJob(input: {
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}): Promise<void> {
  const d = db();
  await d.insert(jobLedger).values({ ...input, state: "dismissed" });
  // The ledger keeps this out of the NEXT fetch; this takes it off the board now.
  await removeFromFeed(d, input.profileId, input);
}

export async function queueApply(input: {
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}): Promise<void> {
  const d = db();
  // Parked, not started. Start applying is what releases the batch.
  await d.insert(applyTasks).values({ ...input, status: "held" });
  await removeFromFeed(d, input.profileId, input);
}

/**
 * The user's explicit confirmation that they clicked submit. Nothing else
 * writes an 'applied' ledger row, so the tracker never contains a submission
 * the worker only attempted.
 */
export async function markApplied(input: {
  taskId: string;
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}): Promise<void> {
  const d = db();
  await d.insert(jobLedger).values({
    profileId: input.profileId,
    atsKey: input.atsKey,
    slugKey: input.slugKey,
    state: "applied",
    company: input.company,
    title: input.title,
    applyUrl: input.applyUrl,
  });
  await d.delete(applyTasks).where(eq(applyTasks.id, input.taskId));
}

/**
 * Turns direct submission on or off for one profile.
 *
 * Deliberately per profile and deliberately a deliberate act: the worker reads
 * this flag per task, so two people sharing this database never inherit each
 * other's consent to have applications sent in their name.
 */
export async function setAutoSubmit(input: {
  profileId: string;
  authorized: boolean;
}): Promise<void> {
  await db()
    .update(profiles)
    .set({ autoSubmitAuthorized: input.authorized })
    .where(eq(profiles.id, input.profileId));
}

/**
 * Releases everything this profile has queued, in one deliberate act.
 *
 * Apply parks a job at "held"; the worker only ever selects "queued". Nothing
 * is applied to until this runs, so the list is built first and then run on
 * purpose rather than each click firing a browser the moment it lands.
 */
export async function startApplying(profileId: string): Promise<number> {
  const released = await db()
    .update(applyTasks)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(applyTasks.profileId, profileId), eq(applyTasks.status, "held")))
    .returning();
  return released.length;
}

/** Takes one job back out of the queue. Writes no ledger row, so it returns on the next fetch. */
export async function removeApplyTask(taskId: string): Promise<void> {
  await db().delete(applyTasks).where(eq(applyTasks.id, taskId));
}

export async function listApplyTasks(profileId: string) {
  return db().select().from(applyTasks).where(eq(applyTasks.profileId, profileId));
}

export async function saveAnswer(input: { id: string; value: string }): Promise<void> {
  await db()
    .update(answerBank)
    .set({ value: input.value, updatedAt: new Date() })
    .where(eq(answerBank.id, input.id));
}
