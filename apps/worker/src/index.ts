import { eq, inArray } from "drizzle-orm";
import { createDb, applyTasks, answerBank, profiles, jobLedger } from "@job-agent/db";
import { resolveAnswer, ANSWER_KEYS, createLlmClient } from "@job-agent/core";
import { createAnswerComposer } from "./compose.js";
import { openWorkerBrowser, type BrowserSession } from "./browser.js";
import { selectFiller } from "./fillers/select.js";
import { greenhouseFiller } from "./fillers/greenhouse.js";
import { leverFiller } from "./fillers/lever.js";
import { ashbyFiller } from "./fillers/ashby.js";
import { workableFiller } from "./fillers/workable.js";
import { createGenericFiller } from "./fillers/generic.js";
import type { AtsFiller, FillOutcome } from "./fillers/types.js";
import { shouldAutoSubmit, submitApplication } from "./submit.js";
import { resolveResumePath } from "./resume.js";
import { assertSharedDatabase } from "./database.js";
import { classifyPage, withDeadline } from "./page-state.js";
import type { AnswerComposer } from "./compose.js";
import { harvestFields } from "./harvest.js";

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
  /** Writes answers for questions the answer bank does not cover. */
  compose?: AnswerComposer;
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
  // Inside the try: a launch failure — most often the persistent Chrome
  // profile still locked by an earlier run — used to propagate out of here and
  // out of runWorkerLoop, killing the worker process and, under `pnpm dev`,
  // the web server alongside it. One bad task must only fail that task.
  let session: BrowserSession;
  try {
    session = await deps.openBrowser();
  } catch (error) {
    return {
      status: "failed",
      fillReport: { filled: [], blocked: [] },
      blocked: [],
      fillerUsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const response = await session.page.goto(task.applyUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await session.page.waitForTimeout(1500);

    // What did we actually land on? A board row can outlive the posting behind
    // it, and a websearch result often points at a listing rather than a form.
    // Deciding this before filling is what keeps a dead link from becoming a
    // task that never finishes.
    const landed = classifyPage({
      status: response?.status() ?? null,
      text: await session.page.innerText("body").catch(() => ""),
      fieldCount: (await harvestFields(session.page).catch(() => [])).length,
    });

    if (landed.kind === "gone") {
      // Nothing to hand a person either — the posting does not exist.
      await session.close();
      return {
        status: "failed",
        fillReport: { filled: [], blocked: [] },
        blocked: [],
        fillerUsed: null,
        error: `posting is gone (${landed.reason})`,
      };
    }

    if (landed.kind === "no-form") {
      // Live, but not an application: a listing or a search page. The queue row
      // keeps the URL, so it opens in the person's own browser rather than
      // leaving this one parked here.
      await session.close();
      return {
        status: "awaiting_human",
        fillReport: { filled: [], blocked: [] },
        blocked: [],
        fillerUsed: null,
        error: "no application form on this page — apply here by hand",
      };
    }

    // Resolve AFTER redirects — many boards bounce to a bespoke careers site.
    const landingUrl = session.page.url();
    const filler = selectFiller(landingUrl, deps.fillers);

    const outcome = await filler.fill({
      page: session.page,
      answers: deps.answers,
      resumePath: deps.resumePath,
      compose: deps.compose,
    });

    if (shouldAutoSubmit({ authorized: deps.autoSubmit ?? false, blocked: outcome.blocked })) {
      const submission = await submitApplication(session.page);
      if (submission.submitted) {
        await session.close();
        return {
          status: "applied",
          fillReport: outcome,
          blocked: [],
          fillerUsed: filler.name,
          error: null,
        };
      }
      await session.close();
      return {
        status: "awaiting_human",
        fillReport: outcome,
        blocked: outcome.blocked,
        fillerUsed: filler.name,
        error: submission.reason,
      };
    }

    await session.close();

    return {
      status: "awaiting_human",
      fillReport: outcome,
      blocked: outcome.blocked,
      fillerUsed: filler.name,
      error: null,
    };
  } catch (error) {
    await session.close().catch(() => {});
    return {
      status: "failed",
      fillReport: { filled: [], blocked: [] },
      blocked: [],
      fillerUsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Ceiling on one whole application, browser launch included. */
const TASK_DEADLINE_MS = 90_000;

export async function runWorkerLoop(): Promise<void> {
  assertSharedDatabase(process.env);
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
      // Short enough that pressing Apply in the browser feels like the click
      // itself did the work, rather than like something was filed away.
      await new Promise((r) => setTimeout(r, 800));
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

    // One task must never be able to stop the queue — not by hanging, and not
    // by throwing something processTask did not anticipate.
    const result = await withDeadline(
      () => processTask(task, {
      openBrowser: openWorkerBrowser,
      fillers,
      answers,
      resumePath: resolveResumePath({
        name: profile?.name ?? task.profileId,
        resumeBlobUrl: profile?.resumeBlobUrl ?? null,
      }),
      autoSubmit: profile?.autoSubmitAuthorized ?? false,
      compose: createAnswerComposer(client, {
        resumeText: profile?.resumeText ?? "",
        known: answers,
        company: task.company,
        title: task.title,
      }),
      }),
      TASK_DEADLINE_MS,
      `${task.company} — ${task.title}`,
    ).catch((error: unknown) => ({
      status: "failed" as const,
      fillReport: { filled: [], blocked: [] },
      blocked: [] as string[],
      fillerUsed: null,
      error: error instanceof Error ? error.message : String(error),
    }));

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
        (result.blocked.length ? ` — needs you: ${result.blocked.join("; ")}` : "") +
        (result.error ? ` — ${result.error.slice(0, 160)}` : ""),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWorkerLoop();
}
