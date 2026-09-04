import { eq, inArray } from "drizzle-orm";
import { createDb, applyTasks, answerBank, profiles, jobLedger } from "@job-agent/db";
import { resolveAnswer, ANSWER_KEYS, createLlmClient } from "@job-agent/core";
import { openWorkerBrowser, type BrowserSession } from "./browser.js";
import { selectFiller } from "./fillers/select.js";
import { greenhouseFiller } from "./fillers/greenhouse.js";
import { leverFiller } from "./fillers/lever.js";
import { ashbyFiller } from "./fillers/ashby.js";
import { workableFiller } from "./fillers/workable.js";
import { createGenericFiller } from "./fillers/generic.js";
import type { AtsFiller, FillOutcome } from "./fillers/types.js";
import { shouldAutoSubmit, submitApplication } from "./submit.js";

export interface ApplyTaskRow {
  id: string;
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}

export interface ProcessDeps {
  openBrowser: () => Promise<BrowserSession>;
  fillers: AtsFiller[];
  answers: Map<string, string>;
  resumePath: string;
  /**
   * `profiles.auto_submit_authorized` for the profile this task belongs to.
   * Read per task, never once for the process — two people share a database
   * and one person's consent is not the other's.
   */
  autoSubmit?: boolean;
}

export interface ProcessResult {
  status: "applied" | "awaiting_human" | "failed";
  fillReport: FillOutcome;
  blocked: string[];
  fillerUsed: string | null;
  error: string | null;
}

/**
 * Opens the posting and fills everything answerable.
 *
 * What happens next depends on the profile: without `autoSubmit` the tab is
 * handed to the user and the task ends at awaiting_human. With it, and only
 * when every field was answered and the page confirms the send, the task ends
 * at applied. Anything short of a confirmed submission falls back to the
 * human — an application recorded but never sent is the worst outcome here,
 * because nothing will ever prompt anyone to send it.
 */
export async function processTask(
  task: ApplyTaskRow,
  deps: ProcessDeps,
): Promise<ProcessResult> {
  const session = await deps.openBrowser();
  try {
    await session.page.goto(task.applyUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await session.page.waitForTimeout(3000);

    // Resolve AFTER redirects — many boards bounce to a bespoke careers site.
    const landingUrl = session.page.url();
    const filler = selectFiller(landingUrl, deps.fillers);

    const outcome = await filler.fill({
      page: session.page,
      answers: deps.answers,
      resumePath: deps.resumePath,
    });

    if (shouldAutoSubmit({ authorized: deps.autoSubmit ?? false, blocked: outcome.blocked })) {
      const submission = await submitApplication(session.page);
      if (submission.submitted) {
        return {
          status: "applied",
          fillReport: outcome,
          blocked: [],
          fillerUsed: filler.name,
          error: null,
        };
      }
      // The click did not verify. Leave the browser open on whatever the form
      // is showing so the person can see why and finish it themselves.
      await session.page.bringToFront();
      return {
        status: "awaiting_human",
        fillReport: outcome,
        blocked: outcome.blocked,
        fillerUsed: filler.name,
        error: submission.reason,
      };
    }

    await session.page.bringToFront();

    return {
      status: "awaiting_human",
      fillReport: outcome,
      blocked: outcome.blocked,
      fillerUsed: filler.name,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      fillReport: { filled: [], blocked: [] },
      blocked: [],
      fillerUsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  // The browser is deliberately left open — the user finishes in it.
}

export async function runWorkerLoop(): Promise<void> {
  const db = createDb();
  const client = createLlmClient();
  const fillers = [
    greenhouseFiller,
    leverFiller,
    ashbyFiller,
    workableFiller,
    createGenericFiller(client),
  ];

  console.log("worker polling for queued applications…");

  for (;;) {
    // Reclaim tasks a crashed run left mid-flight.
    await db
      .update(applyTasks)
      .set({ status: "queued" })
      .where(inArray(applyTasks.status, ["opening", "filling"]));

    const [task] = await db
      .select()
      .from(applyTasks)
      .where(eq(applyTasks.status, "queued"))
      .limit(1);

    if (!task) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    await db
      .update(applyTasks)
      .set({ status: "filling", updatedAt: new Date() })
      .where(eq(applyTasks.id, task.id));

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, task.profileId));
    const answerRows = await db
      .select()
      .from(answerBank)
      .where(eq(answerBank.profileId, task.profileId));

    const answers = new Map<string, string>();
    for (const def of ANSWER_KEYS) {
      const value = resolveAnswer(answerRows, def.key);
      if (value) answers.set(def.key, value);
    }

    const result = await processTask(task, {
      openBrowser: openWorkerBrowser,
      fillers,
      answers,
      resumePath: profile?.resumeBlobUrl ?? process.env.RESUME_PATH!,
      autoSubmit: profile?.autoSubmitAuthorized ?? false,
    });

    if (result.status === "applied") {
      // Same rows `markApplied` writes when a person confirms by hand: the
      // ledger is what keeps a sent application out of every future fetch, and
      // the task is done, so it leaves the queue.
      await db.insert(jobLedger).values({
        profileId: task.profileId,
        atsKey: task.atsKey,
        slugKey: task.slugKey,
        state: "applied",
        company: task.company,
        title: task.title,
        applyUrl: task.applyUrl,
      });
      await db.delete(applyTasks).where(eq(applyTasks.id, task.id));
    } else {
      await db
        .update(applyTasks)
        .set({
          status: result.status,
          blockedFields: result.blocked,
          fillReport: result.fillReport,
          error: result.error,
          updatedAt: new Date(),
        })
        .where(eq(applyTasks.id, task.id));
    }

    console.log(
      `${task.company} — ${task.title}: ${result.status}` +
        (result.blocked.length ? ` — needs you: ${result.blocked.join("; ")}` : ""),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWorkerLoop();
}
