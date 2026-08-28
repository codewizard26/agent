# Job Agent — Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Scope:** Cycle 1 (v1)

## 1. Problem

Finding relevant roles means checking dozens of boards by hand, re-reading the same
postings, and losing track of what has already been applied to. Applying means retyping the
same twenty answers into every ATS form.

This app does three things: on demand, pull fresh postings from many sources; rank them
against a specific person's resume; and drive the application form to the point where only
the final submit click remains.

## 2. Goals

- Two (extensible to N) resume profiles, each with its own filter posture and its own
  applied history.
- One button per profile — **"Fetch latest jobs for me"** — with a time-frame selector
  (24h / 3d / 7d / 14d / 30d). It fetches live, ranks, and shows results.
- Jobs already applied to or dismissed never appear again.
- An apply action that opens the real ATS form in a browser with every answerable field
  already filled, including resume upload.
- Nothing accumulates. No job warehouse, no scheduled jobs, no background processes.

## 3. Non-goals (cycle 1)

- **No job warehouse and no cron.** Postings are fetched, ranked, displayed, and discarded.
  See §4 for the one small thing that must persist.
- Generating tailored resumes or cover letters. The stored base resume PDF is submitted
  as-is. Free-text questions are not auto-answered — the apply task halts and waits.
- Ingesting from LinkedIn, Indeed, Glassdoor, ZipRecruiter, or Naukri. Prohibited by their
  terms, defended by anti-bot systems, and automating them from a user's own logged-in
  account puts that account at risk. They stay manual discovery surfaces.
- Unattended submit. See §6.
- Email follow-up tracking, interview scheduling, recruiter CRM.

## 4. What persists, and why

"Nothing stored" and "show me jobs I haven't applied to" cannot both hold — the second
requires remembering the first. The minimum that survives:

- **`profiles`** — resume PDF, parsed profile, filter posture, answer bank. Without this
  there is no profile to match against.
- **`job_ledger`** — one row per job the user *acted on*: applied or dismissed. Nothing
  else. A user who applies to 200 jobs over a year has 200 rows.
- **`apply_tasks`** — a transient queue row per in-flight application, deleted on completion.

No table accumulates postings. A fetch that returns 3,000 jobs writes zero rows.

## 5. Verified source landscape

All checks below were run against live endpoints on 2026-08-29. The unit of coverage is
**company board tokens**, not websites — one Greenhouse adapter over 200 tokens is broader
and far more stable than 100 bespoke scrapers.

| Adapter | Endpoint | Verified |
|---|---|---|
| `greenhouse` | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | 200 (coinbase, consensys, stripe, discord, gitlab) |
| `lever` | `GET api.lever.co/v0/postings/{token}?mode=json` | 200 (palantir, spotify, matchgroup) |
| `ashby` | `POST jobs.ashbyhq.com/api/non-user-graphql` op `ApiJobBoardWithTeams` | 200 |
| `remoteok` | `GET remoteok.com/api` | 200 |
| `arbeitnow` | `GET www.arbeitnow.com/api/job-board-api` | 200 |
| `hn_whoishiring` | `GET hn.algolia.com/api/v1/search` | 200 |

Board tokens 404 when a company is not on that provider (`plaid` on Lever, `uniswaplabs`
on Greenhouse). That 200-vs-404 response is itself a discovery mechanism: probe company
names seen in aggregator results against each provider, record the hits.
`sources/boards.yaml` is checked into the repo and seeds ~200 company/provider pairs.

### 5.1 Post-date fidelity — the time-frame filter depends on this

The time-frame selector is the centre of the product, so each adapter's date field was
verified rather than assumed:

| Adapter | Field | Fidelity |
|---|---|---|
| `greenhouse` | `first_published` | **True post date.** 51/51 coverage on discord's board, and genuinely distinct from `updated_at` (e.g. published 2026-06-23, updated 2026-08-06) |
| `lever` | `createdAt` (epoch ms) | True post date |
| `remoteok` | `epoch` / `date` | True post date |
| `arbeitnow` | `created_at` (epoch) | True post date |
| `hn_whoishiring` | comment `created_at` | True post date |
| `ashby` | **none** | The public board query exposes no date field. `publishedAt`, `createdAt`, `updatedAt`, `publishedDate`, `listedDate` all rejected by the schema; introspection is disabled |

**Never filter Greenhouse on `updated_at`.** A role posted in March and edited yesterday
would surface as "posted in the last 24 hours," which is the one lie this product cannot
afford — the entire workflow rests on applying to genuinely fresh postings.

Ashby carries `dateFidelity: 'none'` and is **excluded from time-framed fetches by default**.
It appears only when the time frame is set to "any", behind a labelled toggle. Every source
in the results UI displays its date fidelity, so a posting's freshness claim is always
traceable to a real field.

## 6. Submit-path findings — why apply is one click, not zero

Apply forms were fetched and inspected directly:

| Provider | Apply-form gate |
|---|---|
| Greenhouse | Cloudflare challenge on plain HTTP — `cf-mitigated: challenge`, 403, `<title>Just a moment...` even with a browser user-agent |
| Lever | hCaptcha — 200, with an `h-captcha-response` field required on submit |
| Ashby | reCAPTCHA |
| Workable | reCAPTCHA and Turnstile |

Every major ATS gates submission behind a CAPTCHA or an edge challenge. Clearing those
programmatically requires a CAPTCHA-solving service, which is deliberate circumvention and
gets the originating account and IP blocked. The app will not do this.

### 6.1 Verified browser mechanism

The 403 above is a *curl* result. Whether an automated browser is also challenged was tested
directly, because the apply feature rests on the answer.

Playwright `launchPersistentContext` with a **dedicated** user-data-dir (not the user's daily
Chrome profile), `channel: 'chrome'`, `headless: false`, against live Greenhouse postings:

```
discord: 200 | job-boards.greenhouse.io/discord/jobs/8599937002
  visible fields 34 | file inputs 2 | captcha widgets 1
gitlab : 200 | job-boards.greenhouse.io/gitlab/jobs/8503792002
  visible fields 22 | file inputs 2 | captcha widgets 1
```

No challenge, no interstitial, full application form rendered. The mechanism works.

A **dedicated** profile directory is required: Chrome holds a lock on its user-data-dir, so
driving the daily profile would mean quitting Chrome before every application. The worker's
profile is separate, persistent, and reused — any login or challenge cleared in it once
carries forward.

### 6.2 Two findings that shape the filler

**Fields have no usable `name` attributes.** The rendered Greenhouse form is React-controlled;
the only named input on the page is `g-recaptcha-response`. Labels are clean and semantic:

```
First Name* | Last Name* | Email* | Country* | Phone* | Location (City)* |
Attach | Enter manually | School | Degree | Discipline | LinkedIn Profile
```

Fillers match on **label, `aria-label`, and placeholder text — never on `name`**. This also
makes the approach portable: a label-driven filler degrades gracefully on unseen forms.

**Apply URLs split into two populations.** Greenhouse's `absolute_url` does not reliably
point at a Greenhouse form:

| Board | `absolute_url` host |
|---|---|
| discord, gitlab, anthropic | `job-boards.greenhouse.io` — raw ATS form, fillable |
| coinbase, stripe, consensys | `coinbase.com`, `stripe.com`, `consensys.io` — company-wrapped, bespoke DOM |

The worker resolves the final URL after redirects and picks a filler by the *landing* host,
not by the source adapter.

**Therefore:** the worker drives a dedicated persistent Chrome profile, fills every field it
has an answer for, uploads the resume, scrolls to submit, and hands the tab over. The user
clicks submit and solves a CAPTCHA tile if one appears.

The schema carries a per-adapter `submitMode: 'auto' | 'assisted'`. In cycle 1 every adapter
is `assisted` and the worker never clicks submit — the field exists so an ungated provider
discovered later is a data change rather than a rewrite. Honouring `auto` is a cycle-2
decision and would additionally require `auto_submit_authorized`.

## 7. Architecture — on demand

```
  [Fetch latest jobs]  ← profile + time frame
           │
           ├─ fan-out to adapters, concurrency-capped        ~2-8s
           │    greenhouse × N tokens · lever × N · remoteok · arbeitnow · hn
           ├─ normalize                                      in memory
           ├─ dedup by job_key                               in memory
           ├─ exclude everything in job_ledger for profile   1 SQL read
           ├─ time-frame filter on verified post date        in memory
           ├─ profile-derived filter (§7.2)                  in memory
           │       ~3000 → ~120
           ├─ Claude rank (Sonnet, batched)                  ~5-15s
           └─ render ranked cards
```

Nothing is written. Progress streams to the page so the wait is legible:

```
fetching 214 sources … 3,140 postings … 2,890 in time frame … 118 match … ranking …
```

**Tradeoff, stated plainly:** every fetch re-pays the fan-out and the ranking cost. Expect
15–30 seconds end to end. For an occasional, deliberate "whenever I'm free" fetch this is
the right trade — a warehouse earns its keep only under continuous polling, which is not
the usage pattern here.

An optional 24-hour score cache keyed by `(job_key, profile_id)` would make repeat fetches
within a day nearly free, at the cost of one more small table. Not in v1; add it if repeat
fetching becomes a habit.

### 7.1 Job key — load-bearing

In an on-demand design the key is the *sole* mechanism making "jobs I haven't applied to"
work. If a job returns from a different source as `Senior Software Engineer (Remote)` when
the ledger holds `Senior Software Engineer`, an applied job reappears. That is the design's
most visible failure mode, so the key is defensive:

```ts
ats_key  = `${ats_kind}:${ats_ref}`   // "greenhouse:discord/8599937002" — exact, preferred
slug_key = `${slug(company)}|${normalizeTitle(title)}`  // fallback
```

`normalizeTitle` lowercases, strips parenthetical suffixes (`(Remote)`, `(m/f/d)`), drops
trailing location fragments after ` - `, removes punctuation, and collapses whitespace.

Ledger rows store **both**. Exclusion matches on either. Greenhouse, Lever, and Ashby all
supply a stable ATS identity, so the exact key covers most of the volume and the slug key
catches aggregator reposts of the same role.

### 7.2 Profile-derived filter

**Nothing in this filter is hardcoded to a person.** Seniority band, core stack, and
geography all derive from `parsed_profile` and the profile's posture. The two seeded
profiles demonstrate why:

| | Profile 1 — Nikhil Mishra | Profile 2 — Shambhavi Soumya |
|---|---|---|
| Experience | ~5 years | <1 year, B.Tech CSE May 2026 |
| Band | mid, senior | entry, junior, associate |
| **Accepts** | `senior`, `sde 2/3`, `full stack engineer` | **`new grad`, `entry level`, `junior`, `graduate`, `associate`, `trainee`** |
| **Rejects** | `intern`, `junior`, `new grad`, `staff`, `principal`, `director`, `EM` | `senior`, `staff`, `principal`, `lead`, `manager`, `5+ years` |
| Core stack | TypeScript, React, Next.js, Node, Express, GraphQL, PostgreSQL, MongoDB, Django | React, Next.js, Node, Express, MongoDB, JavaScript, Python, C#, ASP.NET, MySQL, Tailwind |
| Bonus signal | Solidity, EVM, Cosmos, DeFi (scores up, never gates) | — |
| Posture | remote-global, no sponsorship needed | **unset** — defaults to `india + remote` |

The approved earlier draft hardcoded a mid/senior band and rejected `new grad`. Applied to
profile 2 that returns an empty feed — she is a 2026 graduate and those are her *target*
keywords. Hence: derived, never fixed.

Remaining filter rules, all profile-scoped:

- **Geography** — reject postings gated outside the profile's posture: `US only`,
  `must reside in`, `must be authorized to work in`, `requires security clearance`,
  on-site listings outside the profile's region.
- **Timezone** — reject hard overlap requirements incompatible with IST. Ranges that
  overlap at all pass through to ranking.
- **Stack overlap** — at least 2 matches against the profile's core stack.
- **Time frame** — post date within the selected window, using only true post dates (§5.1).
- **Ledger** — not applied, not dismissed, for this profile.

Profile 2's posture is unset rather than inferred. It defaults to `india + remote` and is
confirmed by its owner; the app does not guess someone's work-authorization posture from
their resume.

### 7.3 Claude rank

Survivors batch 20 per call to `claude-sonnet-5` with the profile's parsed resume and a
structured-output tool schema:

```ts
{
  jobKey: string
  score: number            // 0-100
  tier: 'strong' | 'stretch' | 'skip'
  why: string              // one sentence, shown on the card
  redFlags: string[]       // "unpaid trial", "equity only", "8 years required"
  sponsorshipGate: boolean // JD implies authorization the profile lacks
  timezoneGate: string | null
  resumeHooks: string[]    // points to lead with; feeds cycle-2 tailoring
}
```

`sponsorshipGate` is a **ranking** signal, not just an apply-time field. JD language for it
is too varied for regex, which is exactly why it belongs here and not in §7.2.

`hn_whoishiring` needs a model at ingest too: thread comments are freeform, so
`claude-haiku-4-5` parses each into
`{company, title, location, remote, applyUrl, stack[], postedAt}`. Non-job comments drop.

## 8. Profiles and the answer bank

A profile is a person, not a document.

```
profiles
  id, name, owner_email, resume_blob_url, resume_text, parsed_profile jsonb,
  posture jsonb, auto_submit_authorized boolean default false, created_at
```

`parsed_profile` is Claude's structured extraction of the resume — skills, seniority, years,
graduation year, employers, links. Computed once at upload, cached, and it drives §7.2.

**Seeded profiles:**
- Profile 1 — `nikhil_resume_december.pdf`, posture `remote-global / no sponsorship`,
  answer bank filled by its owner.
- Profile 2 — `fullstackresume.pdf` (Shambhavi Soumya), `auto_submit_authorized: false`,
  posture unset (defaults `india + remote`), **answer bank empty**.

### 8.1 Answer bank

Holds responses the profile owner supplied **once**, keyed by canonical field name.
Auto-fill reads from it. Nothing is ever invented.

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
  `status = 'awaiting_human'`, records the field in `blocked_fields`, and surfaces it in the
  UI. It does not guess, and it does not submit a partial form.
- **EEO/demographic fields default to "decline to self-identify."** These are voluntary. The
  owner may set a different value explicitly; the app never picks one for them.

Per-job free-text ("why do you want to work here?") cannot come from the bank. In cycle 1
these always halt for the user to type.

**This is the common path, not the exception.** Live forms confirm it — Discord's
application carries a required *"Why do you want to work at Discord?"*, GitLab's asks about
existing employment agreements. Expect most cycle-1 applications to end at `awaiting_human`
with a paragraph to write. The realistic v1 experience is "every mechanical field filled,
resume uploaded, one box left for you," not "applied."

### 8.2 Second-profile authorization

Profile 2 belongs to a different person. Applications under it carry their name and answers.

- `auto_submit_authorized` defaults to **false**, and a false profile stays in assisted mode
  regardless of any future `submitMode: 'auto'` adapter.
- Its answer bank must be filled by its owner, not inferred. Work authorization,
  compensation, notice period, and EEO values start empty and halt on first use.
- Its resume PDF and PII live in this project's database and go nowhere else. Model calls
  send resume text to the Anthropic API for parsing and ranking; nothing goes to any other
  third party.

## 9. Apply flow

```
user clicks Apply on a result card
  → apply_tasks row: status='queued', carries the job's apply_url and job_key
  → local worker polls
  → status='opening'  : Playwright launches the dedicated persistent Chrome profile
  → status='filling'  : resolve final URL after redirects, select filler by landing host
  → resume upload from stored blob
  → every mapped field filled from answer_bank
  → unmapped or unanswerable field → blocked_fields
  → status='awaiting_human' : tab focused, scrolled to submit
  → user clicks submit, then "Mark applied" in the dashboard
  → job_ledger row written (both keys, state='applied'), apply_tasks row deleted
```

The worker never clicks submit in cycle 1. Marking applied is an explicit user action, so
the ledger never contains a fabricated submission. Because results are ephemeral, the ledger
row is written from the task payload, not looked up.

### 9.1 Filler strategy

Two layers:

1. **Known-ATS fillers** — `greenhouse.ts`, `lever.ts`, `ashby.ts`, `workable.ts`, selected by
   resolved landing host. Encode that ATS's quirks: multi-step flows, the
   `Attach / Enter manually` resume toggle, custom-question containers.
2. **Generic label-driven filler** — fallback for company-wrapped and unknown forms. It
   enumerates every visible input with its label/aria/placeholder text, then asks
   `claude-haiku-4-5` to map that label list onto `answer_bank` keys, returning
   `{ label, answerKey | null, confidence }`. Anything below threshold, or `null`, goes to
   `blocked_fields` rather than being filled on a guess.

Both write a `fill_report` naming every field filled, its source key, and every field left
blocked — so a mis-fill is auditable after the fact.

## 10. Dashboard

Opens on a profile switcher — two cards, one per resume. Selecting a profile scopes
everything below.

Controls: **time frame** (24h / 3d / 7d / 14d / 30d / any) and **Fetch latest jobs for me**.
Ashby appears only at "any", behind a labelled toggle (§5.1).

Results render as ranked cards: score, `why`, red flags, company, title, location, source,
post date with its fidelity, and the actions `Apply` and `Dismiss`. Results live in page
state; a reload re-fetches. Filters over the current result set: tier, source, age.

`Dismiss` writes a ledger row so the posting never returns. This is the only way to suppress
a result, since there is nothing else remembering it.

## 11. Testing

- **Adapter contract tests** against recorded JSON fixtures committed to the repo. A separate
  `pnpm test:live` hits real endpoints and is the canary for upstream API changes.
- **Date-fidelity tests** assert each adapter maps to the field in §5.1 — specifically that
  Greenhouse reads `first_published` and never `updated_at`. This is the regression most
  likely to reintroduce a silent freshness lie.
- **Job-key tests** over collision cases: `Senior Software Engineer` vs
  `Senior Software Engineer (Remote)` vs `Senior Software Engineer - Bangalore` must produce
  one key; two genuinely different roles at one company must not.
- **Profile-derived filter tests** run the same fixture set through both profiles and assert
  opposite outcomes on seniority — a `new grad` posting passes for profile 2 and fails for
  profile 1. This is the guard against re-hardcoding.
- **Ranking** validated against a golden set of ~30 hand-labelled postings per profile.
  Assert rank correlation, not exact scores. Also the regression check when the prompt or
  model changes.
- **Fillers** tested against saved ATS form HTML fixtures. Never against live apply forms — a
  test suite must not create real applications.

## 12. Error handling

- A failing adapter is isolated; the fetch continues and the UI reports which sources failed
  and how many results are therefore missing.
- A fetch reaching zero successful adapters is an error, not an empty feed. The two are never
  conflated in the UI.
- Model calls retry twice with backoff. A batch failing all attempts renders those jobs
  unranked at the bottom rather than dropping them.
- Fan-out concurrency is capped (default 20) so ~200 board tokens do not open 200 sockets.
- Worker crash mid-fill leaves the task in `filling`; tasks stuck over 10 minutes reset to
  `queued`.

## 13. Stack and runtime

**pnpm workspaces:**

```
apps/web       Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui  → Vercel
apps/worker    Node + Playwright, local only                           → user's machine
packages/db    Drizzle schema + migrations, shared
packages/core  adapters, normalize, job-key, filters, rank prompts, shared
```

- **Vercel**: web app, Neon Postgres (Marketplace) holding only §4's three tables. **No cron
  jobs** — fetching is user-initiated. The Anthropic API key is server-side only.
- **Local**: the worker, on the same database over a pooled connection. Browser session
  cookies never leave the machine.
- Models are a single exported constant, `packages/core/src/models.ts`, so swapping is one
  line. Defaults: `claude-opus-5` for ranking (judgment work), `claude-haiku-4-5` for the
  mechanical calls — resume extraction, HN comment parsing, generic field mapping.
  Ranking ~120 jobs costs roughly $0.90/fetch on Opus, $0.36 on Sonnet, $0.18 on Haiku;
  changing `RANK_MODEL` to `claude-sonnet-5` is the cost lever if fetches get frequent.
- Structured model output uses `client.messages.parse()` with `zodOutputFormat` — never
  hand-parsed JSON out of a text block.

## 14. Cycle boundaries

**Cycle 1 (this spec):** two profiles, answer bank, on-demand fetch across five
time-framed adapters, job key + ledger, profile-derived filter, Claude ranking, dashboard,
assisted apply worker.

**Cycle 2:** cover letter and free-text answer generation — removes the `awaiting_human`
halt for text fields.

**Cycle 3:** per-job tailored resume PDF generation, with a review step.

**Cycle 4:** optional score cache and saved searches, if repeat fetching becomes a habit.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Job key misses, applied job reappears | Dual key (exact ATS identity + normalized slug); collision tests in §11 |
| Greenhouse date read from `updated_at` | Explicit test asserting `first_published`; fidelity shown in the UI |
| Ashby has no post date | Excluded from time-framed fetches; surfaced only at "any" behind a toggle |
| Fetch latency grows with token count | Capped concurrency; streamed progress; token list is a curated file, not unbounded |
| Every fetch re-pays ranking cost | Ranking bounded by §7.2 output, not by fetch volume; score cache available in cycle 4 |
| ATS form DOM changes break fillers | Label-driven matching, not selectors; degrades to "opens page, reports blocked fields" |
| Filter over-rejects, feed looks empty | Rejected postings retained in the response with a rejection reason, viewable behind a toggle, so the filter is auditable |
| Upstream API shape changes | Adapters isolated; `test:live` canary; contract tests fail loudly |
