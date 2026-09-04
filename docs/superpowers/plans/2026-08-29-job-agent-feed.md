# Job Agent — Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the on-demand job feed — click "Fetch latest jobs for me" on a resume profile and get a ranked, deduped list of postings within a chosen time frame, excluding anything already applied to or dismissed.

**Architecture:** A pnpm workspace. `packages/core` holds pure logic — source adapters, normalization, job keys, the profile-derived filter, Claude ranking — with no I/O beyond `fetch` and the Anthropic SDK. `packages/db` holds the Drizzle schema for the three tables that persist. `apps/web` is a Next.js App Router UI that streams pipeline progress over Server-Sent Events. Nothing warehouses postings; a fetch returns them and they live in page state.

**Tech Stack:** TypeScript, pnpm workspaces, Next.js 15 (App Router), Drizzle ORM, Neon Postgres (PGlite in tests), Vitest, Zod, `@anthropic-ai/sdk`, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-29-job-agent-design.md`

## Global Constraints

- **Node 20+**, pnpm 9+. All packages `"type": "module"`.
- **Greenhouse post dates read `first_published`, never `updated_at`.** `updated_at` reflects edits; using it reports stale jobs as fresh. This is the single most important correctness rule in the codebase.
- **Ashby carries `dateFidelity: 'none'`** and is excluded from time-framed fetches. It appears only when the time frame is "any".
- **Three date-fidelity levels.** `'true'` = a machine-readable creation field. `'reported'` = a date a model read off a page (web-search results) — allowed in time-framed fetches but labelled distinctly in the UI. `'none'` = no date at all.
- **X/Twitter is not ingested directly.** `api.twitter.com/2/tweets/search/recent` returns 401 unauthenticated and the free tier carries no search endpoint. X hiring posts are reached only as indexed pages through the web-search adapter (Task 16).
- **Nothing is hardcoded to a person.** Seniority band, core stack, and geography posture derive from `parsed_profile`. Two seeded profiles exercise opposite seniority.
- **Model IDs live only in `packages/core/src/models.ts`.** Exact strings, no date suffixes: `claude-opus-5`, `claude-haiku-4-5`. Never `claude-haiku-4-5-20251001`.
- **Structured model output uses `client.messages.parse()` with `zodOutputFormat`.** Never hand-parse JSON from a text block.
- **Only three tables persist:** `profiles`, `answer_bank`, `job_ledger` (+ `apply_tasks`, built in the apply plan). No table accumulates postings.
- **Tests never hit live endpoints** except the explicitly separate `pnpm test:live`.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`).

---

## File Structure

```
job-agent/
├── package.json                       workspace root, scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts                   workspace-wide test config
├── sources/boards.yaml                curated company board tokens
├── packages/
│   ├── core/
│   │   ├── src/models.ts              model ID constants — the only place they appear
│   │   ├── src/types.ts               NormalizedJob, SourceAdapter, ParsedProfile, …
│   │   ├── src/job-key.ts             normalizeTitle, buildJobKey, ledgerKeys
│   │   ├── src/adapters/greenhouse.ts
│   │   ├── src/adapters/lever.ts
│   │   ├── src/adapters/remoteok.ts
│   │   ├── src/adapters/arbeitnow.ts
│   │   ├── src/adapters/ashby.ts
│   │   ├── src/adapters/hn.ts
│   │   ├── src/adapters/web-search.ts Claude web_search — Google + X/Twitter posts
│   │   ├── src/adapters/bluesky.ts    hiring posts via app-password auth
│   │   ├── src/adapters/discover.ts   grows boards.yaml from company names
│   │   ├── src/adapters/index.ts      registry + capped fan-out
│   │   ├── src/filter.ts              profile-derived Tier 1
│   │   ├── src/rank.ts                Claude ranking
│   │   ├── src/resume.ts              PDF text → ParsedProfile
│   │   └── src/pipeline.ts            orchestration, yields ProgressEvent
│   └── db/
│       ├── src/schema.ts              profiles, answer_bank, job_ledger, apply_tasks
│       ├── src/client.ts              Neon connection
│       ├── src/test-db.ts             PGlite harness for tests
│       └── drizzle.config.ts
└── apps/web/
    ├── app/page.tsx                   profile switcher
    ├── app/profiles/[id]/page.tsx     dashboard
    ├── app/api/fetch/route.ts         SSE streaming fetch
    ├── app/actions.ts                 dismiss / mark-applied server actions
    └── components/                    JobCard, FetchControls, ProgressLog
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Test: `packages/core/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm test` that discovers tests under `packages/*/src/**/*.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("workspace", () => {
  it("runs typescript tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test`
Expected: FAIL — `pnpm: command not found: test` or "No test files found", because nothing is configured yet.

- [ ] **Step 3: Write the scaffold**

`package.json`:

```json
{
  "name": "job-agent",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:live": "vitest run --config vitest.live.config.ts",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "composite": true
  }
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
  },
});
```

`packages/core/package.json`:

```json
{
  "name": "@job-agent/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.122.0",
    "zod": "^4.0.0",
    "yaml": "^2.5.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Install and run tests**

Run: `pnpm install && pnpm test`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts packages/core
git commit -m "chore: scaffold pnpm workspace with vitest"
```

---

### Task 2: Job key — the ledger's identity mechanism

This is the highest-risk unit in the codebase. In an on-demand design the key is the *only* thing making "jobs I haven't applied to" work. A miss means an applied job reappears.

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/job-key.ts`
- Test: `packages/core/src/job-key.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeTitle(title: string): string`, `slugify(s: string): string`, `buildJobKey(input: {company: string; title: string; atsKind: AtsKind | null; atsRef: string | null}): JobKey`, `ledgerMatchKeys(k: JobKey): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/job-key.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeTitle, buildJobKey, ledgerMatchKeys } from "./job-key.js";

describe("normalizeTitle", () => {
  it("strips parenthetical suffixes", () => {
    expect(normalizeTitle("Senior Software Engineer (Remote)")).toBe(
      "senior software engineer",
    );
  });

  it("strips trailing location fragments after a dash", () => {
    expect(normalizeTitle("Senior Software Engineer - Bangalore")).toBe(
      "senior software engineer",
    );
  });

  it("strips gendered posting markers", () => {
    expect(normalizeTitle("Backend Engineer (m/f/d)")).toBe("backend engineer");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeTitle("Full-Stack   Engineer,  II")).toBe(
      "full stack engineer ii",
    );
  });

  it("keeps genuinely different roles distinct", () => {
    expect(normalizeTitle("Frontend Engineer")).not.toBe(
      normalizeTitle("Backend Engineer"),
    );
  });
});

describe("buildJobKey", () => {
  it("prefers exact ATS identity when available", () => {
    const key = buildJobKey({
      company: "Discord",
      title: "Senior Software Engineer",
      atsKind: "greenhouse",
      atsRef: "discord/8599937002",
    });
    expect(key.atsKey).toBe("greenhouse:discord/8599937002");
    expect(key.slugKey).toBe("discord|senior software engineer");
  });

  it("falls back to slug key with no ATS identity", () => {
    const key = buildJobKey({
      company: "Acme Corp",
      title: "Full Stack Engineer (Remote)",
      atsKind: null,
      atsRef: null,
    });
    expect(key.atsKey).toBeNull();
    expect(key.slugKey).toBe("acme corp|full stack engineer");
  });

  it("gives the same slug key for the same role from different sources", () => {
    const fromBoard = buildJobKey({
      company: "Acme Corp",
      title: "Senior Software Engineer",
      atsKind: null,
      atsRef: null,
    });
    const fromAggregator = buildJobKey({
      company: "Acme  Corp.",
      title: "Senior Software Engineer (Remote)",
      atsKind: null,
      atsRef: null,
    });
    expect(fromAggregator.slugKey).toBe(fromBoard.slugKey);
  });
});

describe("ledgerMatchKeys", () => {
  it("returns both keys when ATS identity exists", () => {
    expect(
      ledgerMatchKeys({ atsKey: "lever:spotify/abc", slugKey: "spotify|engineer" }),
    ).toEqual(["lever:spotify/abc", "spotify|engineer"]);
  });

  it("returns only the slug key when there is no ATS identity", () => {
    expect(ledgerMatchKeys({ atsKey: null, slugKey: "acme|engineer" })).toEqual([
      "acme|engineer",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/job-key.test.ts`
Expected: FAIL — "Failed to resolve import ./job-key.js".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/types.ts`:

```typescript
export type SourceKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "remoteok"
  | "arbeitnow"
  | "hn"
  | "websearch"
  | "bluesky";

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable";

/**
 * 'true'     — a machine-readable creation field from the source.
 * 'reported' — a date a model read off a page. Usable, but not a real field.
 * 'none'     — the source exposes no date at all.
 */
export type DateFidelity = "true" | "reported" | "none";

export interface JobKey {
  /** Exact ATS identity, e.g. "greenhouse:discord/8599937002". Null when unknown. */
  atsKey: string | null;
  /** Fallback identity, e.g. "discord|senior software engineer". Always present. */
  slugKey: string;
}

export interface NormalizedJob {
  key: JobKey;
  sourceKind: SourceKind;
  company: string;
  title: string;
  locationRaw: string;
  remote: boolean;
  descriptionText: string;
  applyUrl: string;
  atsKind: AtsKind | null;
  atsRef: string | null;
  postedAt: Date | null;
  dateFidelity: DateFidelity;
}
```

Create `packages/core/src/job-key.ts`:

```typescript
import type { AtsKind, JobKey } from "./types.js";

/** Lowercase, strip punctuation, collapse whitespace. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalizes a job title so the same role from different sources produces one key.
 * Order matters: strip bracketed and trailing fragments before slugifying, because
 * slugify would otherwise destroy the delimiters we key on.
 */
export function normalizeTitle(title: string): string {
  let t = title;
  // "(Remote)", "(m/f/d)", "[Contract]"
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, "");
  // trailing " - Bangalore", " – EMEA", " — Remote"
  t = t.replace(/\s+[-–—]\s+.*$/, "");
  return slugify(t);
}

export function buildJobKey(input: {
  company: string;
  title: string;
  atsKind: AtsKind | null;
  atsRef: string | null;
}): JobKey {
  const slugKey = `${slugify(input.company)}|${normalizeTitle(input.title)}`;
  const atsKey =
    input.atsKind && input.atsRef ? `${input.atsKind}:${input.atsRef}` : null;
  return { atsKey, slugKey };
}

/** Every key a ledger row for this job could match on. */
export function ledgerMatchKeys(key: JobKey): string[] {
  return key.atsKey ? [key.atsKey, key.slugKey] : [key.slugKey];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/job-key.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/job-key.ts packages/core/src/job-key.test.ts
git commit -m "feat: job key with dual ATS and slug identity"
```

---

### Task 3: Database schema

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/test-db.ts`
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles`, `answerBank`, `jobLedger`, `applyTasks` Drizzle tables; `createTestDb(): Promise<TestDb>` returning `{ db, close }`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db.js";
import { profiles, jobLedger } from "./schema.js";

let handle: TestDb;
afterEach(async () => await handle?.close());

describe("schema", () => {
  it("stores a profile and reads it back", async () => {
    handle = await createTestDb();
    const [row] = await handle.db
      .insert(profiles)
      .values({
        name: "Nikhil Mishra",
        ownerEmail: "nikhilmishra2608@gmail.com",
        resumeText: "Full Stack Blockchain Developer",
        parsedProfile: { yearsExperience: 5 },
        posture: { regions: ["global"], remoteGlobal: true, needsSponsorship: false },
      })
      .returning();
    expect(row!.autoSubmitAuthorized).toBe(false);
    expect(row!.parsedProfile).toEqual({ yearsExperience: 5 });
  });

  it("excludes a job by either key", async () => {
    handle = await createTestDb();
    const [p] = await handle.db
      .insert(profiles)
      .values({ name: "T", ownerEmail: "t@example.com", resumeText: "" })
      .returning();

    await handle.db.insert(jobLedger).values({
      profileId: p!.id,
      atsKey: "greenhouse:discord/1",
      slugKey: "discord|senior software engineer",
      state: "applied",
    });

    const rows = await handle.db
      .select()
      .from(jobLedger)
      .where(eq(jobLedger.profileId, p!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("applied");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/db/src/schema.test.ts`
Expected: FAIL — cannot resolve `./test-db.js`.

- [ ] **Step 3: Write the implementation**

`packages/db/package.json`:

```json
{
  "name": "@job-agent/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "generate": "drizzle-kit generate", "migrate": "drizzle-kit migrate" },
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "@neondatabase/serverless": "^0.10.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "@electric-sql/pglite": "^0.2.0"
  }
}
```

`packages/db/tsconfig.json`: same shape as `packages/core/tsconfig.json`.

Create `packages/db/src/schema.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  resumeBlobUrl: text("resume_blob_url"),
  resumeText: text("resume_text").notNull(),
  parsedProfile: jsonb("parsed_profile"),
  posture: jsonb("posture"),
  autoSubmitAuthorized: boolean("auto_submit_authorized").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const answerBank = pgTable(
  "answer_bank",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    kind: text("kind", { enum: ["text", "select", "boolean", "file"] }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byProfile: index("answer_bank_profile_idx").on(t.profileId) }),
);

export const jobLedger = pgTable(
  "job_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    atsKey: text("ats_key"),
    slugKey: text("slug_key").notNull(),
    state: text("state", { enum: ["applied", "dismissed"] }).notNull(),
    company: text("company"),
    title: text("title"),
    applyUrl: text("apply_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProfileAts: index("job_ledger_profile_ats_idx").on(t.profileId, t.atsKey),
    byProfileSlug: index("job_ledger_profile_slug_idx").on(t.profileId, t.slugKey),
  }),
);

export const applyTasks = pgTable("apply_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  atsKey: text("ats_key"),
  slugKey: text("slug_key").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  applyUrl: text("apply_url").notNull(),
  status: text("status", {
    enum: ["queued", "opening", "filling", "awaiting_human", "failed"],
  })
    .notNull()
    .default("queued"),
  blockedFields: jsonb("blocked_fields"),
  fillReport: jsonb("fill_report"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Create `packages/db/src/test-db.ts`:

```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  close: () => Promise<void>;
}

/**
 * In-process Postgres for tests. No Docker, no shared state — each call is a
 * fresh database. DDL is applied directly rather than through drizzle-kit so
 * tests do not depend on generated migration files being current.
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });

  // pg.exec, not drizzle's db.execute: drizzle prepares the statement and
  // PGlite rejects "multiple commands into a prepared statement".
  await pg.exec(`
    CREATE TABLE profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      owner_email text NOT NULL,
      resume_blob_url text,
      resume_text text NOT NULL,
      parsed_profile jsonb,
      posture jsonb,
      auto_submit_authorized boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE answer_bank (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      key text NOT NULL, label text NOT NULL, value text, kind text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE job_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      ats_key text, slug_key text NOT NULL, state text NOT NULL,
      company text, title text, apply_url text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE apply_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      ats_key text, slug_key text NOT NULL,
      company text NOT NULL, title text NOT NULL, apply_url text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      blocked_fields jsonb, fill_report jsonb, error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  return { db, close: async () => await pg.close() };
}
```

Create `packages/db/src/client.ts`:

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema });
}
```

Create `packages/db/src/index.ts`:

```typescript
export * from "./schema.js";
export * from "./client.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm install && pnpm vitest run packages/db/src/schema.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat: drizzle schema with pglite test harness"
```

---

### Task 4: Greenhouse adapter

**Files:**
- Create: `packages/core/src/adapters/greenhouse.ts`
- Create: `packages/core/src/adapters/fixtures/greenhouse-discord.json`
- Test: `packages/core/src/adapters/greenhouse.test.ts`

**Interfaces:**
- Consumes: `NormalizedJob`, `buildJobKey` from Task 2.
- Produces: `greenhouseAdapter: SourceAdapter` with `kind: "greenhouse"`, `dateFidelity: "true"`, `fetchBoard(token: string): Promise<GreenhouseJob[]>`, `normalizeGreenhouse(raw: GreenhouseJob, token: string): NormalizedJob`.

- [ ] **Step 1: Capture the fixture**

Run:

```bash
mkdir -p packages/core/src/adapters/fixtures
curl -s "https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true" \
  > packages/core/src/adapters/fixtures/greenhouse-discord.json
```

Confirm it contains `first_published`, and — this matters — that at least one job has `first_published` **different from** `updated_at`:

```bash
node -e '
const jobs = require("./packages/core/src/adapters/fixtures/greenhouse-discord.json").jobs;
const differing = jobs.filter(j => j.first_published && j.updated_at && j.first_published !== j.updated_at);
console.log(`${jobs.length} jobs, ${differing.length} with differing dates`);
'
```

Expected: a non-zero count in the second number.

**If the count is zero**, hand-edit one row in the committed fixture so its `updated_at` is later than its `first_published`. This is a committed fixture — pinned test data, not a live sample — and the test below is the only thing standing between the codebase and the silent freshness lie described in Global Constraints. A test that can pass vacuously because of what a board happened to contain on capture day is not a guard.

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/adapters/greenhouse.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/greenhouse-discord.json" with { type: "json" };
import { normalizeGreenhouse, type GreenhouseJob } from "./greenhouse.js";

const jobs = (fixture as { jobs: GreenhouseJob[] }).jobs;

describe("greenhouse adapter", () => {
  it("reads postedAt from first_published, never updated_at", () => {
    const raw = jobs.find(
      (j) => j.first_published && j.updated_at && j.first_published !== j.updated_at,
    );
    expect(raw, "fixture needs a job where the two dates differ").toBeDefined();

    const job = normalizeGreenhouse(raw!, "discord");
    expect(job.postedAt?.toISOString()).toBe(new Date(raw!.first_published!).toISOString());
    expect(job.postedAt?.toISOString()).not.toBe(new Date(raw!.updated_at).toISOString());
  });

  it("marks date fidelity as true", () => {
    expect(normalizeGreenhouse(jobs[0]!, "discord").dateFidelity).toBe("true");
  });

  it("builds an exact ATS key from token and job id", () => {
    const job = normalizeGreenhouse(jobs[0]!, "discord");
    expect(job.key.atsKey).toBe(`greenhouse:discord/${jobs[0]!.id}`);
    expect(job.atsKind).toBe("greenhouse");
  });

  it("strips HTML entities and tags from the description", () => {
    const job = normalizeGreenhouse(
      { ...jobs[0]!, content: "<p>Build&nbsp;things &amp; ship</p>" },
      "discord",
    );
    expect(job.descriptionText).toBe("Build things & ship");
  });

  it("returns null postedAt when first_published is absent", () => {
    const job = normalizeGreenhouse({ ...jobs[0]!, first_published: null }, "discord");
    expect(job.postedAt).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/greenhouse.test.ts`
Expected: FAIL — cannot resolve `./greenhouse.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/adapters/greenhouse.ts`:

```typescript
import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

export interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
  location: { name: string };
  /** True first-publish date. THE field to filter on. */
  first_published: string | null;
  /** Reflects edits. Filtering on this reports stale jobs as fresh — never use it. */
  updated_at: string;
}

/** Decode the entities Greenhouse emits, then strip tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeGreenhouse(
  raw: GreenhouseJob,
  token: string,
): NormalizedJob {
  const location = raw.location?.name ?? "";
  return {
    key: buildJobKey({
      company: token,
      title: raw.title,
      atsKind: "greenhouse",
      atsRef: `${token}/${raw.id}`,
    }),
    sourceKind: "greenhouse",
    company: token,
    title: raw.title,
    locationRaw: location,
    remote: /remote/i.test(location) || /remote/i.test(raw.title),
    descriptionText: raw.content ? htmlToText(raw.content) : "",
    applyUrl: raw.absolute_url,
    atsKind: "greenhouse",
    atsRef: `${token}/${raw.id}`,
    // first_published, NOT updated_at. See Global Constraints.
    postedAt: raw.first_published ? new Date(raw.first_published) : null,
    dateFidelity: "true",
  };
}

export async function fetchGreenhouseBoard(token: string): Promise<GreenhouseJob[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  );
  if (!res.ok) throw new Error(`greenhouse ${token}: HTTP ${res.status}`);
  const body = (await res.json()) as { jobs?: GreenhouseJob[] };
  return body.jobs ?? [];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/greenhouse.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapters
git commit -m "feat: greenhouse adapter reading first_published"
```

---

### Task 5: Lever adapter

**Files:**
- Create: `packages/core/src/adapters/lever.ts`
- Create: `packages/core/src/adapters/fixtures/lever-spotify.json`
- Test: `packages/core/src/adapters/lever.test.ts`

**Interfaces:**
- Consumes: `buildJobKey`, `NormalizedJob`.
- Produces: `normalizeLever(raw: LeverPosting, token: string): NormalizedJob`, `fetchLeverBoard(token: string): Promise<LeverPosting[]>`.

- [ ] **Step 1: Capture the fixture**

```bash
curl -s "https://api.lever.co/v0/postings/spotify?mode=json" \
  > packages/core/src/adapters/fixtures/lever-spotify.json
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/adapters/lever.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fixture from "./fixtures/lever-spotify.json" with { type: "json" };
import { normalizeLever, type LeverPosting } from "./lever.js";

const postings = fixture as LeverPosting[];

describe("lever adapter", () => {
  it("converts createdAt epoch millis to a Date", () => {
    const raw = postings[0]!;
    const job = normalizeLever(raw, "spotify");
    expect(job.postedAt?.getTime()).toBe(raw.createdAt);
    expect(job.dateFidelity).toBe("true");
  });

  it("builds an exact ATS key from token and posting id", () => {
    const job = normalizeLever(postings[0]!, "spotify");
    expect(job.key.atsKey).toBe(`lever:spotify/${postings[0]!.id}`);
  });

  it("prefers applyUrl over hostedUrl", () => {
    const job = normalizeLever(
      { ...postings[0]!, hostedUrl: "https://h", applyUrl: "https://a" },
      "spotify",
    );
    expect(job.applyUrl).toBe("https://a");
  });

  it("falls back to hostedUrl when applyUrl is missing", () => {
    const { applyUrl: _drop, ...rest } = postings[0]!;
    const job = normalizeLever({ ...rest, hostedUrl: "https://h" } as LeverPosting, "spotify");
    expect(job.applyUrl).toBe("https://h");
  });

  it("detects remote from workplaceType", () => {
    const job = normalizeLever(
      { ...postings[0]!, workplaceType: "remote" },
      "spotify",
    );
    expect(job.remote).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/lever.test.ts`
Expected: FAIL — cannot resolve `./lever.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/adapters/lever.ts`:

```typescript
import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

export interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt: number; // epoch millis
  descriptionPlain?: string;
  workplaceType?: string;
  categories?: { location?: string; team?: string; commitment?: string };
}

export function normalizeLever(raw: LeverPosting, token: string): NormalizedJob {
  const location = raw.categories?.location ?? "";
  return {
    key: buildJobKey({
      company: token,
      title: raw.text,
      atsKind: "lever",
      atsRef: `${token}/${raw.id}`,
    }),
    sourceKind: "lever",
    company: token,
    title: raw.text,
    locationRaw: location,
    remote:
      raw.workplaceType === "remote" ||
      /remote/i.test(location) ||
      /remote/i.test(raw.text),
    descriptionText: raw.descriptionPlain ?? "",
    applyUrl: raw.applyUrl ?? raw.hostedUrl,
    atsKind: "lever",
    atsRef: `${token}/${raw.id}`,
    postedAt: new Date(raw.createdAt),
    dateFidelity: "true",
  };
}

export async function fetchLeverBoard(token: string): Promise<LeverPosting[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
  if (!res.ok) throw new Error(`lever ${token}: HTTP ${res.status}`);
  return (await res.json()) as LeverPosting[];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/lever.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapters
git commit -m "feat: lever adapter with createdAt post dates"
```

---

### Task 6: RemoteOK and Arbeitnow adapters

Both are single-endpoint full dumps with no board tokens, so they share a task.

**Files:**
- Create: `packages/core/src/adapters/remoteok.ts`, `packages/core/src/adapters/arbeitnow.ts`
- Create: `packages/core/src/adapters/fixtures/remoteok.json`, `packages/core/src/adapters/fixtures/arbeitnow.json`
- Test: `packages/core/src/adapters/aggregators.test.ts`

**Interfaces:**
- Consumes: `buildJobKey`, `NormalizedJob`.
- Produces: `normalizeRemoteOk(raw: RemoteOkJob): NormalizedJob | null`, `fetchRemoteOk(): Promise<RemoteOkJob[]>`, `normalizeArbeitnow(raw: ArbeitnowJob): NormalizedJob`, `fetchArbeitnow(): Promise<ArbeitnowJob[]>`.

- [ ] **Step 1: Capture the fixtures**

```bash
curl -s -A "job-agent" "https://remoteok.com/api" > packages/core/src/adapters/fixtures/remoteok.json
curl -s "https://www.arbeitnow.com/api/job-board-api" > packages/core/src/adapters/fixtures/arbeitnow.json
```

Note: RemoteOK's first array element is a legal notice, not a job. The adapter must skip it.

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/adapters/aggregators.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import remoteokFixture from "./fixtures/remoteok.json" with { type: "json" };
import arbeitnowFixture from "./fixtures/arbeitnow.json" with { type: "json" };
import { normalizeRemoteOk, type RemoteOkJob } from "./remoteok.js";
import { normalizeArbeitnow, type ArbeitnowJob } from "./arbeitnow.js";

describe("remoteok adapter", () => {
  const rows = remoteokFixture as RemoteOkJob[];

  it("skips the legal-notice element that has no position", () => {
    expect(normalizeRemoteOk(rows[0]!)).toBeNull();
  });

  it("converts epoch seconds to a Date", () => {
    const raw = rows.find((r) => r.position && r.epoch)!;
    const job = normalizeRemoteOk(raw)!;
    expect(job.postedAt?.getTime()).toBe(raw.epoch! * 1000);
    expect(job.dateFidelity).toBe("true");
  });

  it("has no ATS key, only a slug key", () => {
    const raw = rows.find((r) => r.position)!;
    const job = normalizeRemoteOk(raw)!;
    expect(job.key.atsKey).toBeNull();
    expect(job.key.slugKey).toContain("|");
  });

  it("marks every posting remote", () => {
    const raw = rows.find((r) => r.position)!;
    expect(normalizeRemoteOk(raw)!.remote).toBe(true);
  });
});

describe("arbeitnow adapter", () => {
  const rows = (arbeitnowFixture as { data: ArbeitnowJob[] }).data;

  it("converts created_at epoch seconds to a Date", () => {
    const job = normalizeArbeitnow(rows[0]!);
    expect(job.postedAt?.getTime()).toBe(rows[0]!.created_at * 1000);
    expect(job.dateFidelity).toBe("true");
  });

  it("carries the remote flag through", () => {
    const job = normalizeArbeitnow({ ...rows[0]!, remote: true });
    expect(job.remote).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/aggregators.test.ts`
Expected: FAIL — cannot resolve `./remoteok.js`.

- [ ] **Step 4: Write the implementations**

Create `packages/core/src/adapters/remoteok.ts`:

```typescript
import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
import type { NormalizedJob } from "../types.js";

export interface RemoteOkJob {
  id?: string;
  slug?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  epoch?: number; // seconds
  tags?: string[];
}

/** Returns null for rows that are not job postings (element 0 is a legal notice). */
export function normalizeRemoteOk(raw: RemoteOkJob): NormalizedJob | null {
  if (!raw.position || !raw.company) return null;
  return {
    key: buildJobKey({
      company: raw.company,
      title: raw.position,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "remoteok",
    company: raw.company,
    title: raw.position,
    locationRaw: raw.location ?? "Remote",
    remote: true, // every RemoteOK posting is remote by definition
    descriptionText: raw.description ? htmlToText(raw.description) : "",
    applyUrl: raw.apply_url ?? raw.url ?? "",
    atsKind: null,
    atsRef: null,
    postedAt: raw.epoch ? new Date(raw.epoch * 1000) : null,
    dateFidelity: "true",
  };
}

export async function fetchRemoteOk(): Promise<RemoteOkJob[]> {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "job-agent" },
  });
  if (!res.ok) throw new Error(`remoteok: HTTP ${res.status}`);
  return (await res.json()) as RemoteOkJob[];
}
```

Create `packages/core/src/adapters/arbeitnow.ts`:

```typescript
import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
import type { NormalizedJob } from "../types.js";

export interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  location: string;
  created_at: number; // seconds
  tags?: string[];
}

export function normalizeArbeitnow(raw: ArbeitnowJob): NormalizedJob {
  return {
    key: buildJobKey({
      company: raw.company_name,
      title: raw.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "arbeitnow",
    company: raw.company_name,
    title: raw.title,
    locationRaw: raw.location,
    remote: raw.remote,
    descriptionText: htmlToText(raw.description),
    applyUrl: raw.url,
    atsKind: null,
    atsRef: null,
    postedAt: new Date(raw.created_at * 1000),
    dateFidelity: "true",
  };
}

export async function fetchArbeitnow(): Promise<ArbeitnowJob[]> {
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
  if (!res.ok) throw new Error(`arbeitnow: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: ArbeitnowJob[] };
  return body.data ?? [];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/aggregators.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapters
git commit -m "feat: remoteok and arbeitnow adapters"
```

---

### Task 7: Ashby adapter with no date fidelity

Ashby's public board query exposes no date field — `publishedAt`, `createdAt`, `updatedAt`, `publishedDate`, and `listedDate` are all rejected by the schema, and introspection is disabled. This adapter must be honest about that rather than inventing a date.

**Files:**
- Create: `packages/core/src/adapters/ashby.ts`
- Test: `packages/core/src/adapters/ashby.test.ts`

**Interfaces:**
- Consumes: `buildJobKey`, `NormalizedJob`.
- Produces: `normalizeAshby(raw: AshbyPosting, org: string): NormalizedJob`, `fetchAshbyBoard(org: string): Promise<AshbyPosting[]>`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/adapters/ashby.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeAshby, type AshbyPosting } from "./ashby.js";

const raw: AshbyPosting = {
  id: "abc-123",
  title: "Senior Full Stack Engineer",
  locationName: "Remote - US",
  employmentType: "FullTime",
};

describe("ashby adapter", () => {
  it("reports no date fidelity", () => {
    const job = normalizeAshby(raw, "ramp");
    expect(job.dateFidelity).toBe("none");
  });

  it("leaves postedAt null rather than guessing", () => {
    expect(normalizeAshby(raw, "ramp").postedAt).toBeNull();
  });

  it("builds an exact ATS key", () => {
    expect(normalizeAshby(raw, "ramp").key.atsKey).toBe("ashby:ramp/abc-123");
  });

  it("builds the hosted apply url from org and posting id", () => {
    expect(normalizeAshby(raw, "ramp").applyUrl).toBe(
      "https://jobs.ashbyhq.com/ramp/abc-123",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/ashby.test.ts`
Expected: FAIL — cannot resolve `./ashby.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/adapters/ashby.ts`:

```typescript
import { buildJobKey } from "../job-key.js";
import type { NormalizedJob } from "../types.js";

export interface AshbyPosting {
  id: string;
  title: string;
  locationName?: string;
  employmentType?: string;
}

const QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings { id title locationName employmentType }
  }
}`;

export function normalizeAshby(raw: AshbyPosting, org: string): NormalizedJob {
  const location = raw.locationName ?? "";
  return {
    key: buildJobKey({
      company: org,
      title: raw.title,
      atsKind: "ashby",
      atsRef: `${org}/${raw.id}`,
    }),
    sourceKind: "ashby",
    company: org,
    title: raw.title,
    locationRaw: location,
    remote: /remote/i.test(location) || /remote/i.test(raw.title),
    descriptionText: "",
    applyUrl: `https://jobs.ashbyhq.com/${org}/${raw.id}`,
    atsKind: "ashby",
    atsRef: `${org}/${raw.id}`,
    // Ashby's public board exposes no date field. Do not substitute "now".
    postedAt: null,
    dateFidelity: "none",
  };
}

export async function fetchAshbyBoard(org: string): Promise<AshbyPosting[]> {
  const res = await fetch(
    "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "ApiJobBoardWithTeams",
        variables: { organizationHostedJobsPageName: org },
        query: QUERY,
      }),
    },
  );
  if (!res.ok) throw new Error(`ashby ${org}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { jobBoard?: { jobPostings?: AshbyPosting[] } };
    errors?: unknown[];
  };
  if (body.errors) throw new Error(`ashby ${org}: ${JSON.stringify(body.errors)}`);
  return body.data?.jobBoard?.jobPostings ?? [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/ashby.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters
git commit -m "feat: ashby adapter with explicit no-date fidelity"
```

---

### Task 8: Hacker News "Who is Hiring" adapter

HN comments are freeform prose, so this is the one adapter that needs a model to structure its input.

**Files:**
- Create: `packages/core/src/models.ts`
- Create: `packages/core/src/adapters/hn.ts`
- Test: `packages/core/src/adapters/hn.test.ts`

**Interfaces:**
- Consumes: `buildJobKey`, `NormalizedJob`.
- Produces: `RANK_MODEL`, `UTILITY_MODEL` from `models.ts`; `findLatestHiringThread(): Promise<number>`, `fetchThreadComments(storyId: number): Promise<HnComment[]>`, `parseHnComment(comment: HnComment, client: Anthropic): Promise<NormalizedJob | null>`.

- [ ] **Step 1: Write `models.ts`**

Create `packages/core/src/models.ts`:

```typescript
/**
 * Every model ID in the codebase lives here. Exact strings, no date suffixes.
 *
 * Ranking ~120 jobs costs roughly $0.90 per fetch on claude-opus-5, $0.36 on
 * claude-sonnet-5, $0.18 on claude-haiku-4-5. Change RANK_MODEL to trade
 * ranking quality for cost.
 */
export const RANK_MODEL = "claude-opus-5";

/** Mechanical extraction and mapping — no judgment required. */
export const UTILITY_MODEL = "claude-haiku-4-5";
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/adapters/hn.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseHnComment, type HnComment } from "./hn.js";

const comment: HnComment = {
  objectID: "43210",
  comment_text:
    "Acme Robotics | Senior Full Stack Engineer | REMOTE (worldwide) | " +
    "TypeScript, React, Node, Postgres | apply at https://acme.example/jobs/42",
  created_at_i: 1787850715,
};

function fakeClient(parsed: unknown) {
  return {
    messages: { parse: vi.fn().mockResolvedValue({ parsed_output: parsed }) },
  } as never;
}

describe("hn adapter", () => {
  it("builds a normalized job from a parsed comment", async () => {
    const job = await parseHnComment(
      comment,
      fakeClient({
        isJobPosting: true,
        company: "Acme Robotics",
        title: "Senior Full Stack Engineer",
        location: "Remote (worldwide)",
        remote: true,
        applyUrl: "https://acme.example/jobs/42",
      }),
    );
    expect(job).not.toBeNull();
    expect(job!.company).toBe("Acme Robotics");
    expect(job!.sourceKind).toBe("hn");
    expect(job!.dateFidelity).toBe("true");
  });

  it("takes postedAt from the comment timestamp, not the model", async () => {
    const job = await parseHnComment(comment, fakeClient({
      isJobPosting: true,
      company: "Acme Robotics",
      title: "Senior Full Stack Engineer",
      location: "Remote",
      remote: true,
      applyUrl: "https://acme.example/jobs/42",
    }));
    expect(job!.postedAt?.getTime()).toBe(comment.created_at_i * 1000);
  });

  it("drops comments the model says are not job postings", async () => {
    const job = await parseHnComment(
      comment,
      fakeClient({
        isJobPosting: false,
        company: "",
        title: "",
        location: "",
        remote: false,
        applyUrl: "",
      }),
    );
    expect(job).toBeNull();
  });

  it("drops comments when parsing returns null", async () => {
    expect(await parseHnComment(comment, fakeClient(null))).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/hn.test.ts`
Expected: FAIL — cannot resolve `./hn.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/adapters/hn.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildJobKey } from "../job-key.js";
import { UTILITY_MODEL } from "../models.js";
import type { NormalizedJob } from "../types.js";

export interface HnComment {
  objectID: string;
  comment_text: string;
  created_at_i: number; // epoch seconds
}

const HnJobSchema = z.object({
  isJobPosting: z.boolean(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  remote: z.boolean(),
  applyUrl: z.string(),
});

/** Finds the newest "Ask HN: Who is hiring?" story id. */
export async function findLatestHiringThread(): Promise<number> {
  const res = await fetch(
    "https://hn.algolia.com/api/v1/search?tags=story,author_whoishiring&query=Who%20is%20hiring&hitsPerPage=5",
  );
  if (!res.ok) throw new Error(`hn search: HTTP ${res.status}`);
  const body = (await res.json()) as {
    hits: { objectID: string; title: string; created_at_i: number }[];
  };
  const hiring = body.hits
    .filter((h) => /who is hiring/i.test(h.title))
    .sort((a, b) => b.created_at_i - a.created_at_i)[0];
  if (!hiring) throw new Error("hn: no who-is-hiring thread found");
  return Number(hiring.objectID);
}

export async function fetchThreadComments(storyId: number): Promise<HnComment[]> {
  const res = await fetch(
    `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=1000`,
  );
  if (!res.ok) throw new Error(`hn comments: HTTP ${res.status}`);
  const body = (await res.json()) as { hits: HnComment[] };
  return body.hits.filter((h) => h.comment_text);
}

export async function parseHnComment(
  comment: HnComment,
  client: Anthropic,
): Promise<NormalizedJob | null> {
  const response = await client.messages.parse({
    model: UTILITY_MODEL,
    max_tokens: 1024,
    output_config: { format: zodOutputFormat(HnJobSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content:
          "Extract the job posting from this Hacker News comment. " +
          "Set isJobPosting false if it is not a job posting (meta commentary, a " +
          "job seeker, a question). Use an empty string for anything absent.\n\n" +
          comment.comment_text,
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed || !parsed.isJobPosting || !parsed.company || !parsed.title) {
    return null;
  }

  return {
    key: buildJobKey({
      company: parsed.company,
      title: parsed.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "hn",
    company: parsed.company,
    title: parsed.title,
    locationRaw: parsed.location,
    remote: parsed.remote,
    descriptionText: comment.comment_text,
    applyUrl: parsed.applyUrl,
    atsKind: null,
    atsRef: null,
    // The comment's own timestamp — never the model's guess.
    postedAt: new Date(comment.created_at_i * 1000),
    dateFidelity: "true",
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/hn.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/models.ts packages/core/src/adapters
git commit -m "feat: hn who-is-hiring adapter with model-parsed comments"
```

---

### Task 9: Adapter registry and capped fan-out

**Files:**
- Create: `sources/boards.yaml`
- Create: `packages/core/src/adapters/index.ts`
- Test: `packages/core/src/adapters/index.test.ts`

**Interfaces:**
- Consumes: every adapter from Tasks 4–8.
- Produces: `loadBoards(yamlText: string): BoardsConfig`, `dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[]`, `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]>`.

- [ ] **Step 1: Write the seed board list**

Create `sources/boards.yaml`. Start with the tokens verified to return HTTP 200; the discovery loop grows this file later.

```yaml
greenhouse:
  - discord
  - gitlab
  - anthropic
  - coinbase
  - consensys
  - stripe
  - figma
lever:
  - spotify
  - palantir
  - matchgroup
ashby:
  - ramp
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/adapters/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadBoards, dedupeJobs, mapWithConcurrency } from "./index.js";
import type { NormalizedJob } from "../types.js";

function job(over: Partial<NormalizedJob>): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: "acme|engineer" },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Engineer",
    locationRaw: "Remote",
    remote: true,
    descriptionText: "",
    applyUrl: "https://aggregator.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-20T00:00:00Z"),
    dateFidelity: "true",
    ...over,
  };
}

describe("loadBoards", () => {
  it("parses provider tokens from yaml", () => {
    const cfg = loadBoards("greenhouse:\n  - discord\nlever:\n  - spotify\n");
    expect(cfg.greenhouse).toEqual(["discord"]);
    expect(cfg.lever).toEqual(["spotify"]);
    expect(cfg.ashby).toEqual([]);
  });
});

describe("dedupeJobs", () => {
  it("collapses the same role seen from two sources", () => {
    const result = dedupeJobs([
      job({ sourceKind: "remoteok" }),
      job({ sourceKind: "arbeitnow" }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("prefers the ATS-direct posting as canonical", () => {
    const result = dedupeJobs([
      job({ sourceKind: "remoteok", applyUrl: "https://aggregator.example/1" }),
      job({
        sourceKind: "greenhouse",
        atsKind: "greenhouse",
        atsRef: "acme/1",
        key: { atsKey: "greenhouse:acme/1", slugKey: "acme|engineer" },
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.applyUrl).toBe("https://job-boards.greenhouse.io/acme/jobs/1");
  });

  it("keeps genuinely different roles", () => {
    const result = dedupeJobs([
      job({ key: { atsKey: null, slugKey: "acme|frontend engineer" } }),
      job({ key: { atsKey: null, slugKey: "acme|backend engineer" } }),
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return true;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("returns rejections instead of throwing", async () => {
    const results = await mapWithConcurrency([1, 2], 2, async (n) => {
      if (n === 1) throw new Error("boom");
      return n;
    });
    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/index.test.ts`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/adapters/index.ts`:

```typescript
import { parse as parseYaml } from "yaml";
import type { NormalizedJob } from "../types.js";

export interface BoardsConfig {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
}

export function loadBoards(yamlText: string): BoardsConfig {
  const raw = (parseYaml(yamlText) ?? {}) as Partial<BoardsConfig>;
  return {
    greenhouse: raw.greenhouse ?? [],
    lever: raw.lever ?? [],
    ashby: raw.ashby ?? [],
  };
}

/** ATS-direct postings win over aggregator reposts of the same role. */
function isAtsDirect(job: NormalizedJob): boolean {
  return job.atsKind !== null;
}

export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const bySlug = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const existing = bySlug.get(job.key.slugKey);
    if (!existing) {
      bySlug.set(job.key.slugKey, job);
      continue;
    }
    // Prefer ATS-direct; among equals, prefer the one carrying a description.
    const replace =
      (isAtsDirect(job) && !isAtsDirect(existing)) ||
      (isAtsDirect(job) === isAtsDirect(existing) &&
        job.descriptionText.length > existing.descriptionText.length);
    if (replace) bySlug.set(job.key.slugKey, job);
  }
  return [...bySlug.values()];
}

/**
 * Runs fn over items with at most `limit` in flight. Never throws — every
 * outcome comes back as a settled result so one dead board cannot abort a fetch.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/index.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 6: Commit**

```bash
git add sources/boards.yaml packages/core/src/adapters/index.ts packages/core/src/adapters/index.test.ts
git commit -m "feat: adapter registry, dedup and capped fan-out"
```

---

### Task 10: Resume parsing into a profile

**Files:**
- Create: `packages/core/src/resume.ts`
- Test: `packages/core/src/resume.test.ts`

**Interfaces:**
- Consumes: `UTILITY_MODEL`.
- Produces: `ParsedProfile` and `Posture` types; `parseResume(resumeText: string, client: Anthropic): Promise<ParsedProfile>`; `DEFAULT_POSTURE_INDIA: Posture`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/resume.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parseResume, DEFAULT_POSTURE_INDIA } from "./resume.js";

function fakeClient(parsed: unknown) {
  return {
    messages: { parse: vi.fn().mockResolvedValue({ parsed_output: parsed }) },
  } as never;
}

const senior = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React", "Next.js", "Node.js"],
  bonusStack: ["Solidity", "EVM"],
};

describe("parseResume", () => {
  it("returns the model's structured extraction", async () => {
    const profile = await parseResume("…resume text…", fakeClient(senior));
    expect(profile.seniorityBands).toEqual(["mid", "senior"]);
    expect(profile.coreStack).toContain("Next.js");
  });

  it("derives accepted title keywords from the seniority bands", async () => {
    const profile = await parseResume("…", fakeClient(senior));
    expect(profile.titlesReject).toContain("new grad");
    expect(profile.titlesReject).toContain("principal");
    expect(profile.titlesAccept).toContain("senior");
  });

  it("derives the opposite keywords for an entry-level profile", async () => {
    const profile = await parseResume(
      "…",
      fakeClient({
        fullName: "Shambhavi Soumya",
        yearsExperience: 1,
        graduationYear: 2026,
        seniorityBands: ["entry", "junior"],
        coreStack: ["React", "Node.js", "MongoDB"],
        bonusStack: [],
      }),
    );
    expect(profile.titlesAccept).toContain("new grad");
    expect(profile.titlesAccept).toContain("junior");
    expect(profile.titlesReject).toContain("senior");
    expect(profile.titlesReject).not.toContain("new grad");
  });

  it("throws rather than returning a half-built profile", async () => {
    await expect(parseResume("…", fakeClient(null))).rejects.toThrow(
      /could not be parsed/i,
    );
  });
});

describe("DEFAULT_POSTURE_INDIA", () => {
  it("is india plus remote and needs no sponsorship", () => {
    expect(DEFAULT_POSTURE_INDIA).toEqual({
      regions: ["india", "remote"],
      remoteGlobal: false,
      needsSponsorship: false,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/resume.test.ts`
Expected: FAIL — cannot resolve `./resume.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/resume.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { UTILITY_MODEL } from "./models.js";

export type SeniorityBand =
  | "entry"
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "lead"
  | "manager";

export interface Posture {
  regions: string[];
  remoteGlobal: boolean;
  needsSponsorship: boolean;
}

export interface ParsedProfile {
  fullName: string;
  yearsExperience: number;
  graduationYear: number | null;
  seniorityBands: SeniorityBand[];
  coreStack: string[];
  bonusStack: string[];
  titlesAccept: string[];
  titlesReject: string[];
}

export const DEFAULT_POSTURE_INDIA: Posture = {
  regions: ["india", "remote"],
  remoteGlobal: false,
  needsSponsorship: false,
};

export const DEFAULT_POSTURE_REMOTE_GLOBAL: Posture = {
  regions: ["remote"],
  remoteGlobal: true,
  needsSponsorship: false,
};

const ExtractionSchema = z.object({
  fullName: z.string(),
  yearsExperience: z.number(),
  graduationYear: z.number().nullable(),
  seniorityBands: z.array(
    z.enum(["entry", "junior", "mid", "senior", "staff", "principal", "lead", "manager"]),
  ),
  coreStack: z.array(z.string()),
  bonusStack: z.array(z.string()),
});

/** Title keywords associated with each band, used to derive accept/reject lists. */
const BAND_KEYWORDS: Record<SeniorityBand, string[]> = {
  entry: ["entry level", "new grad", "graduate", "trainee", "associate"],
  junior: ["junior", "jr", "sde 1", "software engineer i"],
  mid: ["mid level", "sde 2", "software engineer ii", "engineer ii"],
  senior: ["senior", "sr", "sde 3", "software engineer iii"],
  staff: ["staff"],
  principal: ["principal"],
  lead: ["lead", "tech lead"],
  manager: ["manager", "engineering manager", "director", "vp", "head of"],
};

/** Always rejected regardless of band — these are not the roles being sought. */
const ALWAYS_REJECT = ["intern", "internship"];

/**
 * Turns the model's band list into accept/reject title keywords.
 * A profile accepts its own bands and rejects every other band's keywords.
 * This is why nothing is hardcoded: a 2026 graduate accepts "new grad" while a
 * five-year engineer rejects it, from the same code path.
 */
export function deriveTitleKeywords(bands: SeniorityBand[]): {
  titlesAccept: string[];
  titlesReject: string[];
} {
  const accepted = new Set(bands);
  const titlesAccept = bands.flatMap((b) => BAND_KEYWORDS[b]);
  const titlesReject = (Object.keys(BAND_KEYWORDS) as SeniorityBand[])
    .filter((b) => !accepted.has(b))
    .flatMap((b) => BAND_KEYWORDS[b])
    .concat(ALWAYS_REJECT);
  return { titlesAccept, titlesReject };
}

export async function parseResume(
  resumeText: string,
  client: Anthropic,
): Promise<ParsedProfile> {
  const response = await client.messages.parse({
    model: UTILITY_MODEL,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(ExtractionSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content:
          "Extract a structured profile from this resume. seniorityBands should " +
          "be the bands this person should be applying to right now — a 2026 " +
          "graduate with under a year of experience is ['entry','junior'], a " +
          "five-year engineer is ['mid','senior']. coreStack is the languages and " +
          "frameworks they would be hired for; bonusStack is specialist " +
          "differentiators that should score well but never be required.\n\n" +
          resumeText,
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Resume could not be parsed into a profile");

  return { ...parsed, ...deriveTitleKeywords(parsed.seniorityBands) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/resume.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/resume.ts packages/core/src/resume.test.ts
git commit -m "feat: resume parsing with derived seniority keywords"
```

---

### Task 11: Profile-derived filter

The guard against ever re-hardcoding a person into the filter: the same fixture set runs through both profiles and must produce opposite seniority outcomes.

**Files:**
- Create: `packages/core/src/filter.ts`
- Test: `packages/core/src/filter.test.ts`

**Interfaces:**
- Consumes: `NormalizedJob`, `ParsedProfile`, `Posture`, `ledgerMatchKeys`.
- Produces: `filterJobs(jobs, profile, posture, opts): FilterResult` where `opts` is `{ now: Date; timeFrameDays: number | null; ledgerKeys: Set<string> }` and `FilterResult` is `{ passed: NormalizedJob[]; rejected: { job: NormalizedJob; reason: string }[] }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { filterJobs } from "./filter.js";
import { deriveTitleKeywords, DEFAULT_POSTURE_REMOTE_GLOBAL } from "./resume.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const NOW = new Date("2026-08-29T00:00:00Z");

const seniorProfile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL"],
  bonusStack: ["Solidity"],
  ...deriveTitleKeywords(["mid", "senior"]),
};

const gradProfile: ParsedProfile = {
  fullName: "Shambhavi Soumya",
  yearsExperience: 1,
  graduationYear: 2026,
  seniorityBands: ["entry", "junior"],
  coreStack: ["React", "Node.js", "MongoDB", "Express"],
  bonusStack: [],
  ...deriveTitleKeywords(["entry", "junior"]),
};

function job(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: "acme|engineer" },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Senior Software Engineer",
    locationRaw: "Remote",
    remote: true,
    descriptionText: "We use TypeScript, React and Node.js to build things.",
    applyUrl: "https://acme.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-28T00:00:00Z"),
    dateFidelity: "true",
    ...over,
  };
}

const base = {
  now: NOW,
  timeFrameDays: 7,
  ledgerKeys: new Set<string>(),
};

describe("seniority is derived, not hardcoded", () => {
  const gradRole = job({
    title: "New Grad Software Engineer",
    key: { atsKey: null, slugKey: "acme|new grad software engineer" },
    descriptionText: "React, Node.js and MongoDB. Graduating 2026 welcome.",
  });

  it("passes a new-grad role for the graduate profile", () => {
    const result = filterJobs([gradRole], gradProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(1);
  });

  it("rejects the same role for the senior profile", () => {
    const result = filterJobs([gradRole], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/seniority/);
  });

  it("passes a senior role for the senior profile and rejects it for the graduate", () => {
    const seniorRole = job();
    expect(
      filterJobs([seniorRole], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base).passed,
    ).toHaveLength(1);
    expect(
      filterJobs([seniorRole], gradProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base).passed,
    ).toHaveLength(0);
  });
});

describe("time frame", () => {
  it("rejects postings older than the window", () => {
    const old = job({ postedAt: new Date("2026-07-01T00:00:00Z") });
    const result = filterJobs([old], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/time frame/);
  });

  it("rejects postings with no date when a time frame is set", () => {
    const undated = job({ postedAt: null, dateFidelity: "none" });
    const result = filterJobs([undated], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.passed).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/no post date/);
  });

  it("keeps undated postings when the time frame is null (any)", () => {
    const undated = job({ postedAt: null, dateFidelity: "none" });
    const result = filterJobs([undated], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, {
      ...base,
      timeFrameDays: null,
    });
    expect(result.passed).toHaveLength(1);
  });
});

describe("geography and stack", () => {
  it("rejects a posting gated to US work authorization", () => {
    const gated = job({
      descriptionText: "TypeScript and React. Must be authorized to work in the US.",
    });
    const result = filterJobs([gated], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/geography/);
  });

  it("rejects a posting with fewer than two core stack matches", () => {
    const offStack = job({
      descriptionText: "We are a Salesforce and Apex shop looking for an engineer.",
    });
    const result = filterJobs([offStack], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, base);
    expect(result.rejected[0]!.reason).toMatch(/stack/);
  });
});

describe("ledger", () => {
  it("rejects a job whose slug key is already in the ledger", () => {
    const result = filterJobs([job()], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, {
      ...base,
      ledgerKeys: new Set(["acme|engineer"]),
    });
    expect(result.rejected[0]!.reason).toMatch(/already/);
  });

  it("rejects a job matched by its ATS key even when the slug differs", () => {
    const withAts = job({
      key: { atsKey: "greenhouse:acme/1", slugKey: "acme|senior software engineer" },
    });
    const result = filterJobs([withAts], seniorProfile, DEFAULT_POSTURE_REMOTE_GLOBAL, {
      ...base,
      ledgerKeys: new Set(["greenhouse:acme/1"]),
    });
    expect(result.passed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/filter.test.ts`
Expected: FAIL — cannot resolve `./filter.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/filter.ts`:

```typescript
import { ledgerMatchKeys } from "./job-key.js";
import type { ParsedProfile, Posture } from "./resume.js";
import type { NormalizedJob } from "./types.js";

export interface FilterOptions {
  now: Date;
  /** null means "any" — no time-frame constraint, undated sources allowed. */
  timeFrameDays: number | null;
  /** Every ledger key for this profile, applied and dismissed alike. */
  ledgerKeys: Set<string>;
}

export interface FilterResult {
  passed: NormalizedJob[];
  rejected: { job: NormalizedJob; reason: string }[];
}

/** Phrases that gate a posting to local work authorization. */
const AUTHORIZATION_GATES = [
  /must be (legally )?authoriz(ed|ation) to work in/i,
  /must reside in/i,
  /us citizens? only/i,
  /u\.s\. citizens? only/i,
  /requires? (a )?security clearance/i,
  /no (visa )?sponsorship/i,
  /work authorization required/i,
];

/** Timezone demands incompatible with IST. */
const TIMEZONE_GATES = [
  /\bpst\b.{0,20}(core|overlap|hours)/i,
  /(core|overlap|hours).{0,20}\bpst\b/i,
  /must overlap .{0,20}(pacific|eastern) (time|hours)/i,
];

function haystack(job: NormalizedJob): string {
  return `${job.title} ${job.locationRaw} ${job.descriptionText}`;
}

function countStackMatches(job: NormalizedJob, stack: string[]): number {
  const text = haystack(job).toLowerCase();
  return stack.filter((tech) => text.includes(tech.toLowerCase())).length;
}

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

export function filterJobs(
  jobs: NormalizedJob[],
  profile: ParsedProfile,
  posture: Posture,
  opts: FilterOptions,
): FilterResult {
  const passed: NormalizedJob[] = [];
  const rejected: { job: NormalizedJob; reason: string }[] = [];

  for (const job of jobs) {
    const reject = (reason: string) => rejected.push({ job, reason });

    // Ledger first — it is the cheapest check and the user's explicit choice.
    if (ledgerMatchKeys(job.key).some((k) => opts.ledgerKeys.has(k))) {
      reject("already applied or dismissed");
      continue;
    }

    if (opts.timeFrameDays !== null) {
      if (!job.postedAt) {
        reject(`no post date (${job.sourceKind} exposes none)`);
        continue;
      }
      const ageDays =
        (opts.now.getTime() - job.postedAt.getTime()) / 86_400_000;
      if (ageDays > opts.timeFrameDays) {
        reject(`outside time frame (${Math.round(ageDays)}d old)`);
        continue;
      }
    }

    // Seniority — derived from the profile's own bands, never a fixed list.
    if (matchesAny(job.title, profile.titlesReject)) {
      reject("seniority band mismatch");
      continue;
    }

    const text = haystack(job);
    if (!posture.needsSponsorship && AUTHORIZATION_GATES.some((r) => r.test(text))) {
      reject("geography or work-authorization gate");
      continue;
    }

    if (TIMEZONE_GATES.some((r) => r.test(text))) {
      reject("incompatible timezone requirement");
      continue;
    }

    if (posture.remoteGlobal && !job.remote) {
      reject("geography: not remote");
      continue;
    }

    if (countStackMatches(job, profile.coreStack) < 2) {
      reject("fewer than 2 core stack matches");
      continue;
    }

    passed.push(job);
  }

  return { passed, rejected };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/filter.test.ts`
Expected: PASS — 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/filter.ts packages/core/src/filter.test.ts
git commit -m "feat: profile-derived filter with opposite-seniority guard"
```

---

### Task 12: Claude ranking

**Files:**
- Create: `packages/core/src/rank.ts`
- Test: `packages/core/src/rank.test.ts`

**Interfaces:**
- Consumes: `RANK_MODEL`, `NormalizedJob`, `ParsedProfile`.
- Produces: `RankedJob` type; `rankJobs(jobs: NormalizedJob[], profile: ParsedProfile, client: Anthropic, batchSize?: number): Promise<Map<string, RankedJob>>` keyed by `slugKey`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/rank.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { rankJobs } from "./rank.js";
import { deriveTitleKeywords } from "./resume.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: ["Solidity"],
  ...deriveTitleKeywords(["mid", "senior"]),
};

function job(slug: string): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: slug },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Senior Engineer",
    locationRaw: "Remote",
    remote: true,
    descriptionText: "TypeScript and React",
    applyUrl: "https://acme.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-28T00:00:00Z"),
    dateFidelity: "true",
  };
}

function ranked(slug: string, score: number) {
  return {
    jobKey: slug,
    score,
    tier: "strong" as const,
    why: "Stack matches",
    redFlags: [],
    sponsorshipGate: false,
    timezoneGate: null,
    resumeHooks: ["EuclidSwap"],
  };
}

describe("rankJobs", () => {
  it("returns a map keyed by slug key", async () => {
    const client = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          parsed_output: { rankings: [ranked("acme|a", 90)] },
        }),
      },
    } as never;

    const result = await rankJobs([job("acme|a")], profile, client);
    expect(result.get("acme|a")?.score).toBe(90);
  });

  it("batches so a large set makes multiple calls", async () => {
    const parse = vi
      .fn()
      .mockResolvedValueOnce({ parsed_output: { rankings: [ranked("acme|a", 90)] } })
      .mockResolvedValueOnce({ parsed_output: { rankings: [ranked("acme|b", 80)] } });
    const client = { messages: { parse } } as never;

    await rankJobs([job("acme|a"), job("acme|b")], profile, client, 1);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("keeps jobs from surviving batches when one batch fails", async () => {
    const parse = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ parsed_output: { rankings: [ranked("acme|b", 80)] } });
    const client = { messages: { parse } } as never;

    const result = await rankJobs([job("acme|a"), job("acme|b")], profile, client, 1);
    expect(result.has("acme|a")).toBe(false);
    expect(result.get("acme|b")?.score).toBe(80);
  });

  it("makes no call for an empty job list", async () => {
    const parse = vi.fn();
    const result = await rankJobs([], profile, { messages: { parse } } as never);
    expect(parse).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/rank.test.ts`
Expected: FAIL — cannot resolve `./rank.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/rank.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RANK_MODEL } from "./models.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const RankedJobSchema = z.object({
  jobKey: z.string(),
  score: z.number(),
  tier: z.enum(["strong", "stretch", "skip"]),
  why: z.string(),
  redFlags: z.array(z.string()),
  sponsorshipGate: z.boolean(),
  timezoneGate: z.string().nullable(),
  resumeHooks: z.array(z.string()),
});

const BatchSchema = z.object({ rankings: z.array(RankedJobSchema) });

export type RankedJob = z.infer<typeof RankedJobSchema>;

function profileBrief(profile: ParsedProfile): string {
  return [
    `Name: ${profile.fullName}`,
    `Years of experience: ${profile.yearsExperience}`,
    `Target seniority: ${profile.seniorityBands.join(", ")}`,
    `Core stack: ${profile.coreStack.join(", ")}`,
    `Bonus differentiators: ${profile.bonusStack.join(", ") || "none"}`,
  ].join("\n");
}

function jobBrief(job: NormalizedJob): string {
  return [
    `jobKey: ${job.key.slugKey}`,
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.locationRaw}${job.remote ? " (remote)" : ""}`,
    `Description: ${job.descriptionText.slice(0, 2000)}`,
  ].join("\n");
}

/**
 * Scores jobs against a profile. Batches are independent: a failed batch loses
 * only its own jobs, and those simply render unranked rather than disappearing.
 * Returns a map keyed by slugKey.
 */
export async function rankJobs(
  jobs: NormalizedJob[],
  profile: ParsedProfile,
  client: Anthropic,
  batchSize = 20,
): Promise<Map<string, RankedJob>> {
  const out = new Map<string, RankedJob>();
  if (jobs.length === 0) return out;

  const batches: NormalizedJob[][] = [];
  for (let i = 0; i < jobs.length; i += batchSize) {
    batches.push(jobs.slice(i, i + batchSize));
  }

  const settled = await Promise.allSettled(
    batches.map(async (batch) => {
      const response = await client.messages.parse({
        model: RANK_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { format: zodOutputFormat(BatchSchema), effort: "high" },
        system:
          "You rank job postings against one candidate's profile. Score 0-100 on " +
          "fit. Set sponsorshipGate true when the posting implies work " +
          "authorization the candidate does not have — the language for this is " +
          "varied, so read for intent, not keywords. Bonus differentiators should " +
          "raise a score but never be treated as a requirement. Return one entry " +
          "per job, echoing its jobKey exactly.",
        messages: [
          {
            role: "user",
            content: `CANDIDATE\n${profileBrief(profile)}\n\nJOBS\n${batch
              .map(jobBrief)
              .join("\n\n---\n\n")}`,
          },
        ],
      });
      return response.parsed_output?.rankings ?? [];
    }),
  );

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const ranking of result.value) out.set(ranking.jobKey, ranking);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/rank.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rank.ts packages/core/src/rank.test.ts
git commit -m "feat: batched claude ranking with per-batch failure isolation"
```

---

### Task 13: Pipeline orchestration

**Files:**
- Create: `packages/core/src/pipeline.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/pipeline.test.ts`

**Interfaces:**
- Consumes: every adapter, `dedupeJobs`, `mapWithConcurrency`, `filterJobs`, `rankJobs`.
- Produces: `ProgressEvent` union; `runFetch(opts: FetchOptions): AsyncGenerator<ProgressEvent>` where `FetchOptions` is `{ profile, posture, boards, ledgerKeys, timeFrameDays, client, now?, concurrency? }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runFetch, type ProgressEvent } from "./pipeline.js";
import { deriveTitleKeywords, DEFAULT_POSTURE_REMOTE_GLOBAL } from "./resume.js";
import type { ParsedProfile } from "./resume.js";
import type { NormalizedJob } from "./types.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: [],
  ...deriveTitleKeywords(["mid", "senior"]),
};

function job(slug: string): NormalizedJob {
  return {
    key: { atsKey: null, slugKey: slug },
    sourceKind: "remoteok",
    company: "Acme",
    title: "Senior Engineer",
    locationRaw: "Remote",
    remote: true,
    descriptionText: "TypeScript and React",
    applyUrl: "https://acme.example/1",
    atsKind: null,
    atsRef: null,
    postedAt: new Date("2026-08-28T00:00:00Z"),
    dateFidelity: "true",
  };
}

const client = {
  messages: {
    parse: vi.fn().mockResolvedValue({
      parsed_output: {
        rankings: [
          {
            jobKey: "acme|senior engineer",
            score: 88,
            tier: "strong",
            why: "Stack matches",
            redFlags: [],
            sponsorshipGate: false,
            timezoneGate: null,
            resumeHooks: [],
          },
        ],
      },
    }),
  },
} as never;

async function collect(gen: AsyncGenerator<ProgressEvent>): Promise<ProgressEvent[]> {
  const events: ProgressEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const base = {
  profile,
  posture: DEFAULT_POSTURE_REMOTE_GLOBAL,
  ledgerKeys: new Set<string>(),
  timeFrameDays: 7,
  client,
  now: new Date("2026-08-29T00:00:00Z"),
};

describe("runFetch", () => {
  it("emits progress events in order and ends with done", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          { kind: "remoteok", run: async () => [job("acme|senior engineer")] },
        ],
      }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "fetching",
      "fetched",
      "filtered",
      "ranking",
      "done",
    ]);
  });

  it("attaches rankings to the jobs in the done event", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          { kind: "remoteok", run: async () => [job("acme|senior engineer")] },
        ],
      }),
    );
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type !== "done") throw new Error("unreachable");
    expect(done.results[0]!.rank?.score).toBe(88);
  });

  it("reports a failed source but still completes", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          { kind: "remoteok", run: async () => [job("acme|senior engineer")] },
          {
            kind: "arbeitnow",
            run: async () => {
              throw new Error("HTTP 503");
            },
          },
        ],
      }),
    );
    const fetched = events.find((e) => e.type === "fetched")!;
    if (fetched.type !== "fetched") throw new Error("unreachable");
    expect(fetched.failed).toEqual(["arbeitnow"]);
    expect(events.at(-1)!.type).toBe("done");
  });

  it("emits error rather than done when every source fails", async () => {
    const events = await collect(
      runFetch({
        ...base,
        sources: [
          {
            kind: "remoteok",
            run: async () => {
              throw new Error("HTTP 503");
            },
          },
        ],
      }),
    );
    expect(events.at(-1)!.type).toBe("error");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/pipeline.test.ts`
Expected: FAIL — cannot resolve `./pipeline.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/pipeline.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { dedupeJobs, mapWithConcurrency } from "./adapters/index.js";
import { filterJobs } from "./filter.js";
import { rankJobs, type RankedJob } from "./rank.js";
import type { ParsedProfile, Posture } from "./resume.js";
import type { NormalizedJob, SourceKind } from "./types.js";

export interface SourceTask {
  kind: SourceKind;
  run: () => Promise<NormalizedJob[]>;
}

export interface RankedResult extends NormalizedJob {
  rank: RankedJob | null;
}

export type ProgressEvent =
  | { type: "fetching"; sources: number }
  | { type: "fetched"; total: number; deduped: number; failed: SourceKind[] }
  | { type: "filtered"; kept: number; rejected: number }
  | { type: "ranking"; jobs: number }
  | { type: "done"; results: RankedResult[]; failed: SourceKind[] }
  | { type: "error"; message: string };

export interface FetchOptions {
  profile: ParsedProfile;
  posture: Posture;
  sources: SourceTask[];
  ledgerKeys: Set<string>;
  /** null means "any" — no window, undated sources allowed. */
  timeFrameDays: number | null;
  client: Anthropic;
  now?: Date;
  concurrency?: number;
}

/**
 * Fans out to every source, dedupes, filters against the profile, ranks the
 * survivors, and yields progress as it goes. Writes nothing.
 */
export async function* runFetch(
  opts: FetchOptions,
): AsyncGenerator<ProgressEvent> {
  const now = opts.now ?? new Date();
  const concurrency = opts.concurrency ?? 20;

  yield { type: "fetching", sources: opts.sources.length };

  const settled = await mapWithConcurrency(opts.sources, concurrency, (s) => s.run());

  const collected: NormalizedJob[] = [];
  const failed: SourceKind[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") collected.push(...result.value);
    else failed.push(opts.sources[i]!.kind);
  });

  if (failed.length === opts.sources.length) {
    yield {
      type: "error",
      message: `every source failed (${failed.join(", ")})`,
    };
    return;
  }

  const deduped = dedupeJobs(collected);
  yield {
    type: "fetched",
    total: collected.length,
    deduped: deduped.length,
    failed,
  };

  const { passed, rejected } = filterJobs(deduped, opts.profile, opts.posture, {
    now,
    timeFrameDays: opts.timeFrameDays,
    ledgerKeys: opts.ledgerKeys,
  });
  yield { type: "filtered", kept: passed.length, rejected: rejected.length };

  yield { type: "ranking", jobs: passed.length };
  const rankings = await rankJobs(passed, opts.profile, opts.client);

  const results: RankedResult[] = passed
    .map((job) => ({ ...job, rank: rankings.get(job.key.slugKey) ?? null }))
    .sort((a, b) => (b.rank?.score ?? -1) - (a.rank?.score ?? -1));

  yield { type: "done", results, failed };
}
```

Create `packages/core/src/index.ts`:

```typescript
export * from "./types.js";
export * from "./models.js";
export * from "./job-key.js";
export * from "./resume.js";
export * from "./filter.js";
export * from "./rank.js";
export * from "./pipeline.js";
export * from "./adapters/index.js";
export * from "./adapters/greenhouse.js";
export * from "./adapters/lever.js";
export * from "./adapters/ashby.js";
export * from "./adapters/remoteok.js";
export * from "./adapters/arbeitnow.js";
export * from "./adapters/hn.js";
export * from "./adapters/web-search.js";
export * from "./adapters/bluesky.js";
export * from "./adapters/discover.js";
export * from "./answers.js";
```

Three of those modules are created in Tasks 16-18 and `answers.ts` in the apply plan's Task 1. Export them now: Task 17 Step 5 and the apply plan's Task 8 both import from `@job-agent/core`, and a missing export line surfaces as an unresolved import several tasks later, far from its cause. Until those files exist the `tsc` build will flag them — create empty placeholder modules if that blocks you, or add each line as its task lands.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/pipeline.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: PASS — all tests from Tasks 1–13.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts packages/core/src/index.ts
git commit -m "feat: fetch pipeline with streamed progress events"
```

---

### Task 14: Live-endpoint canary

A separate suite that hits the real APIs. It is the early warning for upstream shape changes and never runs in normal `pnpm test`.

**Files:**
- Create: `vitest.live.config.ts`
- Test: `packages/core/src/adapters/live.live.test.ts`

**Interfaces:**
- Consumes: `fetchGreenhouseBoard`, `fetchLeverBoard`, `fetchAshbyBoard`, `fetchRemoteOk`, `fetchArbeitnow`, `findLatestHiringThread`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the config**

Create `vitest.live.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.live.test.ts"],
    testTimeout: 60_000,
  },
});
```

- [ ] **Step 2: Write the canary test**

Create `packages/core/src/adapters/live.live.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fetchGreenhouseBoard } from "./greenhouse.js";
import { fetchLeverBoard } from "./lever.js";
import { fetchAshbyBoard } from "./ashby.js";
import { fetchRemoteOk } from "./remoteok.js";
import { fetchArbeitnow } from "./arbeitnow.js";
import { findLatestHiringThread } from "./hn.js";

describe("live endpoints", () => {
  it("greenhouse still returns first_published", async () => {
    const jobs = await fetchGreenhouseBoard("discord");
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((j) => j.first_published)).toBe(true);
  });

  it("lever still returns createdAt as epoch millis", async () => {
    const postings = await fetchLeverBoard("spotify");
    expect(postings.length).toBeGreaterThan(0);
    expect(postings[0]!.createdAt).toBeGreaterThan(1_500_000_000_000);
  });

  it("ashby still returns postings and still exposes no date field", async () => {
    const postings = await fetchAshbyBoard("ramp");
    expect(postings.length).toBeGreaterThan(0);
    expect(Object.keys(postings[0]!)).not.toContain("publishedAt");
  });

  it("remoteok still returns epoch seconds", async () => {
    const rows = await fetchRemoteOk();
    expect(rows.some((r) => r.position && r.epoch)).toBe(true);
  });

  it("arbeitnow still returns created_at", async () => {
    const rows = await fetchArbeitnow();
    expect(rows[0]!.created_at).toBeGreaterThan(1_500_000_000);
  });

  it("hn still has a findable who-is-hiring thread", async () => {
    expect(await findLatestHiringThread()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the live suite**

Run: `pnpm test:live`
Expected: PASS — 6 tests. A failure here means an upstream API changed, not that your code is broken.

- [ ] **Step 4: Confirm it does not run in the normal suite**

Run: `pnpm test`
Expected: PASS, and the live tests are absent from the output.

- [ ] **Step 5: Commit**

```bash
git add vitest.live.config.ts packages/core/src/adapters/live.live.test.ts
git commit -m "test: live endpoint canary suite"
```

---

### Task 15: Next.js app — profile switcher, fetch, and results

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/profiles/[id]/page.tsx`
- Create: `apps/web/app/api/fetch/route.ts`, `apps/web/app/actions.ts`
- Create: `apps/web/components/FetchPanel.tsx`, `apps/web/components/JobCard.tsx`
- Create: `apps/web/scripts/seed.ts`

**Interfaces:**
- Consumes: `runFetch`, `ProgressEvent`, `RankedResult`, `parseResume`, `DEFAULT_POSTURE_*` from `@job-agent/core`; `profiles`, `jobLedger`, `createDb` from `@job-agent/db`.
- Produces: the running app. Nothing downstream consumes it in this plan.

- [ ] **Step 1: Scaffold the app package**

`apps/web/package.json`:

```json
{
  "name": "@job-agent/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "@job-agent/core": "workspace:*",
    "@job-agent/db": "workspace:*",
    "@anthropic-ai/sdk": "^0.122.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "tailwindcss": "^3.4.0",
    "tsx": "^4.19.0",
    "pdf-parse": "^1.1.1"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the seed script**

Create `apps/web/scripts/seed.ts`:

```typescript
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfParse from "pdf-parse";
import { createDb, profiles } from "@job-agent/db";
import {
  parseResume,
  DEFAULT_POSTURE_INDIA,
  DEFAULT_POSTURE_REMOTE_GLOBAL,
} from "@job-agent/core";

const SEEDS = [
  {
    name: "Nikhil Mishra",
    ownerEmail: "nikhilmishra2608@gmail.com",
    pdf: process.env.RESUME_1 ?? "/Users/saumyamishra/Desktop/nikhil_resume_december.pdf",
    posture: DEFAULT_POSTURE_REMOTE_GLOBAL,
  },
  {
    name: "Shambhavi Soumya",
    ownerEmail: "shambhavisoumya10@gmail.com",
    pdf: process.env.RESUME_2 ?? "/Users/saumyamishra/Downloads/fullstackresume.pdf",
    // Posture unset by its owner — India + remote is the documented default.
    posture: DEFAULT_POSTURE_INDIA,
  },
];

const db = createDb(process.env.DATABASE_URL!);
const client = new Anthropic();

for (const seed of SEEDS) {
  const { text } = await pdfParse(fs.readFileSync(seed.pdf));
  const parsed = await parseResume(text, client);
  await db.insert(profiles).values({
    name: seed.name,
    ownerEmail: seed.ownerEmail,
    resumeText: text,
    parsedProfile: parsed,
    posture: seed.posture,
    // Both profiles start unauthorized. Only the profile's own owner flips this.
    autoSubmitAuthorized: false,
  });
  console.log(
    `seeded ${seed.name}: bands=${parsed.seniorityBands.join(",")} stack=${parsed.coreStack.length}`,
  );
}
```

- [ ] **Step 3: Write the streaming fetch route**

Create `apps/web/app/api/fetch/route.ts`:

```typescript
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { createDb, profiles, jobLedger } from "@job-agent/db";
import {
  runFetch,
  loadBoards,
  ledgerMatchKeys,
  fetchGreenhouseBoard,
  normalizeGreenhouse,
  fetchLeverBoard,
  normalizeLever,
  fetchAshbyBoard,
  normalizeAshby,
  fetchRemoteOk,
  normalizeRemoteOk,
  fetchArbeitnow,
  normalizeArbeitnow,
  findLatestHiringThread,
  fetchThreadComments,
  parseHnComment,
  type SourceTask,
  type NormalizedJob,
} from "@job-agent/core";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const { profileId, timeFrameDays } = (await request.json()) as {
    profileId: string;
    timeFrameDays: number | null;
  };

  const db = createDb(process.env.DATABASE_URL!);
  const client = new Anthropic();

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  if (!profile) return new Response("profile not found", { status: 404 });

  const ledgerRows = await db
    .select()
    .from(jobLedger)
    .where(eq(jobLedger.profileId, profileId));
  const ledgerKeys = new Set(
    ledgerRows.flatMap((r) => ledgerMatchKeys({ atsKey: r.atsKey, slugKey: r.slugKey })),
  );

  const boards = loadBoards(
    fs.readFileSync(path.join(process.cwd(), "..", "..", "sources", "boards.yaml"), "utf8"),
  );

  const sources: SourceTask[] = [
    ...boards.greenhouse.map((token) => ({
      kind: "greenhouse" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchGreenhouseBoard(token)).map((j) => normalizeGreenhouse(j, token)),
    })),
    ...boards.lever.map((token) => ({
      kind: "lever" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchLeverBoard(token)).map((j) => normalizeLever(j, token)),
    })),
    {
      kind: "remoteok" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchRemoteOk())
          .map(normalizeRemoteOk)
          .filter((j): j is NormalizedJob => j !== null),
    },
    {
      kind: "arbeitnow" as const,
      run: async (): Promise<NormalizedJob[]> =>
        (await fetchArbeitnow()).map(normalizeArbeitnow),
    },
    {
      kind: "hn" as const,
      run: async (): Promise<NormalizedJob[]> => {
        const comments = await fetchThreadComments(await findLatestHiringThread());
        const parsed = await Promise.all(
          comments.map((c) => parseHnComment(c, client).catch(() => null)),
        );
        return parsed.filter((j): j is NormalizedJob => j !== null);
      },
    },
  ];

  // Ashby exposes no post date, so it only participates in an unbounded fetch.
  if (timeFrameDays === null) {
    sources.push(
      ...boards.ashby.map((org) => ({
        kind: "ashby" as const,
        run: async (): Promise<NormalizedJob[]> =>
          (await fetchAshbyBoard(org)).map((j) => normalizeAshby(j, org)),
      })),
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runFetch({
          profile: profile.parsedProfile as never,
          posture: profile.posture as never,
          sources,
          ledgerKeys,
          timeFrameDays,
          client,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Write the dismiss server action**

Create `apps/web/app/actions.ts`:

```typescript
"use server";

import { createDb, jobLedger } from "@job-agent/db";

export async function dismissJob(input: {
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}): Promise<void> {
  const db = createDb(process.env.DATABASE_URL!);
  await db.insert(jobLedger).values({ ...input, state: "dismissed" });
}
```

- [ ] **Step 5: Write the fetch panel**

Create `apps/web/components/FetchPanel.tsx`:

```tsx
"use client";

import { useState } from "react";

const TIME_FRAMES = [
  { label: "24 hours", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "Any (includes undated sources)", days: null },
] as const;

interface RankedResult {
  key: { atsKey: string | null; slugKey: string };
  company: string;
  title: string;
  locationRaw: string;
  applyUrl: string;
  sourceKind: string;
  postedAt: string | null;
  dateFidelity: "true" | "none";
  rank: {
    score: number;
    tier: string;
    why: string;
    redFlags: string[];
    sponsorshipGate: boolean;
  } | null;
}

export function FetchPanel({ profileId }: { profileId: string }) {
  const [timeFrameDays, setTimeFrameDays] = useState<number | null>(7);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<RankedResult[]>([]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setLog([]);
    setResults([]);

    const response = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, timeFrameDays }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ")) continue;
        const event = JSON.parse(chunk.slice(6));
        if (event.type === "fetching") {
          setLog((l) => [...l, `fetching ${event.sources} sources…`]);
        } else if (event.type === "fetched") {
          setLog((l) => [
            ...l,
            `${event.total} postings, ${event.deduped} after dedup` +
              (event.failed.length ? ` (${event.failed.join(", ")} failed)` : ""),
          ]);
        } else if (event.type === "filtered") {
          setLog((l) => [...l, `${event.kept} match, ${event.rejected} filtered out`]);
        } else if (event.type === "ranking") {
          setLog((l) => [...l, `ranking ${event.jobs}…`]);
        } else if (event.type === "done") {
          setResults(event.results);
          setLog((l) => [...l, `done — ${event.results.length} results`]);
        } else if (event.type === "error") {
          setLog((l) => [...l, `error: ${event.message}`]);
        }
      }
    }
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="rounded border px-3 py-2"
          value={String(timeFrameDays)}
          onChange={(e) =>
            setTimeFrameDays(e.target.value === "null" ? null : Number(e.target.value))
          }
        >
          {TIME_FRAMES.map((t) => (
            <option key={t.label} value={String(t.days)}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          onClick={run}
          disabled={running}
        >
          {running ? "Fetching…" : "Fetch latest jobs for me"}
        </button>
      </div>

      <pre className="rounded bg-neutral-100 p-3 text-sm">{log.join("\n")}</pre>

      <ul className="space-y-3">
        {results.map((job) => (
          <li key={job.key.slugKey} className="rounded border p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-medium">
                {job.title} — {job.company}
              </h3>
              <span className="text-sm">{job.rank?.score ?? "—"}</span>
            </div>
            <p className="text-sm text-neutral-600">{job.rank?.why}</p>
            <p className="text-xs text-neutral-500">
              {job.locationRaw} · {job.sourceKind} ·{" "}
              {job.dateFidelity === "none"
                ? "no post date available"
                : job.postedAt?.slice(0, 10)}
            </p>
            {job.rank?.redFlags.length ? (
              <p className="text-xs text-amber-700">⚠ {job.rank.redFlags.join(", ")}</p>
            ) : null}
            <a className="text-sm underline" href={job.applyUrl} target="_blank" rel="noreferrer">
              Open posting
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Write the pages**

Create `apps/web/app/page.tsx`:

```tsx
import Link from "next/link";
import { createDb, profiles } from "@job-agent/db";

export default async function Home() {
  const db = createDb(process.env.DATABASE_URL!);
  const rows = await db.select().from(profiles);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Profiles</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((p) => (
          <li key={p.id} className="rounded border p-4">
            <Link href={`/profiles/${p.id}`} className="font-medium underline">
              {p.name}
            </Link>
            <p className="text-sm text-neutral-600">{p.ownerEmail}</p>
            {!p.autoSubmitAuthorized && (
              <p className="mt-2 text-xs text-neutral-500">Assisted apply only</p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

Create `apps/web/app/profiles/[id]/page.tsx`:

```tsx
import { eq } from "drizzle-orm";
import { createDb, profiles } from "@job-agent/db";
import { FetchPanel } from "../../../components/FetchPanel";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createDb(process.env.DATABASE_URL!);
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, id));
  if (!profile) return <main className="p-8">Profile not found.</main>;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">{profile.name}</h1>
      <FetchPanel profileId={id} />
    </main>
  );
}
```

Create `apps/web/app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Seed and run it end to end**

```bash
export DATABASE_URL="<your neon connection string>"
export ANTHROPIC_API_KEY="<your key>"
pnpm --filter @job-agent/db generate && pnpm --filter @job-agent/db migrate
pnpm --filter @job-agent/web seed
pnpm --filter @job-agent/web dev
```

Expected: the seed prints two lines showing **different** seniority bands — `mid,senior` for Nikhil and `entry,junior` for Shambhavi. Open `http://localhost:3000`, click into a profile, choose "7 days", and click **Fetch latest jobs for me**. The log fills in and ranked results render.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat: next.js dashboard with streaming fetch and ranked results"
```

---

### Task 16: Web-search adapter — Google reach, and the only route to X/Twitter posts

Claude's `web_search` server tool runs the search on Anthropic's infrastructure, so this needs no Google API key and no second vendor. It is also the only viable path to X/Twitter hiring posts: `api.twitter.com/2/tweets/search/recent` returns **401** unauthenticated and X's free tier has no search endpoint, so X posts are reached as indexed pages rather than through their API.

**Files:**
- Create: `packages/core/src/adapters/web-search.ts`
- Test: `packages/core/src/adapters/web-search.test.ts`

**Interfaces:**
- Consumes: `RANK_MODEL`, `UTILITY_MODEL`, `buildJobKey`, `ParsedProfile`, `NormalizedJob`.
- Produces: `buildSearchQueries(profile: ParsedProfile, timeFrameDays: number | null): string[]`, `fetchViaWebSearch(profile: ParsedProfile, timeFrameDays: number | null, client: Anthropic): Promise<NormalizedJob[]>`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/adapters/web-search.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildSearchQueries, fetchViaWebSearch } from "./web-search.js";
import { deriveTitleKeywords } from "../resume.js";
import type { ParsedProfile } from "../resume.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React", "Next.js"],
  bonusStack: ["Solidity"],
  ...deriveTitleKeywords(["mid", "senior"]),
};

describe("buildSearchQueries", () => {
  it("includes a general remote job query using the core stack", () => {
    const queries = buildSearchQueries(profile, 7);
    expect(queries.some((q) => q.includes("TypeScript"))).toBe(true);
  });

  it("includes X and Twitter site queries for hiring posts", () => {
    const queries = buildSearchQueries(profile, 7);
    expect(queries.some((q) => q.includes("site:x.com"))).toBe(true);
    expect(queries.some((q) => q.includes("site:twitter.com"))).toBe(true);
  });

  it("uses the profile's own seniority words, not fixed ones", () => {
    const grad = { ...profile, ...deriveTitleKeywords(["entry", "junior"]) };
    const queries = buildSearchQueries(grad, 7);
    expect(queries.join(" ")).toContain("new grad");
    expect(queries.join(" ")).not.toContain("principal");
  });

  it("names the recency window in the query text", () => {
    expect(buildSearchQueries(profile, 1).join(" ")).toMatch(/24 hours|past day/i);
    expect(buildSearchQueries(profile, null).join(" ")).not.toMatch(/past day/i);
  });
});

describe("fetchViaWebSearch", () => {
  function fakeClient(searchText: string, extracted: unknown) {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: searchText }],
        }),
        parse: vi.fn().mockResolvedValue({ parsed_output: extracted }),
      },
    } as never;
  }

  const oneJob = {
    jobs: [
      {
        company: "Acme Robotics",
        title: "Senior Full Stack Engineer",
        location: "Remote (worldwide)",
        remote: true,
        applyUrl: "https://acme.example/jobs/42",
        postedAtIso: "2026-08-27",
        sourcePage: "https://x.com/acmerobotics/status/1",
      },
    ],
  };

  it("marks web-search results as reported fidelity, not true", async () => {
    const jobs = await fetchViaWebSearch(
      profile,
      7,
      fakeClient("found some jobs", oneJob),
    );
    expect(jobs[0]!.dateFidelity).toBe("reported");
  });

  it("uses the reported date when the model supplies one", async () => {
    const jobs = await fetchViaWebSearch(profile, 7, fakeClient("x", oneJob));
    expect(jobs[0]!.postedAt?.toISOString().slice(0, 10)).toBe("2026-08-27");
  });

  it("falls back to no date when the reported date is unparseable", async () => {
    const jobs = await fetchViaWebSearch(
      profile,
      7,
      fakeClient("x", {
        jobs: [{ ...oneJob.jobs[0], postedAtIso: "sometime recently" }],
      }),
    );
    expect(jobs[0]!.postedAt).toBeNull();
    expect(jobs[0]!.dateFidelity).toBe("none");
  });

  it("drops entries with no apply url", async () => {
    const jobs = await fetchViaWebSearch(
      profile,
      7,
      fakeClient("x", { jobs: [{ ...oneJob.jobs[0], applyUrl: "" }] }),
    );
    expect(jobs).toHaveLength(0);
  });

  it("declares the web_search server tool on the search call", async () => {
    const client = fakeClient("x", oneJob);
    await fetchViaWebSearch(profile, 7, client);
    const call = (client as unknown as {
      messages: { create: { mock: { calls: unknown[][] } } };
    }).messages.create.mock.calls[0]![0] as { tools: { type: string }[] };
    expect(call.tools[0]!.type).toBe("web_search_20260209");
  });

  it("returns an empty list rather than throwing when extraction fails", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "x" }] }),
        parse: vi.fn().mockResolvedValue({ parsed_output: null }),
      },
    } as never;
    expect(await fetchViaWebSearch(profile, 7, client)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/web-search.test.ts`
Expected: FAIL — cannot resolve `./web-search.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/adapters/web-search.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildJobKey } from "../job-key.js";
import { RANK_MODEL, UTILITY_MODEL } from "../models.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";

const FoundJobsSchema = z.object({
  jobs: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string(),
      remote: z.boolean(),
      applyUrl: z.string(),
      /** ISO date if the page stated one, else an empty string. */
      postedAtIso: z.string(),
      sourcePage: z.string(),
    }),
  ),
});

function recencyPhrase(timeFrameDays: number | null): string {
  if (timeFrameDays === null) return "";
  if (timeFrameDays <= 1) return " posted in the past 24 hours";
  return ` posted in the past ${timeFrameDays} days`;
}

/**
 * Search queries derived from the profile — never a fixed list. The site: queries
 * are the only route to X/Twitter hiring posts, since X's API requires a paid tier.
 */
export function buildSearchQueries(
  profile: ParsedProfile,
  timeFrameDays: number | null,
): string[] {
  const stack = profile.coreStack.slice(0, 4).join(" ");
  const seniority = profile.titlesAccept.slice(0, 3).join(" OR ");
  const recency = recencyPhrase(timeFrameDays);

  return [
    `remote ${seniority} full stack developer jobs ${stack}${recency}`,
    `site:x.com "we're hiring" OR "we are hiring" ${stack} remote${recency}`,
    `site:twitter.com "hiring" full stack engineer ${stack} remote${recency}`,
    `"now hiring" remote full stack ${stack} apply${recency}`,
  ];
}

/**
 * Two calls by design: one search call that reads the web, then one extraction
 * call that structures what it found. Keeping them separate avoids relying on
 * an undocumented interaction between server tools and output_config.format.
 */
export async function fetchViaWebSearch(
  profile: ParsedProfile,
  timeFrameDays: number | null,
  client: Anthropic,
): Promise<NormalizedJob[]> {
  const queries = buildSearchQueries(profile, timeFrameDays);

  const search = await client.messages.create({
    model: RANK_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
    messages: [
      {
        role: "user",
        content:
          "Search the web for currently-open job postings matching this " +
          `candidate. Run these searches:\n${queries.map((q) => `- ${q}`).join("\n")}\n\n` +
          "For each real posting you find, note the company, exact role title, " +
          "location, whether it is remote, the direct application URL, the date " +
          "it was posted if the page states one, and the page you found it on. " +
          "Skip aggregator index pages, listicles, and posts that are not a " +
          "specific open role.\n\nCANDIDATE\n" +
          `Target seniority: ${profile.seniorityBands.join(", ")}\n` +
          `Core stack: ${profile.coreStack.join(", ")}`,
      },
    ],
  });

  const findings = search.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!findings.trim()) return [];

  const extraction = await client.messages.parse({
    model: UTILITY_MODEL,
    max_tokens: 8192,
    output_config: { format: zodOutputFormat(FoundJobsSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content:
          "Convert these search findings into structured job rows. Use an empty " +
          "string for postedAtIso when no date was stated — do not guess one.\n\n" +
          findings,
      },
    ],
  });

  const found = extraction.parsed_output;
  if (!found) return [];

  return found.jobs
    .filter((j) => j.applyUrl && j.company && j.title)
    .map((j): NormalizedJob => {
      const parsedDate = j.postedAtIso ? new Date(j.postedAtIso) : null;
      const validDate =
        parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
      return {
        key: buildJobKey({
          company: j.company,
          title: j.title,
          atsKind: null,
          atsRef: null,
        }),
        sourceKind: "websearch",
        company: j.company,
        title: j.title,
        locationRaw: j.location,
        remote: j.remote,
        descriptionText: `Found via web search on ${j.sourcePage}`,
        applyUrl: j.applyUrl,
        atsKind: null,
        atsRef: null,
        postedAt: validDate,
        // A date read off a page is weaker evidence than a machine field.
        dateFidelity: validDate ? "reported" : "none",
      };
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/web-search.test.ts`
Expected: PASS — 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/web-search.ts packages/core/src/adapters/web-search.test.ts
git commit -m "feat: web-search adapter covering google reach and x/twitter posts"
```

---

### Task 17: Bluesky hiring-post adapter

Verified: `public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` returns **403** unauthenticated, but `bsky.social/xrpc/com.atproto.server.createSession` responds correctly (`AuthenticationRequired` on bad credentials), so a free account plus an app password unlocks search. This is the social source that actually works without a paid tier.

**Files:**
- Create: `packages/core/src/adapters/bluesky.ts`
- Test: `packages/core/src/adapters/bluesky.test.ts`

**Interfaces:**
- Consumes: `UTILITY_MODEL`, `buildJobKey`, `ParsedProfile`, `NormalizedJob`.
- Produces: `createBlueskySession(identifier: string, appPassword: string): Promise<string>`, `searchBlueskyPosts(accessJwt: string, query: string, limit?: number): Promise<BlueskyPost[]>`, `parseBlueskyPost(post: BlueskyPost, client: Anthropic): Promise<NormalizedJob | null>`, `buildBlueskyQueries(profile: ParsedProfile): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/adapters/bluesky.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  parseBlueskyPost,
  buildBlueskyQueries,
  type BlueskyPost,
} from "./bluesky.js";
import { deriveTitleKeywords } from "../resume.js";
import type { ParsedProfile } from "../resume.js";

const profile: ParsedProfile = {
  fullName: "Nikhil Mishra",
  yearsExperience: 5,
  graduationYear: 2023,
  seniorityBands: ["mid", "senior"],
  coreStack: ["TypeScript", "React"],
  bonusStack: [],
  ...deriveTitleKeywords(["mid", "senior"]),
};

const post: BlueskyPost = {
  uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
  author: { handle: "acme.bsky.social", displayName: "Acme Robotics" },
  record: {
    text: "We're hiring a Senior Full Stack Engineer, fully remote. TypeScript + React. Apply: https://acme.example/jobs/42",
    createdAt: "2026-08-27T10:00:00.000Z",
    facets: [
      {
        features: [
          { $type: "app.bsky.richtext.facet#link", uri: "https://acme.example/jobs/42" },
        ],
      },
    ],
  },
};

function fakeClient(parsed: unknown) {
  return {
    messages: { parse: vi.fn().mockResolvedValue({ parsed_output: parsed }) },
  } as never;
}

const hiring = {
  isHiringPost: true,
  company: "Acme Robotics",
  title: "Senior Full Stack Engineer",
  location: "Remote",
  remote: true,
  applyUrl: "https://acme.example/jobs/42",
};

describe("buildBlueskyQueries", () => {
  it("derives queries from the profile stack and seniority", () => {
    const queries = buildBlueskyQueries(profile);
    expect(queries.join(" ")).toContain("TypeScript");
    expect(queries.some((q) => q.includes("hiring"))).toBe(true);
  });
});

describe("parseBlueskyPost", () => {
  it("builds a normalized job from a hiring post", async () => {
    const job = await parseBlueskyPost(post, fakeClient(hiring));
    expect(job).not.toBeNull();
    expect(job!.company).toBe("Acme Robotics");
    expect(job!.sourceKind).toBe("bluesky");
  });

  it("uses the post createdAt as a true post date", async () => {
    const job = await parseBlueskyPost(post, fakeClient(hiring));
    expect(job!.dateFidelity).toBe("true");
    expect(job!.postedAt?.toISOString()).toBe("2026-08-27T10:00:00.000Z");
  });

  it("prefers a facet link over the model's applyUrl", async () => {
    const job = await parseBlueskyPost(
      post,
      fakeClient({ ...hiring, applyUrl: "https://wrong.example" }),
    );
    expect(job!.applyUrl).toBe("https://acme.example/jobs/42");
  });

  it("drops posts the model says are not hiring posts", async () => {
    const job = await parseBlueskyPost(
      post,
      fakeClient({ ...hiring, isHiringPost: false }),
    );
    expect(job).toBeNull();
  });

  it("drops hiring posts that carry no application link at all", async () => {
    const linkless: BlueskyPost = {
      ...post,
      record: { ...post.record, facets: [] },
    };
    const job = await parseBlueskyPost(
      linkless,
      fakeClient({ ...hiring, applyUrl: "" }),
    );
    expect(job).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/bluesky.test.ts`
Expected: FAIL — cannot resolve `./bluesky.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/adapters/bluesky.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildJobKey } from "../job-key.js";
import { UTILITY_MODEL } from "../models.js";
import type { ParsedProfile } from "../resume.js";
import type { NormalizedJob } from "../types.js";

export interface BlueskyPost {
  uri: string;
  author: { handle: string; displayName?: string };
  record: {
    text: string;
    createdAt: string;
    facets?: { features: { uri?: string }[] }[];
  };
}

const HiringPostSchema = z.object({
  isHiringPost: z.boolean(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  remote: z.boolean(),
  applyUrl: z.string(),
});

/** Exchanges an app password for a session token. Create the app password in Bluesky settings. */
export async function createBlueskySession(
  identifier: string,
  appPassword: string,
): Promise<string> {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: appPassword }),
  });
  if (!res.ok) throw new Error(`bluesky auth: HTTP ${res.status}`);
  const body = (await res.json()) as { accessJwt: string };
  return body.accessJwt;
}

export async function searchBlueskyPosts(
  accessJwt: string,
  query: string,
  limit = 50,
): Promise<BlueskyPost[]> {
  const url = new URL("https://bsky.social/xrpc/app.bsky.feed.searchPosts");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "latest");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessJwt}` } });
  if (!res.ok) throw new Error(`bluesky search: HTTP ${res.status}`);
  const body = (await res.json()) as { posts?: BlueskyPost[] };
  return body.posts ?? [];
}

export function buildBlueskyQueries(profile: ParsedProfile): string[] {
  const stack = profile.coreStack.slice(0, 3);
  return [
    `hiring remote ${stack[0] ?? "developer"}`,
    `"we're hiring" full stack ${stack[1] ?? "react"}`,
    `hiring ${profile.seniorityBands[0] ?? "senior"} engineer remote`,
  ];
}

/** First link in the post's facets — more reliable than a URL the model retyped. */
function firstLink(post: BlueskyPost): string | null {
  for (const facet of post.record.facets ?? []) {
    for (const feature of facet.features) {
      if (feature.uri) return feature.uri;
    }
  }
  return null;
}

export async function parseBlueskyPost(
  post: BlueskyPost,
  client: Anthropic,
): Promise<NormalizedJob | null> {
  const response = await client.messages.parse({
    model: UTILITY_MODEL,
    max_tokens: 1024,
    output_config: { format: zodOutputFormat(HiringPostSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content:
          "Does this Bluesky post advertise a specific open job? Set isHiringPost " +
          "false for job seekers, commentary, or general company news. Use empty " +
          "strings for anything not stated.\n\n" +
          `Author: ${post.author.displayName ?? post.author.handle}\n${post.record.text}`,
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed?.isHiringPost || !parsed.company || !parsed.title) return null;

  const applyUrl = firstLink(post) ?? parsed.applyUrl;
  if (!applyUrl) return null;

  return {
    key: buildJobKey({
      company: parsed.company,
      title: parsed.title,
      atsKind: null,
      atsRef: null,
    }),
    sourceKind: "bluesky",
    company: parsed.company,
    title: parsed.title,
    locationRaw: parsed.location,
    remote: parsed.remote,
    descriptionText: post.record.text,
    applyUrl,
    atsKind: null,
    atsRef: null,
    postedAt: new Date(post.record.createdAt),
    dateFidelity: "true",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/bluesky.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Wire both new sources into the fetch route**

In `apps/web/app/api/fetch/route.ts`, add to the imports:

```typescript
import {
  fetchViaWebSearch,
  createBlueskySession,
  searchBlueskyPosts,
  buildBlueskyQueries,
  parseBlueskyPost,
} from "@job-agent/core";
```

Then append to the `sources` array, after the `hn` entry:

```typescript
    {
      kind: "websearch" as const,
      run: (): Promise<NormalizedJob[]> =>
        fetchViaWebSearch(profile.parsedProfile as never, timeFrameDays, client),
    },
```

And, guarded so a missing credential disables the source rather than failing the fetch:

```typescript
  if (process.env.BLUESKY_IDENTIFIER && process.env.BLUESKY_APP_PASSWORD) {
    sources.push({
      kind: "bluesky" as const,
      run: async (): Promise<NormalizedJob[]> => {
        const token = await createBlueskySession(
          process.env.BLUESKY_IDENTIFIER!,
          process.env.BLUESKY_APP_PASSWORD!,
        );
        const queries = buildBlueskyQueries(profile.parsedProfile as never);
        const batches = await Promise.all(
          queries.map((q) => searchBlueskyPosts(token, q).catch(() => [])),
        );
        const parsed = await Promise.all(
          batches.flat().map((p) => parseBlueskyPost(p, client).catch(() => null)),
        );
        return parsed.filter((j): j is NormalizedJob => j !== null);
      },
    });
  }
```

- [ ] **Step 6: Verify end to end**

```bash
export BLUESKY_IDENTIFIER="<your handle>.bsky.social"
export BLUESKY_APP_PASSWORD="<app password from Bluesky settings>"
pnpm --filter @job-agent/web dev
```

Expected: the progress log now reports more sources, and results include cards with source `websearch` and `bluesky`. Web-search cards show "date reported by page" rather than a hard date.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/adapters/bluesky.ts packages/core/src/adapters/bluesky.test.ts apps/web/app/api/fetch/route.ts
git commit -m "feat: bluesky hiring-post adapter, wire web-search into fetch route"
```

---

### Task 18: Board-token discovery

Every company name the aggregators and web search surface is a candidate board token. Probing 200-vs-404 turns those names into new sources, which is how `boards.yaml` grows past its seed without hand-curation.

**Files:**
- Create: `packages/core/src/adapters/discover.ts`
- Create: `apps/web/scripts/discover.ts`
- Test: `packages/core/src/adapters/discover.test.ts`

**Interfaces:**
- Consumes: `BoardsConfig`, `mapWithConcurrency`.
- Produces: `candidateTokens(companyName: string): string[]`, `probeBoardToken(provider: "greenhouse" | "lever" | "ashby", token: string): Promise<boolean>`, `discoverBoards(companyNames: string[], existing: BoardsConfig, probe?: ProbeFn): Promise<BoardsConfig>`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/adapters/discover.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { candidateTokens, discoverBoards } from "./discover.js";

const empty = { greenhouse: [], lever: [], ashby: [] };

describe("candidateTokens", () => {
  it("lowercases and strips punctuation and spaces", () => {
    expect(candidateTokens("Acme Robotics, Inc.")).toContain("acmerobotics");
  });

  it("offers a hyphenated variant too", () => {
    expect(candidateTokens("Acme Robotics")).toContain("acme-robotics");
  });

  it("drops corporate suffixes", () => {
    const tokens = candidateTokens("Acme Labs Ltd");
    expect(tokens).toContain("acmelabs");
  });
});

describe("discoverBoards", () => {
  it("adds tokens that probe successfully", async () => {
    const probe = vi.fn(async (provider: string, token: string) =>
      provider === "greenhouse" && token === "acme",
    );
    const result = await discoverBoards(["Acme"], empty, probe);
    expect(result.greenhouse).toContain("acme");
    expect(result.lever).toEqual([]);
  });

  it("never duplicates a token already present", async () => {
    const probe = vi.fn(async () => true);
    const result = await discoverBoards(["Acme"], { ...empty, greenhouse: ["acme"] }, probe);
    expect(result.greenhouse.filter((t) => t === "acme")).toHaveLength(1);
  });

  it("skips probing companies already known on some provider", async () => {
    const probe = vi.fn(async () => true);
    await discoverBoards(["Acme"], { ...empty, lever: ["acme"] }, probe);
    expect(probe).not.toHaveBeenCalledWith("greenhouse", "acme");
  });

  it("treats a probe failure as a miss rather than throwing", async () => {
    const probe = vi.fn(async () => {
      throw new Error("network");
    });
    const result = await discoverBoards(["Acme"], empty, probe);
    expect(result.greenhouse).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/adapters/discover.test.ts`
Expected: FAIL — cannot resolve `./discover.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/adapters/discover.ts`:

```typescript
import { mapWithConcurrency, type BoardsConfig } from "./index.js";

export type Provider = "greenhouse" | "lever" | "ashby";
export type ProbeFn = (provider: Provider, token: string) => Promise<boolean>;

const PROVIDERS: Provider[] = ["greenhouse", "lever", "ashby"];
const SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|gmbh|labs?|technologies|tech|pvt)\b/gi;

/** Plausible board tokens for a company name — providers use varied conventions. */
export function candidateTokens(companyName: string): string[] {
  const cleaned = companyName.replace(SUFFIXES, " ").replace(/[^a-zA-Z0-9\s]/g, " ");
  const words = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return [...new Set([words.join(""), words.join("-"), words[0]!])];
}

/** A 200 means the board exists; a 404 means this company is not on this provider. */
export async function probeBoardToken(
  provider: Provider,
  token: string,
): Promise<boolean> {
  const url =
    provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`
      : provider === "lever"
        ? `https://api.lever.co/v0/postings/${token}?mode=json`
        : `https://jobs.ashbyhq.com/${token}`;
  const res = await fetch(url, { method: "GET" });
  return res.ok;
}

export async function discoverBoards(
  companyNames: string[],
  existing: BoardsConfig,
  probe: ProbeFn = probeBoardToken,
): Promise<BoardsConfig> {
  const known = new Set([...existing.greenhouse, ...existing.lever, ...existing.ashby]);
  const result: BoardsConfig = {
    greenhouse: [...existing.greenhouse],
    lever: [...existing.lever],
    ashby: [...existing.ashby],
  };

  const attempts = companyNames
    .flatMap(candidateTokens)
    .filter((token) => !known.has(token))
    .flatMap((token) => PROVIDERS.map((provider) => ({ provider, token })));

  const settled = await mapWithConcurrency(attempts, 10, async ({ provider, token }) => {
    return { provider, token, hit: await probe(provider, token) };
  });

  for (const outcome of settled) {
    // A network failure is a miss, not a crash — discovery is best-effort.
    if (outcome.status !== "fulfilled" || !outcome.value.hit) continue;
    const { provider, token } = outcome.value;
    if (known.has(token)) continue;
    result[provider].push(token);
    known.add(token);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/adapters/discover.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Write the discovery script**

Create `apps/web/scripts/discover.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { loadBoards, discoverBoards, fetchRemoteOk, fetchArbeitnow } from "@job-agent/core";

const boardsPath = path.join(process.cwd(), "..", "..", "sources", "boards.yaml");
const existing = loadBoards(fs.readFileSync(boardsPath, "utf8"));

const [remoteok, arbeitnow] = await Promise.all([
  fetchRemoteOk().catch(() => []),
  fetchArbeitnow().catch(() => []),
]);

const companies = [
  ...new Set([
    ...remoteok.map((r) => r.company).filter((c): c is string => Boolean(c)),
    ...arbeitnow.map((r) => r.company_name),
  ]),
];

console.log(`probing ${companies.length} company names…`);
const grown = await discoverBoards(companies, existing);

const added =
  grown.greenhouse.length - existing.greenhouse.length +
  (grown.lever.length - existing.lever.length) +
  (grown.ashby.length - existing.ashby.length);

fs.writeFileSync(boardsPath, stringify(grown));
console.log(`added ${added} board tokens; boards.yaml updated`);
```

- [ ] **Step 6: Run discovery for real**

Run: `pnpm --filter @job-agent/web exec tsx scripts/discover.ts`
Expected: prints how many company names were probed and how many tokens were added, then `boards.yaml` contains more entries than the seed list. Inspect the diff before committing — a bogus token costs a wasted request per fetch.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/adapters/discover.ts packages/core/src/adapters/discover.test.ts apps/web/scripts/discover.ts sources/boards.yaml
git commit -m "feat: board-token discovery from aggregator company names"
```

---

## Self-Review Notes

Checked against the spec:

- §4 (what persists) — Task 3, and no task writes postings anywhere.
- §5 (sources) — Tasks 4–9. §5.1 date fidelity — Task 4 Step 2 test 1, Task 7 tests 1–2, Task 11 time-frame tests, Task 14 canary.
- §7.1 (job key) — Task 2, all eight tests.
- §7.2 (profile-derived filter) — Tasks 10–11; the opposite-seniority guard is Task 11's first block.
- §7.3 (ranking) — Task 12.
- §8 (profiles, answer bank, second-profile authorization) — Task 3 schema, Task 15 seed script sets `autoSubmitAuthorized: false` for both.
- §10 (dashboard) — Task 15.
- §11 (testing) — Tasks 2–14; live canary is Task 14.
- §12 (error handling) — Task 9 `mapWithConcurrency`, Task 12 batch isolation, Task 13 all-sources-failed error event.

- Web search covering Google reach and X/Twitter posts — Task 16.
- Bluesky hiring posts — Task 17.
- Board-token discovery (spec §5, "that 200-vs-404 response is itself a discovery mechanism") — Task 18.

Not covered here, by design: §6 and §9 (apply flow, fillers, worker) are in `2026-08-29-job-agent-apply.md`. The `answer_bank` table is created in Task 3 but not populated until that plan.

**Type consistency check.** `DateFidelity` gained `'reported'` in Task 2 and is produced only by Task 16; Task 11's filter needs no change, because a `'reported'` job carries a real `postedAt` and passes the same date branch as `'true'`. `SourceKind` gained `websearch` and `bluesky` in Task 2 and both are used in Tasks 16-17 and the Task 17 route wiring. `mapWithConcurrency` (Task 9) is reused unchanged by Task 18.
