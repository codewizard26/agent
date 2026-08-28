# Job Agent — Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Scope:** Cycle 1 (v1)

## 1. Problem

Finding relevant full-stack roles means checking dozens of boards by hand, re-reading
the same postings, and losing track of what has already been applied to. Applying means
retyping the same twenty answers into every ATS form.

This app does three things: pull job postings from many sources into one warehouse,
rank them against a specific person's resume, and drive the application form to the
point where only the final submit click remains.

## 2. Goals

- Two (extensible to N) resume profiles, each independently ranked and tracked.
- One button per profile — "Find jobs relevant to my resume" — that runs ingest + ranking
  and populates a dashboard.
- Ranked feed with match reasoning, red flags, and per-job state
  (`new`/`starred`/`queued`/`applied`/`dismissed`).
- An apply action that opens the real ATS form in the user's own browser with every
  answerable field already filled, including resume upload.
- Costs that scale with the user's attention rather than with the volume of the internet.

## 3. Non-goals (cycle 1)

- Generating tailored resumes or cover letters. The stored base resume PDF is submitted
  as-is. Free-text questions are not auto-answered — the apply task halts and waits for
  the user to type them.
- Ingesting from LinkedIn, Indeed, Glassdoor, ZipRecruiter, or Naukri. Prohibited by their
  terms, defended by anti-bot systems, and automating them from the user's own logged-in
  account puts that account at risk. They remain manual discovery surfaces.
- Unattended submit. See §5.
- Email follow-up tracking, interview scheduling, recruiter CRM.

## 4. Verified source landscape

All checks below were run against live endpoints on 2026-08-29. The unit of coverage is
**company board tokens**, not websites — a single Greenhouse adapter with 300 tokens is
broader and far more stable than 100 bespoke scrapers.

### Reachable, unauthenticated, JSON

| Adapter | Endpoint | Verified |
|---|---|---|
| `greenhouse` | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | 200 (coinbase, consensys, stripe) |
| `lever` | `GET https://api.lever.co/v0/postings/{token}?mode=json` | 200 (palantir, spotify, matchgroup) |
| `ashby` | `POST https://jobs.ashbyhq.com/api/non-user-graphql` op `ApiJobBoardWithTeams` | 200 |
| `remoteok` | `GET https://remoteok.com/api` | 200 |
| `arbeitnow` | `GET https://www.arbeitnow.com/api/job-board-api` | 200 |
| `hn_whoishiring` | `GET https://hn.algolia.com/api/v1/search` | 200 |

Board tokens 404 when a company is not on that provider (`plaid` on Lever, `uniswaplabs`
on Greenhouse). The 200-vs-404 response is itself a cheap discovery mechanism: take
company names seen in aggregator results, probe each provider, record the hits.

### Board token seeding

`sources/boards.yaml` is checked into the repo and seeds ~200 known company/provider
pairs. A background `discover` run cross-references company names from aggregator
postings against each provider and appends confirmed tokens. Tokens that 404 for three
consecutive runs are marked inactive rather than deleted.

## 5. Submit-path findings — why apply is one click, not zero

Apply forms were fetched and inspected directly:

| Provider | Apply-form gate |
|---|---|
| Greenhouse (`job-boards.greenhouse.io`) | Cloudflare challenge — `cf-mitigated: challenge`, HTTP 403 with `<title>Just a moment...` even with a browser user-agent |
| Lever (`jobs.lever.co/{org}/{id}/apply`) | hCaptcha — page returns 200 and exposes an `h-captcha-response` field required on submit |
| Ashby (`jobs.ashbyhq.com/{org}`) | reCAPTCHA |
| Workable (`apply.workable.com/{org}`) | reCAPTCHA and Turnstile |

Every major ATS gates submission behind a CAPTCHA or an edge challenge. Clearing those
programmatically requires a CAPTCHA-solving service, which is deliberate circumvention and
results in the originating account and IP being blocked. The app will not do this.

The form **fill** side is entirely tractable. Lever's field names enumerate cleanly from
the page: `name`, `email`, `phone`, `location`, `org`, `resume`, `consent[marketing]`,
`cards[{uuid}][field{n}]`, `surveysResponses[{uuid}][...]`. Greenhouse and Ashby expose
comparably structured forms once a real browser session has loaded them.

**Therefore:** the apply worker drives the user's *own* Chrome profile, non-headless, with
its existing cookies — the same session a human uses, which is why a human never sees the
Cloudflare interstitial. It fills every field it has an answer for, uploads the resume,
scrolls to the submit control, and hands the tab over. The user clicks submit and solves a
CAPTCHA tile if one appears.

The schema carries a per-adapter `submitMode: 'auto' | 'assisted'`. In cycle 1 every
adapter is `assisted` and the worker never clicks submit — the field exists so that an
ungated provider discovered later becomes a data change rather than a rewrite. Honouring
`auto` is itself a cycle-2 decision, and would additionally require the profile's
`auto_submit_authorized` to be true.

## 6. Architecture

```
                   ┌─────────────── shared, profile-agnostic ───────────────┐
  sources ──────>  adapters ──> normalize ──> dedup ──> Postgres (jobs)
                   └────────────────────────────────────────────────────────┘
                                                  │
                   ┌────────────── per-profile ───┴─────────────────────────┐
                   │  Tier 1: deterministic SQL filter      ~3000 → ~120    │
                   │  Tier 2: Claude batch rank (Sonnet)    ~120 → scored   │
                   │  Tier 3: Claude deep-dive (Opus), on starred jobs only │
                   └────────────────────────────────────────────────────────┘
                                                  │
                                          dashboard (Vercel)
                                                  │
                                          apply_tasks queue
                                                  │
                                    local worker (Playwright + real Chrome)
```

**One warehouse, N ranked views.** Ingest runs once and serves every profile. Tier 1 and
Tier 2 are scoped to a profile. This must not be implemented as one pipeline per profile.

### 6.1 Ingest

Runs on Vercel Cron twice daily, and on demand when the "Find jobs" button fires against a
warehouse older than 6 hours.

Each adapter implements:

```ts
interface SourceAdapter {
  kind: SourceKind
  fetch(source: SourceRow): Promise<RawPosting[]>
  normalize(raw: RawPosting): NormalizedJob
}
```

Adapters are isolated: one failing provider marks its own `sources.last_error` and the run
continues. A run that reaches at least one successful adapter is a successful run.

`hn_whoishiring` is the one adapter that needs a model. It fetches the current month's
thread via the Algolia API; each top-level comment is a freeform posting. Claude Haiku
parses each comment into `{company, title, location, remote, applyUrl, stack[]}`. Comments
that do not parse as a job posting are dropped.

### 6.2 Dedup

`dedup_key = slug(company) + '|' + slug(title) + '|' + location_bucket`

The same role legitimately appears on RemoteOK, Arbeitnow, and the company's own
Greenhouse board. On collision, keep one row and prefer the ATS-direct `apply_url` as
canonical — the application should land on the company's real form, not an aggregator's
repost. `last_seen_at` updates on every collision so stale postings can be aged out.

### 6.3 Tier 1 — deterministic filter

Pure SQL, no model calls, debuggable in a query console. Rejects on:

- **Geography** — remote-global posture. Reject postings gated to a country the profile
  cannot work from: `US only`, `must reside in`, `must be authorized to work in`,
  `requires security clearance`, on-site-only listings.
- **Timezone** — reject hard overlap requirements incompatible with IST (e.g. `PST core
  hours`, `EST 9-5`). Ranges that overlap IST at all pass through to Tier 2.
- **Seniority band** — reject `intern`, `junior`, `new grad`, `entry level`, `staff`,
  `principal`, `director`, `VP`, `engineering manager`. Target is mid/senior IC.
- **Stack overlap** — require at least 2 matches against the profile's core stack.
  For this resume: TypeScript, JavaScript, React, Next.js, Node.js, Express, GraphQL,
  PostgreSQL, MongoDB, Django, Tailwind.
- **Freshness** — `posted_at` within 21 days.
- **State** — not already `dismissed` or `applied` for this profile.

Implemented with Postgres full-text search and `pg_trgm`. No vector embeddings in v1 —
they add a third-party embedding vendor for recall the keyword filter already achieves.
Revisit only if Tier 1 recall is measurably poor against the golden set (§9).

### 6.4 Tier 2 — Claude rank

Survivors are batched (20 per call) to `claude-sonnet-5` with the profile's parsed resume
and a structured-output tool schema:

```ts
{
  jobId: string
  score: number            // 0-100
  tier: 'strong' | 'stretch' | 'skip'
  why: string              // one sentence, shown on the card
  redFlags: string[]       // e.g. "unpaid trial period", "equity only"
  sponsorshipGate: boolean // JD implies work authorization the profile lacks
  timezoneGate: string | null
  resumeHooks: string[]    // resume points to lead with; feeds cycle-2 tailoring
}
```

`sponsorshipGate` is a **ranking** signal, not just an apply-time field. Under a
remote-global posture, postings that quietly require local work authorization must sink.
The JD language for this is too varied for regex, which is exactly why it belongs here and
not in Tier 1.

### 6.5 Tier 3 — deep dive

Runs only on jobs the user stars. `claude-opus-5` reads the full JD and produces a gap
analysis and interview-prep notes. Bounded to a handful of calls per day.

## 7. Profiles and the answer bank

A profile is a person, not a document.

```
profiles
  id, name, owner_email, resume_blob_url, resume_text,
  parsed_profile jsonb, auto_submit_authorized boolean default false, created_at
```

`parsed_profile` is Claude's structured extraction of the resume: skills, seniority,
years, employers, links. It is computed once at upload and cached; it drives Tier 1's
stack list and Tier 2's prompt.

### 7.1 Answer bank

The answer bank holds responses the profile owner supplied **once**, keyed by a canonical
field name. Auto-fill reads from it. Nothing is ever invented.

```
answer_bank
  id, profile_id, key, label, value, kind ('text'|'select'|'boolean'|'file'), updated_at
```

Seeded keys: `full_name`, `email`, `phone`, `location`, `linkedin_url`, `github_url`,
`portfolio_url`, `work_authorization`, `requires_sponsorship`, `notice_period`,
`expected_compensation`, `years_experience`, `eeo_gender`, `eeo_race`, `eeo_veteran`,
`eeo_disability`.

Two rules:

- **A field with no stored answer halts the task.** The worker sets
  `status = 'awaiting_human'`, records the unfilled field in `blocked_fields`, and surfaces
  it in the UI. It does not guess, and it does not submit a partial form.
- **EEO/demographic fields default to "decline to self-identify."** These are voluntary.
  The owner may set a different value explicitly; the app never picks one for them.

Per-job free-text ("why do you want to work here?") cannot come from the bank. In cycle 1
these always halt for the user to type. Cycle 2 generates a draft for review.

### 7.2 Second profile authorization

The second profile belongs to a different person. Applications submitted under it carry
their name and their answers.

- `auto_submit_authorized` defaults to **false**. A profile with it false stays in assisted
  mode regardless of any future `submitMode: 'auto'` adapter.
- That profile's answer bank must be filled in by its owner, not inferred from their resume.
  Work authorization, compensation, notice period, and EEO values start empty and halt on
  first use.
- Their resume PDF and PII live in the project's Neon database and are not sent anywhere
  else. Model calls send resume text to the Anthropic API for parsing and ranking; nothing
  is sent to any other third party.

## 8. Apply flow

```
user clicks Apply
  → apply_tasks row: status='queued'
  → local worker polls (same Neon DB)
  → status='opening'  : launch Playwright against the user's persistent Chrome profile
  → status='filling'  : detect ATS kind from apply_url, run that filler
  → resume upload from stored blob
  → every mapped field filled from answer_bank
  → unmapped or unanswerable field → blocked_fields
  → status='awaiting_human' : tab handed to user, focused, scrolled to submit
  → user clicks submit (solves CAPTCHA if shown), clicks "Mark applied" in dashboard
  → status='submitted', job_states.applied_at set
```

The worker never clicks submit in cycle 1. Marking applied is an explicit user action, so
the tracker never contains a fabricated submission.

Fillers are per-ATS modules (`greenhouse.ts`, `lever.ts`, `ashby.ts`, `workable.ts`) with a
shared `AtsFiller` interface. An `apply_url` matching no known filler produces a task that
opens the page and reports every field as blocked — still useful, just not filled.

## 8.5 Dashboard and the "Find jobs" action

The dashboard opens on a profile switcher — two cards, one per resume. Selecting a profile
scopes everything below it.

**"Find jobs relevant to my resume"** starts a `run` and streams progress back to the page
so the search is visible rather than a spinner:

```
fetching 6 sources … 3,140 postings … 214 new … filtered to 118 … ranking …
```

The run re-ingests only if the warehouse is older than 6 hours; otherwise it goes straight
to Tier 1 and Tier 2 for that profile, so repeat clicks return in seconds.

```
runs
  id, profile_id nullable, kind ('ingest'|'rank'|'discover'),
  status ('running'|'ok'|'partial'|'failed'), stats jsonb,
  started_at, finished_at, error
```

Results render as ranked cards: score, `why`, red flags, company, title, location, source,
age, and the actions `Apply`, `Star`, `Dismiss`. Filters: tier, source, age, and state.
Job state is stored per profile per job, so the same posting can be `applied` for one
profile and `new` for the other.

## 9. Testing

- **Adapter contract tests** run against recorded JSON fixtures committed to the repo, not
  live endpoints. A separate, manually-run `pnpm test:live` hits real endpoints and is the
  canary for upstream API changes.
- **Dedup** unit tests over hand-built collision cases, including the RemoteOK/Greenhouse
  duplicate.
- **Tier 1** tested as SQL against a seeded fixture set, asserting specific postings are
  rejected for specific reasons.
- **Tier 2** validated against a golden set: ~30 postings labeled by hand as
  strong/stretch/skip. Assert rank correlation, not exact scores. This set is also the
  regression check when the prompt or model changes.
- **Fillers** tested against saved ATS form HTML fixtures. Never against live apply forms —
  a test suite must not create real applications.

## 10. Error handling

- A failing adapter is isolated to its own source row; the run continues.
- Sources track `last_ok_at` and `last_error`; three consecutive failures deactivate the
  source and surface it in the UI.
- Model calls retry twice with backoff; a batch that fails all attempts leaves those jobs
  unscored and eligible for the next run rather than dropping them.
- Ingest is idempotent. Re-running updates `last_seen_at` and inserts nothing duplicate.
- Worker crash mid-fill leaves the task in `filling`; tasks stuck over 10 minutes reset to
  `queued`.

## 11. Stack and runtime split

**pnpm workspaces:**

```
apps/web      Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui  → Vercel
apps/worker   Node + Playwright, local only                           → user's machine
packages/db   Drizzle schema + migrations, shared
packages/core  adapters, normalize, dedup, tier1, tier2 prompts, shared
```

- **Vercel**: web app, Neon Postgres (Marketplace), Vercel Cron for ingest. The Anthropic
  API key is server-side only and never reaches the client.
- **Local**: the worker, connecting to the same Neon database over a pooled connection.
  Browser session cookies never leave the machine.
- Models: `claude-sonnet-5` for Tier 2 ranking, `claude-haiku-4-5-20251001` for HN comment
  parsing and resume extraction, `claude-opus-5` for Tier 3 deep dives.

## 12. Cycle boundaries

**Cycle 1 (this spec):** profiles, answer bank, ingest across the six verified adapters,
dedup, Tier 1 + Tier 2 ranking, dashboard, state tracking, assisted apply worker.

**Cycle 2:** cover letter and free-text answer generation, resolving the `awaiting_human`
halt for text fields.

**Cycle 3:** per-job tailored resume PDF generation, with a review step.

**Cycle 4:** email follow-up tracking and response detection.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Upstream ATS APIs change shape | Adapters isolated; `test:live` canary; contract tests fail loudly |
| Board token list goes stale | Discovery run appends; 3× 404 marks inactive rather than deleting |
| ATS form DOM changes break fillers | Fillers degrade to "opens page, reports blocked fields" rather than misfiling |
| Tier 1 over-filters, hiding good roles | Golden set measures recall; rejected postings are retained with a rejection reason, so the filter is auditable |
| Ranking cost grows | Tier 2 is bounded by Tier 1 output, not by ingest volume |
