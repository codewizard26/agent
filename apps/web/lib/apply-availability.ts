/**
 * Whether this deployment can actually apply to a job.
 *
 * Applying is not an HTTP request: the worker launches a non-headless Chrome
 * with a persistent profile, fills the form, and hands the tab to a person. A
 * serverless function has nowhere to put a browser and no process that outlives
 * a request, so on Vercel a click queues a task nothing will ever pick up.
 *
 * Measured 2026-09-04: two tasks sat at "queued" on the deployed site with no
 * worker in existence anywhere. The button was offering an action that could
 * not complete, which is worse than not offering it.
 */
export function canApplyHere(env: Record<string, string | undefined> = process.env): boolean {
  return !env.VERCEL;
}
