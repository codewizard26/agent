import { eq, inArray } from "drizzle-orm";
import { createDb, applyTasks, answerBank, profiles } from "@job-agent/db";
import { resolveAnswer, ANSWER_KEYS, createLlmClient } from "@job-agent/core";
import { openWorkerBrowser, type BrowserSession } from "./browser.js";
import { selectFiller } from "./fillers/select.js";
import { greenhouseFiller } from "./fillers/greenhouse.js";
import { leverFiller } from "./fillers/lever.js";
import { ashbyFiller } from "./fillers/ashby.js";
import { workableFiller } from "./fillers/workable.js";
import { createGenericFiller } from "./fillers/generic.js";
import type { AtsFiller, FillOutcome } from "./fillers/types.js";

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
}

export interface ProcessResult {
  status: "awaiting_human" | "failed";
  fillReport: FillOutcome;
  blocked: string[];
  fillerUsed: string | null;
  error: string | null;
}

/**
 * Opens the posting, fills everything answerable, and hands the tab to the user.
 * It never clicks submit — cycle 1 always ends at awaiting_human.
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
    });

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

    console.log(
      `${task.company} — ${task.title}: ${result.status}` +
        (result.blocked.length ? ` — needs you: ${result.blocked.join("; ")}` : ""),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runWorkerLoop();
}
