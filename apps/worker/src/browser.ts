import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { KEEP_NAMES_SHIM } from "./shim.js";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/** Dedicated, never the user's daily Chrome profile — Chrome locks its user-data-dir. */
export const DEFAULT_PROFILE_DIR = path.join(os.homedir(), ".job-agent", "chrome-profile");

/**
 * Verified: this configuration loads live Greenhouse forms at HTTP 200 with the
 * full application form rendered and no Cloudflare interstitial. headless must
 * stay false — the point is a real browser the user can take over.
 */
async function launch(profileDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 1000 },
  });
}

export async function openWorkerBrowser(
  profileDir: string = DEFAULT_PROFILE_DIR,
): Promise<BrowserSession> {
  let context: BrowserContext;
  try {
    context = await launch(profileDir);
  } catch (error) {
    // Chrome locks a user-data-dir, and a run that died without closing leaves
    // it locked: "Opening in existing browser session. This usually means that
    // the profile is already in use by another instance of Chromium." Every
    // later task then fails on a stale lock rather than on anything about the
    // job. A throwaway profile gets the work done; the cost is that saved
    // logins in the main profile are not available for this run.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use|existing browser session/i.test(message)) throw error;
    context = await launch(
      fs.mkdtempSync(path.join(os.tmpdir(), "job-agent-chrome-")),
    );
  }
  // Runs before every document in this context, so it is in place by the time
  // any harvest evaluates. See shim.ts — without it page.evaluate throws.
  await context.addInitScript(KEEP_NAMES_SHIM);
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, close: async () => await context.close() };
}
