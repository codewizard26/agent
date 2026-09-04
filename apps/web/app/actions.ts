"use server";

import { eq } from "drizzle-orm";
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
  await d.insert(applyTasks).values(input);
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

export async function listApplyTasks(profileId: string) {
  return db().select().from(applyTasks).where(eq(applyTasks.profileId, profileId));
}

export async function saveAnswer(input: { id: string; value: string }): Promise<void> {
  await db()
    .update(answerBank)
    .set({ value: input.value, updatedAt: new Date() })
    .where(eq(answerBank.id, input.id));
}
