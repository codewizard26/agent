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
  account puts that account at risk. They stay manual discovery surfaces. The sanctioned
  form of that is a *deep link*: the feed panel offers prefilled LinkedIn and Naukri
  searches built from the profile's own keywords, and every job row links to the people
  at that company on LinkedIn. The user browses and connects as themselves; the app never
  fetches, parses, or stores a byte from either site.
- **Ingesting X/Twitter through its API.** `api.twitter.com/2/tweets/search/recent` returns
  401 unauthenticated and the free tier carries no search endpoint at all; search starts at
  the paid Basic tier. X hiring posts are reached instead as indexed pages through the
  web-search adapter (`site:x.com "we're hiring"`), which covers the visible subset without
  a subscription. If full X coverage is wanted later, it is a paid API tier plus one
  adapter — no architectural change.
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
| `websearch` | OpenAI Responses `web_search` tool | Runs on the provider's infrastructure — no Google API key, no second vendor |
| `bluesky` | `POST bsky.social/xrpc/com.atproto.server.createSession` then `app.bsky.feed.searchPosts` | Public search returns 403 unauthenticated; `createSession` answers correctly on bad credentials, so a free account plus an app password unlocks it |

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
| `bluesky` | post `createdAt` | True post date |
| `websearch` | date stated on the page | **Reported, not true.** A date a model read off a page. Usable for time-framed fetches but labelled distinctly in the UI; when no date is stated the posting falls back to `none` |
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
           ├─ rank (RANK_MODEL, batched)                     ~60-180s
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
| Posture | remote-global, no sponsorship needed | **India only** — `regions: ["india"]`, set by the operator |

The approved earlier draft hardcoded a mid/senior band and rejected `new grad`. Applied to
profile 2 that returns an empty feed — she is a 2026 graduate and those are her *target*
keywords. Hence: derived, never fixed.

Remaining filter rules, all profile-scoped:

- **Geography** — reject postings gated outside the profile's posture: `US only`,
  `must reside in`, `must be authorized to work in`, `requires security clearance`,
  on-site listings outside the profile's region. The region test reads
  `posture.regions` directly: `"india"` admits roles located in India, `"remote"` admits
  remote roles wherever based, and a posture carrying only `"india"` therefore rejects
  remote-anywhere roles. India matching here is *strict* — `india` and the Indian cities,
  never the `apac` / `asia` / `ist` markers, which name regions that merely cover India
  and would readmit the surrounding continent. Those broader markers still drive India
  *ordering* (§7.2), which admits nothing on its own.
- **Timezone** — reject hard overlap requirements incompatible with IST. Ranges that
  overlap at all pass through to ranking.
- **Stack overlap** — at least 2 matches against the profile's core stack.
- **Time frame** — post date within the selected window, using only true post dates (§5.1).
- **Ledger** — not applied, not dismissed, for this profile.

Profile 2's posture is never inferred from her resume — the app does not guess anyone's
work-authorization posture from a CV. It shipped as the `india + remote` default and was
then narrowed to `regions: ["india"]` on the operator's instruction, which drops
remote-anywhere roles and leaves only roles located in India. That is a deliberately
strict setting: most of the ingested boards (Remotive, Himalayas, Jobicy, RemoteOK,
Arbeitnow) are remote-first, so a large share of their intake no longer reaches her feed.
The India-native sources — Instahyre above all — and the India offices on the company
boards are what fill it instead.

### 7.3 Claude rank

Survivors batch 20 per call to `RANK_MODEL` with the profile's parsed resume and a
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
`UTILITY_MODEL` parses each into
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
  posture `regions: ["india"]` — India-located roles only, **answer bank empty**.

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
  send resume text to the model provider for parsing and ranking; nothing goes to any other
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
   `UTILITY_MODEL` to map that label list onto `answer_bank` keys, returning
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
  jobs** — fetching is user-initiated. The model API key is server-side only.
- **Local**: the worker, on the same database over a pooled connection. Browser session
  cookies never leave the machine.
- Models are a single exported constant, `packages/core/src/models.ts`, so swapping is one
  line. Defaults: `gpt-5` for ranking (judgment work), `gpt-5-mini` for the
  cheap extractions (resume, HN comments, Bluesky posts, form-label mapping).
  Ranking is the only cost that scales with feed size; `RANK_MODEL` is the lever if
  fetches get frequent. Measured 2026-08-29: 3 jobs in one batch at high reasoning
  effort took 60s, so ~41 jobs across 3 parallel batches lands near 2-4 minutes.
  Measured end-to-end on 2026-08-29: `POST /api/fetch` at a 7-day window took 4m21s —
  12,545 fetched, 7,727 deduped, 35 kept, **35/35 ranked**. Keyless `pnpm candidates`
  over the same window takes 20s, since it skips hn, websearch and ranking. Note the
  4m21s figure exceeds the route's own `maxDuration = 300`, which only bites on a
  Vercel deploy — locally there is no ceiling.
- Every model call goes through the `LlmClient` interface in `packages/core/src/llm.ts`,
  never a provider SDK directly. `parse()` is structured output (`responses.parse` with
  `zodTextFormat`); `searchWeb()` is grounded generation. No hand-parsed JSON out of text.
- The Responses API counts reasoning tokens against `max_output_tokens`, and a response
  that runs out returns `output_parsed: null` — not an error. `llm.ts` throws on
  `status === "incomplete"` so an undersized budget cannot masquerade as a refusal, and
  `rankJobs` logs how many batches failed rather than silently returning fewer rankings.

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
| Form fields silently unmapped | `mapLabelsToKeys` matches on field **index**, never an echoed label. Matching on the label mapped nothing at all: the prompt decorates labels with their type, and a model echoing `First Name (text, required)` never equals `First Name` |
| hn source alone exceeds the 300s route ceiling | 782 comments at ~471ms each (concurrency 8) is 368s. Capped at `HN_COMMENT_LIMIT = 200` in `sources.ts` |
| One slow board sets the pace for all 58 | `DEFAULT_SOURCE_TIMEOUT_MS = 15s` per source. Measured 2026-08-29: the Lever aggregator `jobgether` (4,203 postings) took 42.7s while every other source finished inside 13s — it alone was 94% of fetch wall clock. Model-backed sources carry their own `timeoutMs` (240s), since a budget sized for an HTTP board kills every one of them |
| Model calls fanned out per item hit rate limits | hn and bluesky parse through `mapWithConcurrency` at `MODEL_CONCURRENCY = 8`, not `Promise.all` over every item |

## 16. The keyless path (added 2026-08-29)

A model API key is a separate purchase from a Claude Pro subscription, so the pipeline is
split so the paid half is optional rather than required. The paid half now runs on OpenAI
(`OPENAI_API_KEY`); the free half runs on no key at all.

Only two steps in this system need a model: parsing a resume into a `ParsedProfile`, and
ranking filtered jobs. Everything between them — fanning out to sources, dedupe, the
time-frame window, and the profile-derived Tier 1 filter — is pure code. `collectCandidates()`
in `packages/core/src/pipeline.ts` is exactly that middle, and it deliberately takes no
model client. `runFetch()` is `collectCandidates()` plus ranking.

`buildSources()` in `packages/core/src/sources.ts` is the single definition of the source
list, shared by both callers. Its `client` is optional: without one it omits
`MODEL_BACKED_SOURCES` (`hn`, `websearch`, `bluesky`) and returns the pure-HTTP set.

Two ways to run a fetch, sharing every adapter, the job key, the filter and the ledger:

| | Web app (`POST /api/fetch`) | CLI (`pnpm candidates`) |
|---|---|---|
| Resume parsing | `pnpm seed`, via `UTILITY_MODEL` | Claude Code reads `pnpm resume-text` output, writes a profile JSON; `pnpm add-profile` inserts the row |
| Sources | 12 kinds, model-backed included | 9 kinds, model-backed omitted |
| Ranking | `rankJobs()` via `RANK_MODEL` (`gpt-5`) | Claude Code, in conversation |
| Needs `OPENAI_API_KEY` | yes | no |

The CLI writes `candidates.json` (full records, for the apply step) and
`candidates.brief.md` (for reading in conversation). The brief is rendered by `profileBrief()`
and `jobBrief()` — the same functions `rankJobs()` sends to the API — so the field set and its
ordering cannot drift. The text is not byte-identical: the CLI truncates descriptions harder
(800 chars vs 2000) and prefixes each job with a `source | posted | apply` line for the human
reader.

Ordering on the keyless path uses `sortByIndiaPriority()`: India-located first, then
India-eligible, then the rest. `runFetch()` keeps its own rank-aware version of the same
rule. Both are ordering, never filtering.

A profile JSON is validated against `ParsedProfileSchema` and `PostureSchema` on load, so a
hand-written profile fails with a field path rather than silently filtering nothing. The CLI
reads the database but never writes to it; with no matching profile row the ledger is empty
and it says so, because an empty ledger means applied jobs reappear.

**India term matching is whole-word.** It was substring matching until a live run put
California roles above a Mumbai one: `Specialist`, `Scientist` and `Administrator` all
contain the `ist` timezone marker, `Apache` contains `apac`, and `Indiana` contains `india`.


## 17. The persisted board (added 2026-08-29)

**This reverses an earlier constraint.** §14 and the original brief said on-demand fetching
with nothing stored. The user changed that once Neon was connected: the board is now
persisted and refreshed on a schedule, with on-demand fetch kept alongside it. Read §16's
"writes nothing" as applying to `collectCandidates` and the CLI, not to the web app.

`feed_jobs` holds what the board renders — no `descriptionText`, which is most of a fetch's
bytes and is never shown. Two writers:

| | `/api/cron/fetch` | `/api/fetch` |
|---|---|---|
| Trigger | `vercel.json` cron, `0 */4 * * *` | the "Fetch latest jobs" button |
| Preset | `CRON_PRESET` — 7 days, rank 25, no model sources | whatever the four UI controls say |
| Measured | 2m12s for two profiles | 20s fast / 4m21s deep |

Profiles refresh in parallel. Sequentially two profiles took 3m03s against the 300s
ceiling — a third would have exceeded it, because every profile re-fetches the same 58
sources. Parallel is 2m12s. If this ever grows past a handful of profiles the real fix is
fetching once and filtering per profile, not more parallelism.

The cron preset is bounded on purpose: the deep preset takes 4m21s against a
`maxDuration = 300` ceiling, so a cron with Hacker News or web search enabled would be
killed mid-run and leave a half-written board every four hours.

Rows upsert rather than replace, so `firstSeenAt` survives and a job does not read as new
after every refresh. Matching uses the same dual key as the ledger: rows sharing an
`atsKey` are cleared before insert, because a job's slug can normalize differently between
fetches while its ATS identity holds still — without that the board shows one posting
twice. Verified 2026-08-29: two consecutive cron runs both reported 35 jobs, and the board
stayed at 35.

Applying or dismissing deletes the feed row as well as writing the ledger row. The ledger
only keeps a job out of the *next* fetch; without the delete, a job the user already
handled sits on the board until the cron next runs.

`CRON_SECRET` gates the route. Unset locally it is open, for `curl localhost:3000/api/cron/fetch`;
unset on a Vercel deploy the route refuses with a 500, because every call spends ranking
money and a public URL that bills the user is not an acceptable default.

**Ranking effort is the dominant cost of a fetch, not the source count.** Measured on the
same 10 jobs: `low` 35s, `medium` 66s, `high` 113s, with low and medium agreeing within ~2
points per job. `rankJobs` defaults to `medium`. The four UI controls (time frame, source
depth, board cap, rank limit) matter less than that one parameter.


## 18. Geography applies to both postures (corrected 2026-08-29)

The geography check used to be gated on `posture.remoteGlobal`, which inverted its own
intent: the remote-global profile got the strict rule ("remote, or on-site in India") and
the India-only profile got **no geography filter at all** — the looser outcome, for the
candidate with the narrower posture. Adding the second profile is what surfaced it; her
feed would have been full of on-site roles in Austin and Berlin.

The rule now reads the same for everyone: an on-site role is viable only where the
candidate already is. `remoteGlobal` says whether remote work may be for any employer, not
whether relocation is on the table. Both seeded profiles are India-based, so an on-site
role in India passes and an on-site role elsewhere does not.

The two profiles are the regression test for everything profile-derived. From one fetch of
the same 12,749 postings on 2026-08-29: Nikhil (mid/senior, 5 years) kept 35, Shambhavi
(entry/junior, May 2026 graduate) kept 24. Their `titlesReject` lists are near-exact
complements — hers rejects `senior`, `staff`, `lead`; his rejects `new grad`, `junior`,
`sde 1` — from the same code path, which is the point of deriving them.

Shambhavi ships with an **empty answer bank** and `auto_submit_authorized: false`. Her name
goes on those applications, so work authorization, compensation, notice period and EEO
answers have to come from her, not be inferred.


## 19. Per-profile fetch window (added 2026-08-29)

`profiles.feed_time_frame_days` sets how far back the cron looks, per profile. NULL means
"any" — the only window that also admits the undated sources (Ashby, Instahyre). The cron
takes its window from the profile and everything else from `CRON_PRESET`.

It is per profile because the two profiles need different windows to fill a board. At 7
days Shambhavi (entry/junior) kept 24; at 30 days she keeps **96**, while Nikhil stays at
35 on 7 days. A fresh graduate simply sees fewer new postings per day from this source set.
The profile page states the active window, and a manual fetch starts from it.

Widening costs nothing extra in ranking: `CRON_PRESET.rankLimit = 25` caps how many are
scored regardless of how many are kept. The remainder sit on the board unranked.

**The schema was defined three times** — `schema.ts`, the DDL in `client.ts`, and a
drifted copy in `test-db.ts` that never received `feed_jobs` at all. `client.ts` now
exports the one DDL and the test harness applies it, so a table or column added once
reaches dev databases and tests together.

That DDL also carries `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` lines. `CREATE TABLE IF
NOT EXISTS` does nothing to a table that already exists, so a column added later never
reached a local database created before it — surfacing as `column ... does not exist` in
dev and in the suite, never as a migration error. Every new column needs a line there too.


## 20. India-only posture and the India source wall (added 2026-08-31)

Shambhavi's posture narrowed from `india + remote` to `regions: ["india"]`. Three things
had to change for that setting to mean anything.

**`posture.regions` was dead data.** It was declared in `Posture`, validated by
`PostureSchema`, asserted in tests, written by both seed paths — and read by nothing. The
geography gate keyed off `job.remote` and `indiaPriority` alone, so editing `regions` to
`["india"]` would have changed the stored row and not one posting in the feed. The gate
now reads `regions` and `remoteGlobal` stays out of it, per §18.

**`isIndiaLocated` was too loose to gate on.** Its term list carries `apac`, `asia` and
`ist` alongside India and its cities. Those are correct for *ordering* — a role open to
APAC is genuinely closer to reachable than one in Ohio — and wrong for a gate, where a
Singapore "Backend Engineer, APAC" would pass as India-located and readmit the region the
gate exists to cut. The list is now split: `INDIA_STRICT_TERMS` (India and its cities) for
the region gate, the broader list for `sortByIndiaPriority`.

`isIndiaLocatedStrict` also stops reading `locationRestrictions`. A remote posting
restricted to India is one an Indian candidate may *take* — that is `isIndiaEligible`'s
question — but it is not a role located in India, and reading restrictions here would
readmit remote-anywhere-but-India roles through the back door. It reads `locationRaw` and
`title` only, and like `isIndiaLocated` it never reads `descriptionText`, so a posting
whose location says "Remote" and whose body mentions a Bangalore office is dropped. Two
accepted costs of the strict setting, both deliberate.

Behaviour under each posture:

| Posting | `["india"]` | `["india","remote"]` | `["remote"]` |
|---|---|---|---|
| On-site Bangalore | pass | pass | pass |
| Remote, location "Remote - India" | pass | pass | pass |
| Remote, restrictions `["India"]` | **reject** | pass | pass |
| Remote anywhere | **reject** | pass | pass |
| On-site San Francisco | reject | reject | reject |
| "Engineer, APAC", Singapore | reject | reject | reject |

The `["remote"]` column is Nikhil's posture and is unchanged from before this section —
on-site India still reaches him through `indiaPriority`.

**Only the live row matters.** `seed.ts` inserts, it does not upsert, and it re-parses both
resumes through a model. The row was updated with `pnpm add-profile --profile
profiles/shambhavi.json`, which needs no API key and leaves `auto_submit_authorized`
alone. `seed.ts` was updated too, for the next fresh database.

### 20.1 The India source wall

"Add more India job APIs" was probed on 2026-08-31 before being planned. It came back
mostly negative, and the walls are recorded here so the next attempt starts from evidence:

| Source | Result |
|---|---|
| Instahyre | **200** — already integrated, and still the one India-native source that works |
| Cutshort | 401 — authentication required |
| Hirist | 404 — no public API |
| Wellfound | 404 — no public API |
| Internshala | 404 — no public API |
| Jooble | 403 — API key required |
| Findwork | 401 — API key required |
| Adzuna India | 400 — endpoint live, needs a free `app_id` / `app_key` |
| TheMuse | 200, but unusable as-is |

TheMuse deserves the detail. Its `location` parameter is decorative: `location=Bangalore,
India` returns 8,875 results whose first page is SpaceX in El Segundo, Optum in the US and
a spread of "Flexible / Remote". The per-job `locations` array is clean, so India roles
could be recovered by post-filtering — but that means fetching several city queries of
mostly-noise to surface roles like "Team Leader-R" that fail the two-core-stack gate
anyway. Not built.

One piece of collateral from the strict gate lands here. `normalizeInstahyre` sets
`locationRaw` from the posting's `locations` field, so its rows pass the India-only gate on
their city — but a row whose `locations` reads "Remote" now falls outside the gate, even
though Instahyre is an India-only marketplace where that role is definitionally hiring in
India. The remote-first boards are unaffected in the same way: Remotive, Himalayas and
Jobicy all write the restriction string into `locationRaw`, so an India-restricted role
there still reads as India-located. The gap is specific to remote-labelled Instahyre rows.

**Adzuna India is the real unlock** and the one worth doing next: free tier, genuine India
coverage, one adapter, blocked only on registering for a key.

Until then, the India-only feed is fed by Instahyre plus the India offices on the company
boards. Instahyre exposes no post date, so it joins **only** an unbounded fetch — an
India-only profile should run the "Any (includes undated sources)" window to see it at
all. Relaxing that per posture was considered and cut: the gate lives in `buildSources`,
which takes `profile` but not `posture`, and threading posture through would ripple into
`candidates.ts`, `feed-fetch.ts` and the fetch route for a setting the window already
controls.


## 21. Role families, and why LinkedIn and Naukri never arrived (added 2026-08-31)

Two complaints, one about noise and one about coverage. They had separate causes and the
second one had two.

### 21.1 Nothing checked what kind of job it was

`deriveTitleKeywords` answers *how senior* a posting is. Nothing answered whether it was a
software engineering role at all. The filter rejected on `titlesReject` — seniority words —
and then asked for two core-stack matches anywhere in title, location and description. A
recruiter, sales or customer-success posting at a React shop clears both: the employer's own
boilerplate lists React and Node, and "Technical Recruiter" contains no seniority word.
"Team Leader-R" and "Senior Training Specialist", both real results, arrived exactly this way.

`roles.ts` adds the missing axis. `isEngineeringRole` reads the **title only** — the
description is where the false positives live, and the title is the field that does not lie.
`ROLE_TERMS` includes bare "engineer" and "developer" so that "Backend Engineer II" and
"Developer, Payments" match; `NON_ENGINEERING_TERMS`, checked first, is what keeps those two
honest against Sales Engineer, Solutions Engineer and Technical Recruiter.

`deriveRoleFamilies` reads the resume's stack and returns the titles to search for:
"software engineer" always, plus frontend, backend and — when both appear — full stack. The
web search queries used to hardcode "full stack developer", which is one person's title.

### 21.2 The web search source was switched off by default

`buildSearchQueries` has always carried `site:naukri.com`, `site:wellfound.com` and
`site:hirist.tech`. They had simply never run. Web search sat behind `skipModelSources`
alongside Hacker News and Bluesky, and the panel defaults to Fast, which drops all three.

Hacker News and Bluesky belong there — one model call per comment or post, minutes per
fetch. Web search does not: two calls total, one to search and one to structure, no matter
how many postings come back. It now runs on every fetch that has a client, and
`DEEP_ONLY_SOURCES` names the two that Fast still skips. `site:linkedin.com/jobs` joins the
query list.

This stays inside §3. Nothing logs into LinkedIn or Naukri and nothing fetches them
directly — their postings are reached as pages a search engine has already indexed, which is
the same route §3 defines for X. The prefilled LinkedIn and Naukri links from §20 remain as
a fallback, not as the mechanism.

**LinkedIn works; Naukri is unproven.** Across three live runs on 2026-08-31 LinkedIn
returned postings every time (3, then 2, then 1). Naukri returned **zero in all three**. A
direct probe explains why: `site:naukri.com "software engineer" India` returns nothing, and
so does a stack-qualified variant, while the bare `site:naukri.com frontend developer jobs`
returns a listing. Naukri's job pages are thinly indexed, and the query as first written —
a quoted role OR-chain plus four stack terms plus a recency phrase — over-constrained it to
nothing. The Naukri query is now deliberately the loosest of the seven: one role, no stack,
no recency. That has not yet produced a Naukri result in a full run, so Naukri coverage
should be treated as **not demonstrated**. The other India sites reached by the same route —
Cutshort, Hirist and Wellfound — return consistently, so the route itself is sound.

### 21.3 The filter rejected search results on evidence that did not exist

Ungating the source was not enough. The first live run returned 7 postings, 3 of them from
LinkedIn, and kept **one**. Two died on "fewer than 2 core stack matches".

The adapter had been writing `descriptionText: "Found via web search on <page>"` — a
provenance sentence in the field that holds the job description. The stack filter read that
sentence, found no React and no Node in it, and rejected the posting. Every LinkedIn and
Naukri result was structurally incapable of passing, because a search result has a title and
no description at all.

Two changes. The adapter now writes `descriptionText: ""`, since provenance already lives in
`sourceKind` and the apply URL. The filter applies the stack gate only when there is
description text to read: absent evidence, the role and seniority gates stand on their own
and the ranker scores the rest. This is the rule `isIndiaEligible` already follows for an
empty restriction list — an empty field means unknown, never "no".

The rule is written for web search but applies to **any** description-less row, and several
adapters can produce one: a Greenhouse, Lever or Ashby posting with empty `content`, a
Himalayas row with neither description nor excerpt, and — the volume case — an Instahyre row
whose `keywords` array is absent, since its description is that array joined. Those rows now
clear the stack gate on their title alone. The role gate from §21.1 is what carries the
weight there, and for Instahyre in particular a title-only "Frontend Developer" in Bangalore
is a genuine match rather than a leak.

Measured after the fix, same profile and window: **14 postings, 13 kept** — LinkedIn 2,
Wellfound 3, Cutshort 2, Hirist 1, the rest company career pages. Every one India-located
and on her stack. The single rejection was an internship. A third run after the Naukri query
was loosened returned 8, kept 7, again all India and all on her stack.

### 21.4 What the role gate excludes

`isEngineeringRole` needs a title term to match, so titles that name the work without ever
saying engineer, developer, SDE, SWE or a framework are dropped. "Member of Technical Staff"
is the notable one — common at Indian product companies — along with "Technical Analyst".
"Programmer Analyst" passes on `programmer`. These are accepted losses: widening the accept
list far enough to catch them readmits the non-engineering titles the gate exists to cut.
