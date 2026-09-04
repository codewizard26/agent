import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

/**
 * The one DDL. `createLocalDb` and the test harness both apply this, so a table
 * or column added here reaches dev databases and tests together — a second copy
 * is how `feed_jobs` ended up missing from tests entirely.
 */
export const DDL = `
  CREATE TABLE IF NOT EXISTS profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL, owner_email text NOT NULL,
    resume_blob_url text, resume_text text NOT NULL,
    parsed_profile jsonb, posture jsonb,
    auto_submit_authorized boolean NOT NULL DEFAULT false,
    feed_time_frame_days integer DEFAULT 7,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS answer_bank (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    key text NOT NULL, label text NOT NULL, value text, kind text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS job_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    ats_key text, slug_key text NOT NULL, state text NOT NULL,
    company text, title text, apply_url text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS apply_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    ats_key text, slug_key text NOT NULL,
    company text NOT NULL, title text NOT NULL, apply_url text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    blocked_fields jsonb, fill_report jsonb, error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS feed_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    ats_key text, slug_key text NOT NULL,
    company text NOT NULL, title text NOT NULL, location_raw text NOT NULL,
    remote boolean NOT NULL DEFAULT false,
    apply_url text NOT NULL, source_kind text NOT NULL,
    posted_at timestamptz, date_fidelity text NOT NULL,
    score integer, tier text, why text, red_flags jsonb,
    sponsorship_gate boolean NOT NULL DEFAULT false,
    india_eligible boolean NOT NULL DEFAULT true,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS feed_jobs_profile_slug_idx
    ON feed_jobs (profile_id, slug_key);
  CREATE INDEX IF NOT EXISTS feed_jobs_profile_ats_idx
    ON feed_jobs (profile_id, ats_key);

  -- CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
  -- a column added later never reaches a local database created before it —
  -- which shows up as "column ... does not exist" in dev and in the test suite,
  -- not as a migration error. Every new column needs a line here too.
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS feed_time_frame_days integer DEFAULT 7;
`;

/** One PGlite instance per process — Next reloads modules, this must not. */
let localDb: ReturnType<typeof import("drizzle-orm/pglite").drizzle<typeof schema>> | null = null;

/**
 * PGlite resolves its own wasm through `new URL(..., import.meta.url)`. Next's
 * bundler rewrites that into a URL object which node:fs then rejects with
 * "path argument must be of type string ... Received an instance of URL".
 * A runtime require bypasses the bundler entirely.
 */
/**
 * PGlite and its drizzle adapter are both loaded on demand.
 *
 * A static `import ... from "drizzle-orm/pglite"` pulls @electric-sql/pglite in
 * at module load. That package is not installed in a deployed function, so the
 * whole module failed to load with "Cannot find module '@electric-sql/pglite'"
 * before any function body — including the DATABASE_URL guard below — could
 * run, and every page returned 500 naming a dependency rather than the cause.
 */
function loadPGlite(): typeof import("@electric-sql/pglite").PGlite {
  const require = createRequire(import.meta.url);
  return require("@electric-sql/pglite").PGlite;
}

function loadPgliteDrizzle(): typeof import("drizzle-orm/pglite").drizzle {
  const require = createRequire(import.meta.url);
  return require("drizzle-orm/pglite").drizzle;
}

/**
 * Local file-backed Postgres for development, so the app runs with no hosted
 * database. Production sets DATABASE_URL and gets Neon instead.
 */
export function createLocalDb(dir?: string) {
  if (localDb) return localDb;
  const dataDir = dir ?? path.join(process.env.HOME ?? ".", ".job-agent", "pgdata");
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const PGlite = loadPGlite();
  const pg = new PGlite(dataDir);
  localDb = loadPgliteDrizzle()(pg, { schema });
  void pg.exec(DDL);
  return localDb;
}

export function createDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    // The local fallback is for tests and a fresh clone. In a deployed function
    // PGlite is not installed, so falling through raises "Cannot find module
    // '@electric-sql/pglite'" — an error naming a dependency rather than the
    // unset variable that actually caused it. Measured 2026-09-04: that was the
    // whole content of a 500 on the first Vercel deploy.
    if (process.env.VERCEL) {
      throw new Error(
        "DATABASE_URL is not set on this deployment. Add it with " +
          "`vercel env add DATABASE_URL production` — without it the app falls " +
          "back to a local database that does not exist in a serverless function.",
      );
    }
    return createLocalDb();
  }
  return drizzleNeon(neon(url), { schema }) as never;
}
