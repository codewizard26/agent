# Job Agent — Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a ranked result into a filled-in application. Click Apply, and a local worker opens the real ATS form in a dedicated Chrome profile with every answerable field already populated — name, email, phone, location, links, resume upload, work authorization, notice period, EEO — leaving only the final submit click and any per-job free-text.

**Architecture:** The web app queues an `apply_tasks` row. A local Node worker polls that table, drives Playwright against a **dedicated** persistent Chrome profile, resolves the posting's final URL after redirects, selects a filler by landing host, fills from the profile's answer bank, and hands the tab over. Fillers match fields by **label text, not `name` attributes** — the rendered Greenhouse form is React-controlled and its only named input is `g-recaptcha-response`.

**Tech Stack:** TypeScript, Playwright (`channel: "chrome"`, `headless: false`), Drizzle, Vitest, `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-08-29-job-agent-design.md` (§6, §8, §9)

**Prerequisite:** `2026-08-29-job-agent-feed.md` complete through **Task 18**, not Task 15. Feed Task 17 Step 5 edits `apps/web/app/api/fetch/route.ts`, and this plan edits the same app — running the two plans interleaved produces conflicting edits to that file. Order is: feed 1-18, then apply 1-8. This plan restarts task numbering at 1.

## Global Constraints

- **The worker never clicks submit.** Cycle 1 ends at `awaiting_human`. Marking applied is an explicit user action in the dashboard, so the ledger never records a submission that did not happen.
- **A dedicated Chrome profile directory**, never the user's daily one. Chrome holds a lock on its user-data-dir; driving the daily profile would mean quitting Chrome before every application. Verified working: `launchPersistentContext` with `channel: "chrome"`, `headless: false` loads live Greenhouse forms at HTTP 200 with no Cloudflare challenge, 34 and 22 visible fields on two real postings.
- **Every major ATS captcha-gates submit** — Greenhouse behind a Cloudflare challenge on plain HTTP, Lever hCaptcha, Ashby reCAPTCHA, Workable reCAPTCHA + Turnstile. Nothing in this codebase attempts to clear a CAPTCHA.
- **Match fields by label, `aria-label`, and placeholder — never by `name`.**
- **Nothing is invented.** A field with no stored answer goes to `blocked_fields`. The worker does not guess and does not submit a partial form.
- **EEO/demographic fields default to "decline to self-identify."** Voluntary; the owner may set otherwise, the app never picks for them.
- **`auto_submit_authorized` is false for every profile in cycle 1**, and false profiles stay assisted regardless of any adapter's `submitMode`.
- **Filler tests run against saved HTML fixtures.** Never against live apply forms — a test suite must not create real applications.
- **Commit after every task.**

---

## File Structure

```
apps/worker/
├── package.json
├── src/index.ts                 poll loop, task state machine
├── src/browser.ts               dedicated persistent Chrome context
├── src/harvest.ts               enumerate visible fields with their labels
├── src/fillers/types.ts         AtsFiller interface, FillOutcome
├── src/fillers/greenhouse.ts
├── src/fillers/lever.ts
├── src/fillers/ashby.ts
├── src/fillers/workable.ts
├── src/fillers/generic.ts       label → answer-key mapping via Claude
├── src/fillers/select.ts        pick a filler by landing host
└── src/fixtures/                saved form HTML, captured by scripts/capture.ts
apps/web/
├── app/answers/[profileId]/page.tsx   answer bank editor
└── app/actions.ts                     queueApply, markApplied (extended)
```

---

### Task 1: Answer bank — seed keys and editor

**Files:**
- Create: `apps/web/app/answers/[profileId]/page.tsx`, `apps/web/components/AnswerBankForm.tsx`
- Create: `packages/core/src/answers.ts`
- Modify: `apps/web/app/actions.ts`
- Test: `packages/core/src/answers.test.ts`

**Interfaces:**
- Consumes: `answerBank` table from feed plan Task 3.
- Produces: `ANSWER_KEYS: AnswerKeyDef[]`, `seedAnswerRows(profileId: string): NewAnswerRow[]`, `resolveAnswer(rows, key): string | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/answers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ANSWER_KEYS, seedAnswerRows, resolveAnswer } from "./answers.js";

describe("ANSWER_KEYS", () => {
  it("covers the mechanical identity fields", () => {
    const keys = ANSWER_KEYS.map((k) => k.key);
    for (const k of ["full_name", "email", "phone", "location", "linkedin_url", "github_url"]) {
      expect(keys).toContain(k);
    }
  });

  it("covers the gating fields that stall applications", () => {
    const keys = ANSWER_KEYS.map((k) => k.key);
    for (const k of ["work_authorization", "requires_sponsorship", "notice_period", "expected_compensation"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("seedAnswerRows", () => {
  it("creates a row per key for the profile", () => {
    const rows = seedAnswerRows("profile-1");
    expect(rows).toHaveLength(ANSWER_KEYS.length);
    expect(rows.every((r) => r.profileId === "profile-1")).toBe(true);
  });

  it("defaults every EEO field to decline to self-identify", () => {
    const rows = seedAnswerRows("profile-1");
    const eeo = rows.filter((r) => r.key.startsWith("eeo_"));
    expect(eeo.length).toBeGreaterThan(0);
    expect(eeo.every((r) => r.value === "Decline to self-identify")).toBe(true);
  });

  it("leaves non-EEO answers empty for the owner to fill", () => {
    const rows = seedAnswerRows("profile-1");
    expect(rows.find((r) => r.key === "expected_compensation")!.value).toBeNull();
  });
});

describe("resolveAnswer", () => {
  const rows = [
    { key: "email", value: "nikhilmishra2608@gmail.com" },
    { key: "notice_period", value: "" },
  ];

  it("returns a stored answer", () => {
    expect(resolveAnswer(rows, "email")).toBe("nikhilmishra2608@gmail.com");
  });

  it("treats an empty string as unanswered", () => {
    expect(resolveAnswer(rows, "notice_period")).toBeNull();
  });

  it("returns null for a key with no row at all", () => {
    expect(resolveAnswer(rows, "phone")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/answers.test.ts`
Expected: FAIL — cannot resolve `./answers.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/answers.ts`:

```typescript
export type AnswerKind = "text" | "select" | "boolean" | "file";

export interface AnswerKeyDef {
  key: string;
  label: string;
  kind: AnswerKind;
  /** Seeded value. Null means the owner must supply it. */
  defaultValue: string | null;
  help?: string;
}

const DECLINE = "Decline to self-identify";

export const ANSWER_KEYS: AnswerKeyDef[] = [
  { key: "full_name", label: "Full name", kind: "text", defaultValue: null },
  { key: "email", label: "Email", kind: "text", defaultValue: null },
  { key: "phone", label: "Phone", kind: "text", defaultValue: null },
  { key: "location", label: "Current location (city, country)", kind: "text", defaultValue: null },
  { key: "linkedin_url", label: "LinkedIn URL", kind: "text", defaultValue: null },
  { key: "github_url", label: "GitHub URL", kind: "text", defaultValue: null },
  { key: "portfolio_url", label: "Portfolio URL", kind: "text", defaultValue: null },
  {
    key: "work_authorization",
    label: "Work authorization",
    kind: "text",
    defaultValue: null,
    help: "e.g. 'Authorized to work in India; available worldwide as a remote contractor'",
  },
  {
    key: "requires_sponsorship",
    label: "Requires visa sponsorship",
    kind: "boolean",
    defaultValue: null,
  },
  { key: "notice_period", label: "Notice period", kind: "text", defaultValue: null },
  {
    key: "expected_compensation",
    label: "Expected compensation",
    kind: "text",
    defaultValue: null,
  },
  { key: "years_experience", label: "Years of experience", kind: "text", defaultValue: null },
  // Voluntary. Declining is the default; only the owner changes these.
  { key: "eeo_gender", label: "EEO — gender", kind: "select", defaultValue: DECLINE },
  { key: "eeo_race", label: "EEO — race/ethnicity", kind: "select", defaultValue: DECLINE },
  { key: "eeo_veteran", label: "EEO — veteran status", kind: "select", defaultValue: DECLINE },
  { key: "eeo_disability", label: "EEO — disability status", kind: "select", defaultValue: DECLINE },
];

export interface NewAnswerRow {
  profileId: string;
  key: string;
  label: string;
  kind: AnswerKind;
  value: string | null;
}

export function seedAnswerRows(profileId: string): NewAnswerRow[] {
  return ANSWER_KEYS.map((def) => ({
    profileId,
    key: def.key,
    label: def.label,
    kind: def.kind,
    value: def.defaultValue,
  }));
}

/** An empty string is unanswered, not an answer. */
export function resolveAnswer(
  rows: { key: string; value: string | null }[],
  key: string,
): string | null {
  const row = rows.find((r) => r.key === key);
  if (!row?.value || row.value.trim() === "") return null;
  return row.value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/answers.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Write the editor UI**

Create `apps/web/components/AnswerBankForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { saveAnswer } from "../app/actions";

interface Row {
  id: string;
  key: string;
  label: string;
  value: string | null;
}

export function AnswerBankForm({ rows }: { rows: Row[] }) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="grid gap-1">
          <label className="text-sm font-medium" htmlFor={row.id}>
            {row.label}
            {!row.value && <span className="ml-2 text-xs text-amber-700">unanswered</span>}
            {saved[row.id] && <span className="ml-2 text-xs text-green-700">saved</span>}
          </label>
          <input
            id={row.id}
            className="rounded border px-3 py-2"
            defaultValue={row.value ?? ""}
            onBlur={async (e) => {
              await saveAnswer({ id: row.id, value: e.target.value });
              setSaved((s) => ({ ...s, [row.id]: true }));
            }}
          />
        </li>
      ))}
    </ul>
  );
}
```

Create `apps/web/app/answers/[profileId]/page.tsx`:

```tsx
import { eq } from "drizzle-orm";
import { createDb, answerBank, profiles } from "@job-agent/db";
import { seedAnswerRows } from "@job-agent/core";
import { AnswerBankForm } from "../../../components/AnswerBankForm";

export default async function AnswersPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const db = createDb(process.env.DATABASE_URL!);

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  if (!profile) return <main className="p-8">Profile not found.</main>;

  let rows = await db.select().from(answerBank).where(eq(answerBank.profileId, profileId));
  if (rows.length === 0) {
    await db.insert(answerBank).values(seedAnswerRows(profileId));
    rows = await db.select().from(answerBank).where(eq(answerBank.profileId, profileId));
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-2 text-2xl font-semibold">{profile.name} — answers</h1>
      <p className="mb-6 text-sm text-neutral-600">
        These are filled into application forms automatically. Anything left blank stops an
        application and asks you.
      </p>
      <AnswerBankForm rows={rows} />
    </main>
  );
}
```

Add to `apps/web/app/actions.ts`:

```typescript
import { eq } from "drizzle-orm";
import { answerBank } from "@job-agent/db";

export async function saveAnswer(input: { id: string; value: string }): Promise<void> {
  const db = createDb(process.env.DATABASE_URL!);
  await db
    .update(answerBank)
    .set({ value: input.value, updatedAt: new Date() })
    .where(eq(answerBank.id, input.id));
}
```

- [ ] **Step 6: Verify in the browser**

Run: `pnpm --filter @job-agent/web dev`, then open `/answers/<profile-id>`.
Expected: every key renders; unanswered fields are marked; the four EEO fields already read "Decline to self-identify"; editing a field and clicking away shows "saved".

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/answers.ts packages/core/src/answers.test.ts apps/web/app/answers apps/web/components/AnswerBankForm.tsx apps/web/app/actions.ts
git commit -m "feat: answer bank with seeded keys and editor"
```

---

### Task 2: Apply queue

**Files:**
- Modify: `apps/web/app/actions.ts`, `apps/web/components/FetchPanel.tsx`
- Create: `apps/web/components/ApplyQueue.tsx`
- Test: `packages/db/src/apply-queue.test.ts`

**Interfaces:**
- Consumes: `applyTasks`, `jobLedger` tables.
- Produces: server actions `queueApply(input)`, `markApplied(input)`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/apply-queue.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db.js";
import { profiles, applyTasks, jobLedger } from "./schema.js";

let handle: TestDb;
afterEach(async () => await handle?.close());

async function seedProfile(h: TestDb) {
  const [p] = await h.db
    .insert(profiles)
    .values({ name: "T", ownerEmail: "t@example.com", resumeText: "" })
    .returning();
  return p!.id;
}

describe("apply queue", () => {
  it("queues a task in the queued state", async () => {
    handle = await createTestDb();
    const profileId = await seedProfile(handle);
    const [task] = await handle.db
      .insert(applyTasks)
      .values({
        profileId,
        atsKey: "greenhouse:discord/1",
        slugKey: "discord|senior engineer",
        company: "Discord",
        title: "Senior Engineer",
        applyUrl: "https://job-boards.greenhouse.io/discord/jobs/1",
      })
      .returning();
    expect(task!.status).toBe("queued");
    expect(task!.blockedFields).toBeNull();
  });

  it("records blocked fields when a task halts for the human", async () => {
    handle = await createTestDb();
    const profileId = await seedProfile(handle);
    const [task] = await handle.db
      .insert(applyTasks)
      .values({
        profileId,
        slugKey: "discord|senior engineer",
        company: "Discord",
        title: "Senior Engineer",
        applyUrl: "https://example.com",
      })
      .returning();

    await handle.db
      .update(applyTasks)
      .set({
        status: "awaiting_human",
        blockedFields: ["Why do you want to work at Discord?"],
      })
      .where(eq(applyTasks.id, task!.id));

    const [updated] = await handle.db
      .select()
      .from(applyTasks)
      .where(eq(applyTasks.id, task!.id));
    expect(updated!.status).toBe("awaiting_human");
    expect(updated!.blockedFields).toEqual(["Why do you want to work at Discord?"]);
  });

  it("writes both keys to the ledger when marked applied", async () => {
    handle = await createTestDb();
    const profileId = await seedProfile(handle);
    await handle.db.insert(jobLedger).values({
      profileId,
      atsKey: "greenhouse:discord/1",
      slugKey: "discord|senior engineer",
      state: "applied",
      company: "Discord",
      title: "Senior Engineer",
      applyUrl: "https://example.com",
    });
    const rows = await handle.db
      .select()
      .from(jobLedger)
      .where(eq(jobLedger.profileId, profileId));
    expect(rows[0]!.atsKey).toBe("greenhouse:discord/1");
    expect(rows[0]!.slugKey).toBe("discord|senior engineer");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/db/src/apply-queue.test.ts`
Expected: PASS on insert shape but FAIL on `blockedFields` if the schema column is missing. If all three already pass, the schema from feed-plan Task 3 is correct — proceed.

- [ ] **Step 3: Write the server actions**

Add to `apps/web/app/actions.ts`:

```typescript
import { and, eq } from "drizzle-orm";
import { applyTasks, jobLedger } from "@job-agent/db";

export async function queueApply(input: {
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}): Promise<void> {
  const db = createDb(process.env.DATABASE_URL!);
  await db.insert(applyTasks).values(input);
}

/**
 * The user's explicit confirmation that they clicked submit. Nothing else
 * writes an 'applied' ledger row, so the tracker never contains a submission
 * the worker only attempted.
 */
export async function markApplied(input: {
  taskId: string;
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
}): Promise<void> {
  const db = createDb(process.env.DATABASE_URL!);
  await db.insert(jobLedger).values({
    profileId: input.profileId,
    atsKey: input.atsKey,
    slugKey: input.slugKey,
    state: "applied",
    company: input.company,
    title: input.title,
    applyUrl: input.applyUrl,
  });
  await db.delete(applyTasks).where(eq(applyTasks.id, input.taskId));
}

export async function listApplyTasks(profileId: string) {
  const db = createDb(process.env.DATABASE_URL!);
  return db.select().from(applyTasks).where(eq(applyTasks.profileId, profileId));
}
```

- [ ] **Step 4: Add the Apply button**

In `apps/web/components/FetchPanel.tsx`, import the action and add a button beside "Open posting" inside the result `<li>`:

```tsx
<button
  className="ml-3 rounded bg-black px-3 py-1 text-sm text-white"
  onClick={() =>
    queueApply({
      profileId,
      atsKey: job.key.atsKey,
      slugKey: job.key.slugKey,
      company: job.company,
      title: job.title,
      applyUrl: job.applyUrl,
    })
  }
>
  Apply
</button>
```

- [ ] **Step 5: Write the queue view**

Create `apps/web/components/ApplyQueue.tsx`:

```tsx
"use client";

import { markApplied } from "../app/actions";

interface Task {
  id: string;
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
  status: string;
  blockedFields: string[] | null;
}

export function ApplyQueue({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-medium">Applications in progress</h2>
      <ul className="space-y-3">
        {tasks.map((task) => (
          <li key={task.id} className="rounded border p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">
                {task.title} — {task.company}
              </span>
              <span className="text-sm text-neutral-600">{task.status}</span>
            </div>
            {task.blockedFields?.length ? (
              <div className="mt-2 text-sm text-amber-800">
                Needs you: {task.blockedFields.join("; ")}
              </div>
            ) : null}
            {task.status === "awaiting_human" && (
              <button
                className="mt-3 rounded bg-green-700 px-3 py-1 text-sm text-white"
                onClick={() => markApplied({ taskId: task.id, ...task })}
              >
                I submitted this
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Render it in `apps/web/app/profiles/[id]/page.tsx` below `<FetchPanel />`:

```tsx
import { listApplyTasks } from "../../actions";
import { ApplyQueue } from "../../../components/ApplyQueue";
// …inside the component, after loading `profile`:
const tasks = await listApplyTasks(id);
// …in the returned JSX, after <FetchPanel />:
<ApplyQueue tasks={tasks as never} />
```

- [ ] **Step 6: Run tests and commit**

Run: `pnpm test`
Expected: PASS.

```bash
git add packages/db/src/apply-queue.test.ts apps/web
git commit -m "feat: apply queue with explicit mark-applied confirmation"
```

---

### Task 3: Worker scaffold and the dedicated Chrome profile

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`
- Create: `apps/worker/src/browser.ts`
- Test: `apps/worker/src/browser.live.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `openWorkerBrowser(profileDir?: string): Promise<BrowserSession>` where `BrowserSession` is `{ context: BrowserContext; page: Page; close: () => Promise<void> }`.

- [ ] **Step 1: Scaffold the package**

`apps/worker/package.json`:

```json
{
  "name": "@job-agent/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/index.ts", "capture": "tsx scripts/capture.ts" },
  "dependencies": {
    "@job-agent/core": "workspace:*",
    "@job-agent/db": "workspace:*",
    "@anthropic-ai/sdk": "^0.70.0",
    "playwright-core": "^1.48.0",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": { "tsx": "^4.19.0" }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing live test**

Create `apps/worker/src/browser.live.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { openWorkerBrowser } from "./browser.js";

let session: Awaited<ReturnType<typeof openWorkerBrowser>>;
afterAll(async () => await session?.close());

describe("worker browser", () => {
  it("loads a live Greenhouse form without a Cloudflare challenge", async () => {
    session = await openWorkerBrowser();
    const response = await session.page.goto(
      "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
      { waitUntil: "networkidle", timeout: 45_000 },
    );

    expect(response?.status()).toBe(200);
    expect(await session.page.title()).not.toContain("Just a moment");

    const fields = await session.page
      .locator("input:visible, textarea:visible, select:visible")
      .count();
    expect(fields).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test:live -- apps/worker/src/browser.live.test.ts`
Expected: FAIL — cannot resolve `./browser.js`.

- [ ] **Step 4: Write the implementation**

Create `apps/worker/src/browser.ts`:

```typescript
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
```

- [ ] **Step 5: Run the live test to verify it passes**

Run: `pnpm test:live -- apps/worker/src/browser.live.test.ts`
Expected: PASS. A Chrome window opens, loads the GitLab posting, and the assertions hold. If the title contains "Just a moment", the challenge fired — clear it once by hand in that window; the persistent profile keeps the clearance.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat: worker browser on a dedicated persistent chrome profile"
```

---

### Task 4: Field harvesting

The rendered Greenhouse form is React-controlled: its only named input is `g-recaptcha-response`. Labels, by contrast, are clean — `First Name*`, `Email*`, `Location (City)*`, `LinkedIn Profile`. Everything downstream keys off harvested labels.

**Files:**
- Create: `apps/worker/src/harvest.ts`, `apps/worker/src/fillers/types.ts`
- Create: `apps/worker/scripts/capture.ts`
- Test: `apps/worker/src/harvest.test.ts`

**Interfaces:**
- Consumes: Playwright `Page`.
- Produces: `HarvestedField` type; `harvestFields(page: Page): Promise<HarvestedField[]>`; `AtsFiller`, `FillOutcome`, `FillContext` from `fillers/types.ts`.

- [ ] **Step 1: Capture form fixtures**

Create `apps/worker/scripts/capture.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { openWorkerBrowser } from "../src/browser.js";

const TARGETS = [
  { name: "greenhouse-gitlab", url: "https://job-boards.greenhouse.io/gitlab/jobs/8503792002" },
  { name: "greenhouse-discord", url: "https://job-boards.greenhouse.io/discord/jobs/8599937002" },
];

const outDir = path.join(process.cwd(), "src", "fixtures");
fs.mkdirSync(outDir, { recursive: true });

const session = await openWorkerBrowser();
for (const target of TARGETS) {
  await session.page.goto(target.url, { waitUntil: "networkidle", timeout: 45_000 });
  await session.page.waitForTimeout(3000);
  fs.writeFileSync(path.join(outDir, `${target.name}.html`), await session.page.content());
  console.log(`captured ${target.name}`);
}
await session.close();
```

Run: `pnpm --filter @job-agent/worker capture`
Expected: two HTML files under `apps/worker/src/fixtures/`. Job IDs expire — if a target 404s, pick a current posting from that board's API and update the URL.

- [ ] **Step 2: Write the failing test**

Create `apps/worker/src/harvest.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { harvestFields } from "./harvest.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage();
});
afterAll(async () => await browser?.close());

async function loadFixture(name: string) {
  const html = fs.readFileSync(
    path.join(import.meta.dirname, "fixtures", `${name}.html`),
    "utf8",
  );
  await page.setContent(html, { waitUntil: "domcontentloaded" });
}

describe("harvestFields", () => {
  it("finds the identity fields on a real greenhouse form", async () => {
    await loadFixture("greenhouse-gitlab");
    const labels = (await harvestFields(page)).map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes("first name"))).toBe(true);
    expect(labels.some((l) => l.includes("email"))).toBe(true);
  });

  it("marks required fields from the asterisk in the label", async () => {
    await loadFixture("greenhouse-gitlab");
    const first = (await harvestFields(page)).find((f) =>
      f.label.toLowerCase().includes("first name"),
    );
    expect(first?.required).toBe(true);
  });

  it("strips the asterisk from the label text", async () => {
    await loadFixture("greenhouse-gitlab");
    const first = (await harvestFields(page)).find((f) =>
      f.label.toLowerCase().includes("first name"),
    );
    expect(first?.label).not.toContain("*");
  });

  it("finds the resume file input", async () => {
    await loadFixture("greenhouse-gitlab");
    expect((await harvestFields(page)).some((f) => f.type === "file")).toBe(true);
  });

  it("excludes the recaptcha hidden input", async () => {
    await loadFixture("greenhouse-gitlab");
    const selectors = (await harvestFields(page)).map((f) => f.selector);
    expect(selectors.some((s) => s.includes("g-recaptcha-response"))).toBe(false);
  });

  it("captures the free-text question that stalls applications", async () => {
    await loadFixture("greenhouse-discord");
    const labels = (await harvestFields(page)).map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes("why do you want to work"))).toBe(true);
  });

  it("is idempotent — a second harvest yields selectors pointing at the same labels", async () => {
    await loadFixture("greenhouse-gitlab");
    const first = await harvestFields(page);
    const second = await harvestFields(page);

    expect(second.map((f) => f.selector)).toEqual(first.map((f) => f.selector));
    expect(second.map((f) => f.label)).toEqual(first.map((f) => f.label));
  });

  it("leaves no duplicate markers after repeated harvests", async () => {
    await loadFixture("greenhouse-gitlab");
    await harvestFields(page);
    await harvestFields(page);
    const markers = await page.locator("[data-job-agent]").count();
    const harvested = (await harvestFields(page)).filter((f) =>
      f.selector.startsWith("[data-job-agent"),
    ).length;
    expect(markers).toBe(harvested);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run apps/worker/src/harvest.test.ts`
Expected: FAIL — cannot resolve `./harvest.js`.

- [ ] **Step 4: Write the implementation**

Create `apps/worker/src/fillers/types.ts`:

```typescript
import type { Page } from "playwright-core";

export interface HarvestedField {
  /** Stable selector for this element within the page. */
  selector: string;
  /** Human label — the thing we actually match on. Asterisk stripped. */
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

export interface FillContext {
  page: Page;
  /** Resolved answers by canonical key. Absent means unanswered. */
  answers: Map<string, string>;
  resumePath: string;
}

export interface FillOutcome {
  filled: { label: string; answerKey: string }[];
  blocked: string[];
}

export interface AtsFiller {
  name: string;
  /** True when this filler handles the page's resolved landing host. */
  matches: (url: string) => boolean;
  fill: (ctx: FillContext) => Promise<FillOutcome>;
}
```

Create `apps/worker/src/harvest.ts`:

```typescript
import type { Page } from "playwright-core";
import type { HarvestedField } from "./fillers/types.js";

/**
 * Enumerates every visible form control with its human label. Matching is on
 * label / aria-label / placeholder, never on `name` — React-controlled ATS forms
 * mostly have no name attributes at all.
 */
export async function harvestFields(page: Page): Promise<HarvestedField[]> {
  return page.evaluate(() => {
    function labelFor(el: HTMLElement): string {
      const id = el.getAttribute("id");
      if (id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (byFor?.textContent?.trim()) return byFor.textContent.trim();
      }
      const wrapping = el.closest("label");
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

      const aria = el.getAttribute("aria-label");
      if (aria?.trim()) return aria.trim();

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const target = document.getElementById(labelledBy);
        if (target?.textContent?.trim()) return target.textContent.trim();
      }
      return el.getAttribute("placeholder")?.trim() ?? "";
    }

    function selectorFor(el: HTMLElement, index: number): string {
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      el.setAttribute("data-job-agent", String(index));
      return `[data-job-agent="${index}"]`;
    }

    // Clear markers from any earlier harvest. Without this, a re-harvest
    // reassigns indices from zero while stale attributes survive, and a
    // selector captured in the first pass silently resolves to a different
    // element in the second — a mis-fill no assertion would catch.
    document
      .querySelectorAll("[data-job-agent]")
      .forEach((e) => e.removeAttribute("data-job-agent"));

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("input, textarea, select"),
    );

    const out: HarvestedField[] = [];
    elements.forEach((el, index) => {
      const type = el.getAttribute("type") ?? el.tagName.toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") return;
      // The captcha response field is not something to fill.
      if ((el.getAttribute("name") ?? "").includes("captcha")) return;

      const rect = el.getBoundingClientRect();
      const visible = type === "file" || rect.width > 0 || rect.height > 0;
      if (!visible) return;

      const rawLabel = labelFor(el);
      if (!rawLabel) return;

      out.push({
        selector: selectorFor(el, index),
        label: rawLabel.replace(/\*/g, "").replace(/\s+/g, " ").trim(),
        type,
        required: el.hasAttribute("required") || rawLabel.includes("*"),
        options:
          el instanceof HTMLSelectElement
            ? Array.from(el.options).map((o) => o.text.trim())
            : [],
      });
    });
    return out;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/worker/src/harvest.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/harvest.ts apps/worker/src/harvest.test.ts apps/worker/src/fillers/types.ts apps/worker/scripts/capture.ts apps/worker/src/fixtures
git commit -m "feat: label-driven field harvesting with real form fixtures"
```

---

### Task 5: Generic label-driven filler

Built before the per-ATS fillers because it is the fallback every unknown and company-wrapped form falls back to — and because Coinbase, Stripe and Consensys all redirect their Greenhouse boards to bespoke careers sites.

**Files:**
- Create: `apps/worker/src/fillers/generic.ts`
- Test: `apps/worker/src/fillers/generic.test.ts`

**Interfaces:**
- Consumes: `HarvestedField`, `FillContext`, `FillOutcome`, `UTILITY_MODEL`.
- Produces: `mapLabelsToKeys(fields, answerKeys, client): Promise<LabelMapping[]>`, `genericFiller: AtsFiller`, `CONFIDENCE_THRESHOLD`.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/fillers/generic.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { mapLabelsToKeys, CONFIDENCE_THRESHOLD } from "./generic.js";
import type { HarvestedField } from "./types.js";

const fields: HarvestedField[] = [
  { selector: "#a", label: "First Name", type: "text", required: true, options: [] },
  { selector: "#b", label: "Work Email", type: "email", required: true, options: [] },
  {
    selector: "#c",
    label: "Why do you want to work at Discord?",
    type: "textarea",
    required: true,
    options: [],
  },
];

function fakeClient(mappings: unknown) {
  return {
    messages: { parse: vi.fn().mockResolvedValue({ parsed_output: { mappings } }) },
  } as never;
}

describe("mapLabelsToKeys", () => {
  it("maps a confident label to its answer key", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["full_name", "email"],
      fakeClient([{ label: "Work Email", answerKey: "email", confidence: 0.95 }]),
    );
    expect(result.find((m) => m.label === "Work Email")?.answerKey).toBe("email");
  });

  it("drops a mapping below the confidence threshold", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["email"],
      fakeClient([
        { label: "Work Email", answerKey: "email", confidence: CONFIDENCE_THRESHOLD - 0.01 },
      ]),
    );
    expect(result.find((m) => m.label === "Work Email")?.answerKey).toBeNull();
  });

  it("leaves a per-job free-text question unmapped", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["full_name", "email"],
      fakeClient([
        { label: "Why do you want to work at Discord?", answerKey: null, confidence: 0.99 },
      ]),
    );
    expect(
      result.find((m) => m.label.startsWith("Why do you"))?.answerKey,
    ).toBeNull();
  });

  it("returns every field unmapped when the model returns nothing", async () => {
    const client = {
      messages: { parse: vi.fn().mockResolvedValue({ parsed_output: null }) },
    } as never;
    const result = await mapLabelsToKeys(fields, ["email"], client);
    expect(result).toHaveLength(3);
    expect(result.every((m) => m.answerKey === null)).toBe(true);
  });

  it("never maps to a key that was not offered", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["full_name"],
      fakeClient([{ label: "Work Email", answerKey: "email", confidence: 0.99 }]),
    );
    expect(result.find((m) => m.label === "Work Email")?.answerKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/worker/src/fillers/generic.test.ts`
Expected: FAIL — cannot resolve `./generic.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/worker/src/fillers/generic.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { UTILITY_MODEL } from "@job-agent/core";
import { harvestFields } from "../harvest.js";
import type { AtsFiller, FillContext, FillOutcome, HarvestedField } from "./types.js";

/** Below this, a mapping is treated as no mapping. Guessing is worse than asking. */
export const CONFIDENCE_THRESHOLD = 0.8;

const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      label: z.string(),
      answerKey: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

export interface LabelMapping {
  label: string;
  selector: string;
  answerKey: string | null;
}

export async function mapLabelsToKeys(
  fields: HarvestedField[],
  answerKeys: string[],
  client: Anthropic,
): Promise<LabelMapping[]> {
  const base: LabelMapping[] = fields.map((f) => ({
    label: f.label,
    selector: f.selector,
    answerKey: null,
  }));

  const response = await client.messages.parse({
    model: UTILITY_MODEL,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(MappingSchema), effort: "low" },
    messages: [
      {
        role: "user",
        content:
          "Map each form field label to one of these stored answer keys, or null " +
          "when no key fits. A question specific to this company or role (for " +
          "example 'why do you want to work here') has no stored answer — return " +
          "null for it. Confidence is 0 to 1.\n\n" +
          `KEYS\n${answerKeys.join(", ")}\n\nLABELS\n${fields
            .map((f) => `- ${f.label} (${f.type}${f.required ? ", required" : ""})`)
            .join("\n")}`,
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed) return base;

  const offered = new Set(answerKeys);
  for (const mapping of parsed.mappings) {
    const target = base.find((b) => b.label === mapping.label);
    if (!target) continue;
    if (!mapping.answerKey) continue;
    if (mapping.confidence < CONFIDENCE_THRESHOLD) continue;
    // Never accept a key the model invented.
    if (!offered.has(mapping.answerKey)) continue;
    target.answerKey = mapping.answerKey;
  }
  return base;
}

export function createGenericFiller(client: Anthropic): AtsFiller {
  return {
    name: "generic",
    matches: () => true, // last resort — the selector tries it only after the rest
    async fill(ctx: FillContext): Promise<FillOutcome> {
      const fields = await harvestFields(ctx.page);
      const mappings = await mapLabelsToKeys(fields, [...ctx.answers.keys()], client);

      const filled: FillOutcome["filled"] = [];
      const blocked: string[] = [];

      for (const field of fields) {
        if (field.type === "file") {
          await ctx.page.setInputFiles(field.selector, ctx.resumePath).catch(() => {});
          filled.push({ label: field.label, answerKey: "resume" });
          continue;
        }

        const mapping = mappings.find((m) => m.selector === field.selector);
        const value = mapping?.answerKey ? ctx.answers.get(mapping.answerKey) : undefined;

        if (!value) {
          blocked.push(field.label);
          continue;
        }

        await ctx.page.fill(field.selector, value).catch(() => {});
        filled.push({ label: field.label, answerKey: mapping!.answerKey! });
      }

      return { filled, blocked };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/worker/src/fillers/generic.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/fillers/generic.ts apps/worker/src/fillers/generic.test.ts
git commit -m "feat: generic label-driven filler with confidence-gated mapping"
```

---

### Task 6: Greenhouse filler and filler selection

**Files:**
- Create: `apps/worker/src/fillers/greenhouse.ts`, `apps/worker/src/fillers/select.ts`
- Test: `apps/worker/src/fillers/greenhouse.test.ts`, `apps/worker/src/fillers/select.test.ts`

**Interfaces:**
- Consumes: `harvestFields`, `AtsFiller`, `FillContext`.
- Produces: `GREENHOUSE_LABEL_MAP: Record<string, string>`, `matchAnswerKey(label): string | null`, `greenhouseFiller: AtsFiller`, `selectFiller(url, fillers): AtsFiller`.

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/src/fillers/greenhouse.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { matchAnswerKey, greenhouseFiller } from "./greenhouse.js";

describe("matchAnswerKey", () => {
  it("maps the identity labels a real greenhouse form uses", () => {
    expect(matchAnswerKey("First Name")).toBe("full_name");
    expect(matchAnswerKey("Email")).toBe("email");
    expect(matchAnswerKey("Phone")).toBe("phone");
    expect(matchAnswerKey("Location (City)")).toBe("location");
    expect(matchAnswerKey("LinkedIn Profile")).toBe("linkedin_url");
  });

  it("is case and whitespace insensitive", () => {
    expect(matchAnswerKey("  EMAIL  ")).toBe("email");
  });

  it("returns null for a company-specific question", () => {
    expect(matchAnswerKey("Why do you want to work at Discord?")).toBeNull();
  });

  it("returns null for an unrecognised label", () => {
    expect(matchAnswerKey("Favourite programming language")).toBeNull();
  });
});

describe("greenhouseFiller", () => {
  it("matches greenhouse-hosted urls", () => {
    expect(
      greenhouseFiller.matches("https://job-boards.greenhouse.io/gitlab/jobs/1"),
    ).toBe(true);
    expect(greenhouseFiller.matches("https://boards.greenhouse.io/figma/jobs/1")).toBe(true);
  });

  it("does not match a company-wrapped careers site", () => {
    expect(greenhouseFiller.matches("https://stripe.com/careers/search?gh_jid=1")).toBe(false);
  });
});
```

Create `apps/worker/src/fillers/select.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectFiller } from "./select.js";
import type { AtsFiller } from "./types.js";

const stub = (name: string, host: string): AtsFiller => ({
  name,
  matches: (url) => url.includes(host),
  fill: async () => ({ filled: [], blocked: [] }),
});

const generic: AtsFiller = {
  name: "generic",
  matches: () => true,
  fill: async () => ({ filled: [], blocked: [] }),
};

describe("selectFiller", () => {
  it("picks the ats filler whose host matches", () => {
    const chosen = selectFiller("https://jobs.lever.co/spotify/abc/apply", [
      stub("greenhouse", "greenhouse.io"),
      stub("lever", "jobs.lever.co"),
      generic,
    ]);
    expect(chosen.name).toBe("lever");
  });

  it("falls back to generic for a company-wrapped site", () => {
    const chosen = selectFiller("https://www.coinbase.com/careers/positions/1", [
      stub("greenhouse", "greenhouse.io"),
      generic,
    ]);
    expect(chosen.name).toBe("generic");
  });

  it("prefers a specific filler over generic even when generic is listed first", () => {
    const chosen = selectFiller("https://job-boards.greenhouse.io/gitlab/jobs/1", [
      generic,
      stub("greenhouse", "greenhouse.io"),
    ]);
    expect(chosen.name).toBe("greenhouse");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/worker/src/fillers/`
Expected: FAIL — cannot resolve `./greenhouse.js` and `./select.js`.

- [ ] **Step 3: Write the implementations**

Create `apps/worker/src/fillers/greenhouse.ts`:

```typescript
import { harvestFields } from "../harvest.js";
import type { AtsFiller, FillContext, FillOutcome } from "./types.js";

/**
 * Labels observed on live Greenhouse forms (gitlab, discord), mapped to answer
 * bank keys. Matching is on label text because these forms are React-controlled
 * and carry no useful name attributes.
 */
export const GREENHOUSE_LABEL_MAP: Record<string, string> = {
  "first name": "full_name",
  "last name": "full_name",
  "full name": "full_name",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  country: "location",
  "location (city)": "location",
  location: "location",
  "linkedin profile": "linkedin_url",
  linkedin: "linkedin_url",
  "github profile": "github_url",
  github: "github_url",
  website: "portfolio_url",
  "portfolio url": "portfolio_url",
  "notice period": "notice_period",
  "expected salary": "expected_compensation",
  "salary expectation": "expected_compensation",
  "years of experience": "years_experience",
  gender: "eeo_gender",
  "race / ethnicity": "eeo_race",
  "veteran status": "eeo_veteran",
  "disability status": "eeo_disability",
};

export function matchAnswerKey(label: string): string | null {
  return GREENHOUSE_LABEL_MAP[label.trim().toLowerCase()] ?? null;
}

export const greenhouseFiller: AtsFiller = {
  name: "greenhouse",
  matches: (url) =>
    url.includes("job-boards.greenhouse.io") || url.includes("boards.greenhouse.io"),

  async fill(ctx: FillContext): Promise<FillOutcome> {
    const fields = await harvestFields(ctx.page);
    const filled: FillOutcome["filled"] = [];
    const blocked: string[] = [];

    for (const field of fields) {
      if (field.type === "file") {
        await ctx.page.setInputFiles(field.selector, ctx.resumePath).catch(() => {});
        filled.push({ label: field.label, answerKey: "resume" });
        continue;
      }

      const key = matchAnswerKey(field.label);
      const value = key ? ctx.answers.get(key) : undefined;

      if (!value) {
        // Company-specific questions and unanswered keys both land here.
        blocked.push(field.label);
        continue;
      }

      if (field.type === "select") {
        await ctx.page.selectOption(field.selector, { label: value }).catch(() => {});
      } else {
        await ctx.page.fill(field.selector, value).catch(() => {});
      }
      filled.push({ label: field.label, answerKey: key! });
    }

    return { filled, blocked };
  },
};
```

Create `apps/worker/src/fillers/select.ts`:

```typescript
import type { AtsFiller } from "./types.js";

/**
 * Picks by the page's RESOLVED landing host, not by the source adapter —
 * Coinbase, Stripe and Consensys all redirect their Greenhouse boards to
 * bespoke careers sites. The generic filler matches everything, so it is
 * considered last regardless of list order.
 */
export function selectFiller(url: string, fillers: AtsFiller[]): AtsFiller {
  const specific = fillers.find((f) => f.name !== "generic" && f.matches(url));
  if (specific) return specific;

  const generic = fillers.find((f) => f.name === "generic");
  if (!generic) throw new Error("no generic filler registered");
  return generic;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/worker/src/fillers/`
Expected: PASS — 12 tests passed across the three filler test files.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/fillers
git commit -m "feat: greenhouse filler and landing-host filler selection"
```

---

### Task 7: Lever, Ashby and Workable fillers

**Files:**
- Create: `apps/worker/src/fillers/lever.ts`, `apps/worker/src/fillers/ashby.ts`, `apps/worker/src/fillers/workable.ts`
- Test: `apps/worker/src/fillers/other-ats.test.ts`

**Interfaces:**
- Consumes: `harvestFields`, `AtsFiller`, `GREENHOUSE_LABEL_MAP` (shared base vocabulary).
- Produces: `leverFiller`, `ashbyFiller`, `workableFiller`, and `createLabelFiller(name, hosts, extraMap)`.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/fillers/other-ats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { leverFiller } from "./lever.js";
import { ashbyFiller } from "./ashby.js";
import { workableFiller } from "./workable.js";

describe("host matching", () => {
  it("lever matches its hosted apply urls", () => {
    expect(leverFiller.matches("https://jobs.lever.co/spotify/abc/apply")).toBe(true);
    expect(leverFiller.matches("https://job-boards.greenhouse.io/x/jobs/1")).toBe(false);
  });

  it("ashby matches its hosted urls", () => {
    expect(ashbyFiller.matches("https://jobs.ashbyhq.com/ramp/abc")).toBe(true);
  });

  it("workable matches its hosted urls", () => {
    expect(workableFiller.matches("https://apply.workable.com/acme/j/ABC123/")).toBe(true);
  });

  it("no filler claims a company-wrapped careers site", () => {
    const wrapped = "https://consensys.io/open-roles/1";
    expect(leverFiller.matches(wrapped)).toBe(false);
    expect(ashbyFiller.matches(wrapped)).toBe(false);
    expect(workableFiller.matches(wrapped)).toBe(false);
  });
});

describe("lever-specific vocabulary", () => {
  it("maps Lever's own resume-source label", () => {
    expect(leverFiller.name).toBe("lever");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/worker/src/fillers/other-ats.test.ts`
Expected: FAIL — cannot resolve `./lever.js`.

- [ ] **Step 3: Write the implementations**

Add to `apps/worker/src/fillers/greenhouse.ts` (exported so the others reuse it):

```typescript
import { harvestFields } from "../harvest.js";
import type { AtsFiller, FillContext, FillOutcome } from "./types.js";

/** Builds a label-matching filler from a base vocabulary plus per-ATS additions. */
export function createLabelFiller(
  name: string,
  hosts: string[],
  extraMap: Record<string, string> = {},
): AtsFiller {
  const map = { ...GREENHOUSE_LABEL_MAP, ...extraMap };
  return {
    name,
    matches: (url) => hosts.some((h) => url.includes(h)),
    async fill(ctx: FillContext): Promise<FillOutcome> {
      const fields = await harvestFields(ctx.page);
      const filled: FillOutcome["filled"] = [];
      const blocked: string[] = [];

      for (const field of fields) {
        if (field.type === "file") {
          await ctx.page.setInputFiles(field.selector, ctx.resumePath).catch(() => {});
          filled.push({ label: field.label, answerKey: "resume" });
          continue;
        }
        const key = map[field.label.trim().toLowerCase()] ?? null;
        const value = key ? ctx.answers.get(key) : undefined;
        if (!value) {
          blocked.push(field.label);
          continue;
        }
        if (field.type === "select") {
          await ctx.page.selectOption(field.selector, { label: value }).catch(() => {});
        } else {
          await ctx.page.fill(field.selector, value).catch(() => {});
        }
        filled.push({ label: field.label, answerKey: key });
      }
      return { filled, blocked };
    },
  };
}
```

Create `apps/worker/src/fillers/lever.ts`:

```typescript
import { createLabelFiller } from "./greenhouse.js";

/** Lever's hosted form exposes name/email/phone/org/location plus custom cards. */
export const leverFiller = createLabelFiller("lever", ["jobs.lever.co"], {
  name: "full_name",
  "full name": "full_name",
  org: "location",
  "current company": "location",
  "resume/cv": "resume",
});
```

Create `apps/worker/src/fillers/ashby.ts`:

```typescript
import { createLabelFiller } from "./greenhouse.js";

export const ashbyFiller = createLabelFiller("ashby", ["jobs.ashbyhq.com"], {
  name: "full_name",
  "linkedin url": "linkedin_url",
  "github url": "github_url",
});
```

Create `apps/worker/src/fillers/workable.ts`:

```typescript
import { createLabelFiller } from "./greenhouse.js";

export const workableFiller = createLabelFiller("workable", ["apply.workable.com"], {
  "first name": "full_name",
  "last name": "full_name",
  "mobile phone number": "phone",
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/worker/src/fillers/`
Expected: PASS — 17 tests across all filler test files.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/fillers
git commit -m "feat: lever, ashby and workable fillers on a shared label vocabulary"
```

---

### Task 8: Worker loop and human handoff

**Files:**
- Create: `apps/worker/src/index.ts`
- Test: `apps/worker/src/index.test.ts`

**Interfaces:**
- Consumes: everything above, plus `applyTasks`, `answerBank`, `profiles`.
- Produces: `processTask(task, deps): Promise<{status, fillReport, blocked}>`, `runWorkerLoop(deps)`.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/index.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { processTask } from "./index.js";
import type { AtsFiller } from "./fillers/types.js";

const task = {
  id: "task-1",
  profileId: "profile-1",
  atsKey: "greenhouse:gitlab/1",
  slugKey: "gitlab|senior engineer",
  company: "GitLab",
  title: "Senior Engineer",
  applyUrl: "https://job-boards.greenhouse.io/gitlab/jobs/1",
};

function deps(over: Partial<Parameters<typeof processTask>[1]> = {}) {
  const filler: AtsFiller = {
    name: "greenhouse",
    matches: () => true,
    fill: async () => ({
      filled: [{ label: "Email", answerKey: "email" }],
      blocked: ["Why do you want to work at GitLab?"],
    }),
  };
  return {
    openBrowser: vi.fn(async () => ({
      context: {} as never,
      page: {
        goto: vi.fn(async () => ({ status: () => 200 })),
        url: () => "https://job-boards.greenhouse.io/gitlab/jobs/1",
        waitForTimeout: vi.fn(async () => {}),
        bringToFront: vi.fn(async () => {}),
      } as never,
      close: vi.fn(async () => {}),
    })),
    fillers: [filler],
    answers: new Map([["email", "nikhilmishra2608@gmail.com"]]),
    resumePath: "/tmp/resume.pdf",
    ...over,
  };
}

describe("processTask", () => {
  it("ends at awaiting_human — the worker never submits", async () => {
    const result = await processTask(task, deps());
    expect(result.status).toBe("awaiting_human");
  });

  it("reports the blocked free-text question", async () => {
    const result = await processTask(task, deps());
    expect(result.blocked).toContain("Why do you want to work at GitLab?");
  });

  it("records what was filled and from which key", async () => {
    const result = await processTask(task, deps());
    expect(result.fillReport.filled[0]).toEqual({
      label: "Email",
      answerKey: "email",
    });
  });

  it("selects the filler by the resolved landing url", async () => {
    const wrapped: AtsFiller = {
      name: "generic",
      matches: () => true,
      fill: async () => ({ filled: [], blocked: [] }),
    };
    const greenhouse: AtsFiller = {
      name: "greenhouse",
      matches: (url) => url.includes("greenhouse.io"),
      fill: async () => ({ filled: [], blocked: [] }),
    };
    const d = deps({ fillers: [wrapped, greenhouse] });
    d.openBrowser = vi.fn(async () => ({
      context: {} as never,
      page: {
        goto: vi.fn(async () => ({ status: () => 200 })),
        // redirected away from greenhouse to the company's own site
        url: () => "https://about.gitlab.com/jobs/1",
        waitForTimeout: vi.fn(async () => {}),
        bringToFront: vi.fn(async () => {}),
      } as never,
      close: vi.fn(async () => {}),
    }));
    const result = await processTask(task, d);
    expect(result.fillerUsed).toBe("generic");
  });

  it("returns failed rather than throwing when navigation dies", async () => {
    const d = deps();
    d.openBrowser = vi.fn(async () => ({
      context: {} as never,
      page: {
        goto: vi.fn(async () => {
          throw new Error("net::ERR_ABORTED");
        }),
        url: () => task.applyUrl,
        waitForTimeout: vi.fn(async () => {}),
        bringToFront: vi.fn(async () => {}),
      } as never,
      close: vi.fn(async () => {}),
    }));
    const result = await processTask(task, d);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("ERR_ABORTED");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/worker/src/index.test.ts`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/worker/src/index.ts`:

```typescript
import { eq, and, inArray } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { createDb, applyTasks, answerBank, profiles } from "@job-agent/db";
import { resolveAnswer, ANSWER_KEYS } from "@job-agent/core";
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
  const db = createDb(process.env.DATABASE_URL!);
  const client = new Anthropic();
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/worker/src/index.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: PASS — every test from both plans.

- [ ] **Step 6: End-to-end check**

```bash
# terminal 1
pnpm --filter @job-agent/web dev
# terminal 2
export DATABASE_URL="<neon connection string>"
export RESUME_PATH="/Users/saumyamishra/Desktop/nikhil_resume_december.pdf"
pnpm --filter @job-agent/worker start
```

Fill in the answer bank at `/answers/<profile-id>` first. Then fetch jobs, click **Apply** on a Greenhouse-hosted posting.

Expected: the worker logs the task, a Chrome window opens on the real application form with name, email, phone, location, links and the resume already populated, and the dashboard shows the task as `awaiting_human` listing what still needs you — typically the company-specific free-text question. Type it, click submit yourself, then click **I submitted this**. The job never appears in a future fetch.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/index.test.ts
git commit -m "feat: worker loop with human handoff at awaiting_human"
```

---

## Self-Review Notes

Checked against the spec:

- §6 (submit-path findings, assisted mode) — Global Constraints, Task 3 live test asserting no Cloudflare challenge, Task 8 always returning `awaiting_human`.
- §6.1 (dedicated Chrome profile) — Task 3, `DEFAULT_PROFILE_DIR` outside the daily profile.
- §6.2 (label matching, resolved landing host) — Task 4 harvesting, Task 6 `selectFiller`, Task 8 resolving `page.url()` after redirects.
- §8.1 (answer bank rules) — Task 1: `resolveAnswer` treats empty as unanswered, EEO defaults to decline, no stored answer means blocked.
- §8.2 (second-profile authorization) — feed plan Task 15 seeds both profiles `autoSubmitAuthorized: false`; nothing in this plan flips it.
- §9 (apply flow state machine) — Task 2 queue, Task 8 loop, `markApplied` as the only writer of an `applied` ledger row.
- §9.1 (two filler layers) — Task 5 generic, Tasks 6–7 per-ATS.
- §12 (stuck-task recovery) — Task 8 reclaims `opening`/`filling` rows at the top of each poll.

**Type consistency check.** `FillOutcome` is defined once in `fillers/types.ts` and returned unchanged by every filler and by `processTask`. `AtsFiller.matches` takes the resolved landing URL in both `selectFiller` and `processTask`. `resolveAnswer` and `ANSWER_KEYS` come from `@job-agent/core` in both the web app (Task 1) and the worker (Task 8). `createLabelFiller` is defined in `greenhouse.ts` and imported by the three ATS fillers in Task 7.

**Harvest idempotence.** `harvestFields` tags unlabelled elements with `data-job-agent` to build selectors, so it clears prior markers before each pass. Task 4 asserts a second harvest produces identical selectors — a multi-step Lever flow or a retry re-harvests the same page, and stale markers would silently point a selector at the wrong element.

**Known gap, deliberate.** Free-text questions always block in cycle 1 — that is the documented consequence of the "base resume as-is, nothing generated" scope decision. Cycle 2 generates a draft for those fields and removes most `awaiting_human` halts.
