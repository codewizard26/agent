import path from "node:path";
import os from "node:os";
import { chromium, type BrowserContext, type Page } from "playwright-core";

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
export async function openWorkerBrowser(
  profileDir: string = DEFAULT_PROFILE_DIR,
): Promise<BrowserSession> {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 1000 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, close: async () => await context.close() };
}
