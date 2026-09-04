import type { Page } from "playwright-core";

/**
 * Clicking submit is the one step in this app that cannot be undone. A filled
 * form can be abandoned; a sent application is in the employer's system under
 * the candidate's name.
 *
 * So the decision to click is a pure function with two inputs, tested on its
 * own, and the Playwright work below only happens once it returns true.
 */

export interface AutoSubmitDecision {
  /** `profiles.auto_submit_authorized` for THIS profile. Never global. */
  authorized: boolean;
  /** Labels the filler could not answer. Any entry means a human is needed. */
  blocked: string[];
}

export function shouldAutoSubmit(decision: AutoSubmitDecision): boolean {
  if (!decision.authorized) return false;
  // A required question the answer bank could not answer is still required.
  // Submitting regardless either trips the form's own validation or sends a
  // blank answer, and neither is recoverable.
  return decision.blocked.length === 0;
}

/**
 * Ordered most specific first — the first match is clicked. The bare
 * `button[type="submit"]` is last on purpose: on several careers sites that
 * selector also matches a newsletter sign-up in the page footer.
 */
export const SUBMIT_SELECTORS = [
  'button:has-text("Submit application")',
  'button:has-text("Submit Application")',
  'input[value="Submit Application"]',
  'button:has-text("Submit your application")',
  '#submit_app',
  'button:has-text("Submit")',
  'button[type="submit"]',
] as const;

const CONFIRMATIONS = [
  /thank(s| you) for (applying|your application)/i,
  /your application has been (submitted|received)/i,
  /application (submitted|received|complete)/i,
  /we('| ha)ve received your application/i,
];

/**
 * Reads a page as confirming a submission.
 *
 * Deliberately strict: "Submit application" is the button's own label and is
 * present before anything is sent, so a loose check would mark unsent
 * applications as applied — the one mistake this path must never make.
 */
export function confirmsSubmission(pageText: string): boolean {
  if (!pageText.trim()) return false;
  return CONFIRMATIONS.some((pattern) => pattern.test(pageText));
}

export interface SubmitResult {
  submitted: boolean;
  /** Why it did not submit, for the task row. Null when it did. */
  reason: string | null;
}

/**
 * Clicks the form's submit control and verifies the page agrees it went
 * through. An unverified click reports `submitted: false`, so the task stays
 * with the human rather than being recorded as an application that may not
 * exist.
 */
export async function submitApplication(page: Page): Promise<SubmitResult> {
  for (const selector of SUBMIT_SELECTORS) {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) continue;
    if (!(await control.isVisible().catch(() => false))) continue;

    await control.click({ timeout: 8_000 });
    // Boards either navigate to a confirmation page or swap the form out in
    // place, so wait for the network to settle rather than for a URL change.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const text = await page.innerText("body").catch(() => "");
    if (confirmsSubmission(text)) return { submitted: true, reason: null };
    // The click may well have worked and CONFIRMATIONS simply may not know this
    // board's wording yet. Carry the page's own words back so the gap is
    // fixable from the task row instead of by guessing at another regex.
    return {
      submitted: false,
      reason:
        `clicked ${selector} but no confirmation matched. Page said: ` +
        text.replace(/\s+/g, " ").trim().slice(0, 300),
    };
  }

  return { submitted: false, reason: "no submit control found on the page" };
}
