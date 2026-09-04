/**
 * `createDb()` falls back to a local PGlite file when DATABASE_URL is unset,
 * which is right for a test run and wrong for this process.
 *
 * The worker is the half of the system that acts on rows the web app writes.
 * Pointed at a different database it does not fail — it polls an empty one for
 * ever, so every Apply click in the browser looks like a broken button and
 * nothing anywhere reports an error. Measured 2026-09-04: the worker script had
 * no --env-file flag, saw 0 apply_tasks, and said nothing about it.
 */
export function assertSharedDatabase(env: Record<string, string | undefined>): void {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error(
      "worker: DATABASE_URL is unset, so it would poll a local scratch database " +
        "instead of the one the web app writes to. Start it from the repo root " +
        "with `pnpm dev`, which passes --env-file-if-exists=apps/web/.env.",
    );
  }
}
