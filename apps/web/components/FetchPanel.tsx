"use client";

import { useState } from "react";
import { dismissJob, queueApply } from "../app/actions";
import {
  linkedInJobsUrl,
  linkedInPeopleUrl,
  naukriJobsUrl,
  type SearchProfile,
} from "../lib/manual-search";

const TIME_FRAMES = [
  { label: "24 hours", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "Any (includes undated sources)", days: null },
] as const;

/**
 * Ranking is the only per-job-priced stage and by far the slowest, so it gets
 * its own control. Jobs past the cap still appear — unranked, below the scored
 * ones — because the point is to spend less, not to see less.
 */
const RANK_LIMITS = [
  { label: "Rank top 10", value: 10 },
  { label: "Rank top 25", value: 25 },
  { label: "Rank top 50", value: 50 },
  { label: "Rank everything", value: null },
] as const;

/**
 * Measured 2026-08-29: boards ~13s all in; Hacker News adds ~2.5 min. Web
 * search now runs in both modes — it is two model calls for the whole fetch,
 * and it is the only route to LinkedIn, Naukri and Wellfound postings.
 */
const SOURCE_MODES = [
  { label: "Fast — boards + LinkedIn/Naukri web search", skipModelSources: true },
  { label: "Deep — adds Hacker News + Bluesky", skipModelSources: false },
] as const;

const BOARD_CAPS = [
  { label: "All company boards", value: null },
  { label: "Top 30 boards", value: 30 },
  { label: "Top 15 boards", value: 15 },
] as const;

/** Rough, and labelled as such — real time depends on how many jobs survive. */
function estimate(
  skipModelSources: boolean,
  maxBoards: number | null,
  rankLimit: number | null,
): string {
  const boards = maxBoards === null ? 15 : Math.max(6, Math.round(maxBoards / 4));
  // Web search is in both modes now, so its ~35s is unconditional; the mode
  // switch only buys or saves the per-item Hacker News and Bluesky passes.
  const seconds =
    boards + 35 + (skipModelSources ? 0 : 120) + Math.ceil((rankLimit ?? 40) / 20) * 75;
  return seconds < 90 ? `~${Math.round(seconds)}s` : `~${Math.round(seconds / 60)} min`;
}

interface RankedResult {
  key: { atsKey: string | null; slugKey: string };
  company: string;
  title: string;
  locationRaw: string;
  applyUrl: string;
  sourceKind: string;
  postedAt: string | null;
  dateFidelity: "true" | "reported" | "none";
  rank: {
    score: number;
    tier: string;
    why: string;
    redFlags: string[];
    sponsorshipGate: boolean;
  } | null;
}

function dateLabel(job: RankedResult): string {
  if (job.dateFidelity === "none") return "no post date available";
  const day = job.postedAt?.slice(0, 10) ?? "unknown";
  return job.dateFidelity === "reported" ? `${day} (reported by page)` : day;
}

/**
 * How much to trust the date, drawn rather than described: a filled square for
 * a date the source published, a hollow one for a date the page merely claims,
 * a slash for none. The written label stays beside it — the mark reinforces the
 * words, it does not replace them.
 */
function FidelityMark({ fidelity }: { fidelity: RankedResult["dateFidelity"] }) {
  if (fidelity === "none") {
    return (
      <svg viewBox="0 0 8 8" className="size-2 shrink-0" aria-hidden>
        <path d="M1 7L7 1" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 8 8" className="size-2 shrink-0" aria-hidden>
      <rect
        x="1"
        y="1"
        width="6"
        height="6"
        fill={fidelity === "true" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/**
 * Five steps, one per 20 points, lit from the bottom. Only rendered for a job
 * that was actually ranked — an unlit meter would read as a score of zero.
 */
function Meter({ score }: { score: number }) {
  const lit = Math.max(1, Math.min(5, Math.ceil(score / 20)));
  return (
    <div className="flex flex-col-reverse gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={`h-[5px] w-4 ${step < lit ? "meter-step-lit" : "meter-step"}`}
        />
      ))}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Ranking and web search run through the local claude binary on your Claude Code subscription. No OpenAI key involved.",
  openai: "Ranking and web search run against the OpenAI API with OPENAI_API_KEY.",
};

const TIER_LABELS: Record<string, string> = {
  strong: "strong match",
  stretch: "stretch",
  skip: "skip",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

export function FetchPanel({
  profileId,
  initialResults = [],
  defaultTimeFrameDays = 7,
  searchProfile,
  provider = "openai",
}: {
  profileId: string;
  /** The stored board, so the page has content before any fetch runs. */
  initialResults?: RankedResult[];
  /** The profile's own cron window, so a manual fetch starts where the board is. */
  defaultTimeFrameDays?: number | null;
  /**
   * Title and stack keywords for the manual LinkedIn/Naukri searches. Omit to
   * hide those links — they are only useful prefilled.
   */
  searchProfile?: SearchProfile;
  /**
   * Which model backs this fetch. Shown rather than hidden because the two
   * bill differently — "claude" spends the local Claude Code subscription and
   * only works while the dev server runs on a machine with the binary.
   */
  provider?: "openai" | "claude";
}) {
  const [timeFrameDays, setTimeFrameDays] = useState<number | null>(
    defaultTimeFrameDays,
  );
  const [rankLimit, setRankLimit] = useState<number | null>(25);
  const [skipModelSources, setSkipModelSources] = useState(true);
  const [maxBoards, setMaxBoards] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<RankedResult[]>(initialResults);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setLog([]);
    // The board stays on screen, dimmed and labelled, until the new one lands.
    // Clearing it here left the page blank for minutes at a time.

    try {
      const response = await fetch("/api/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          timeFrameDays,
          rankLimit,
          maxBoards,
          skipModelSources,
        }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
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
    } finally {
      setRunning(false);
    }
  }

  function hide(slugKey: string) {
    setResults((r) => r.filter((j) => j.key.slugKey !== slugKey));
  }

  const ranked = results.filter((job) => job.rank !== null).length;

  return (
    <div className="space-y-5">
      <section className="sheet p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Posted within">
            <select
              className="select"
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
          </Field>

          <Field label="Sources">
            <select
              className="select"
              value={String(skipModelSources)}
              onChange={(e) => setSkipModelSources(e.target.value === "true")}
            >
              {SOURCE_MODES.map((m) => (
                <option key={m.label} value={String(m.skipModelSources)}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Company boards">
            <select
              className="select"
              value={String(maxBoards)}
              onChange={(e) =>
                setMaxBoards(e.target.value === "null" ? null : Number(e.target.value))
              }
            >
              {BOARD_CAPS.map((b) => (
                <option key={b.label} value={String(b.value)}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="How many to score">
            <select
              className="select"
              value={String(rankLimit)}
              onChange={(e) =>
                setRankLimit(e.target.value === "null" ? null : Number(e.target.value))
              }
            >
              {RANK_LIMITS.map((r) => (
                <option key={r.label} value={String(r.value)}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-4">
          <button
            className={`btn btn-primary ${running ? "scanning" : ""}`}
            onClick={run}
            disabled={running}
          >
            {running ? "Fetching…" : "Fetch latest jobs"}
          </button>
          <span className="font-mono text-[11px] text-ink-soft">
            {estimate(skipModelSources, maxBoards, rankLimit)} at these settings
          </span>
          <span className="pill ml-auto" title={PROVIDER_LABELS[provider]}>
            {provider === "claude" ? "claude cli" : "openai api"}
          </span>
        </div>
      </section>

      {searchProfile && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="eyebrow">Search by hand</span>
          <a
            className="link"
            href={linkedInJobsUrl(searchProfile)}
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn Jobs (India)
          </a>
          <a
            className="link"
            href={naukriJobsUrl(searchProfile)}
            target="_blank"
            rel="noreferrer"
          >
            Naukri (India, fresher)
          </a>
          <span className="text-[12px] text-ink-soft">
            Prefilled searches you browse yourself — nothing here reaches the board.
          </span>
        </div>
      )}

      {log.length > 0 && (
        <ol className="sheet space-y-1 p-3 font-mono text-[12px] leading-relaxed">
          {log.map((line, i) => (
            <li
              key={`${i}-${line}`}
              className={line.startsWith("error:") ? "text-ember" : "text-ink-soft"}
            >
              <span className="mr-2 text-rule">{String(i + 1).padStart(2, "0")}</span>
              {line}
            </li>
          ))}
        </ol>
      )}

      {results.length > 0 && (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="eyebrow">
            {running
              ? "Previous board — this fetch has not landed yet"
              : `Board · ${results.length} open · ${ranked} scored`}
          </h2>
        </div>
      )}

      <ul className={`space-y-2 ${running ? "opacity-45" : ""}`}>
        {results.map((job, i) => (
          <li
            key={job.key.slugKey}
            className="sheet row-in flex gap-4 p-4"
            style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}
          >
            <div className="flex w-4 shrink-0 flex-col items-center gap-2 pt-1">
              {job.rank ? (
                <Meter score={job.rank.score} />
              ) : (
                <span className="h-[37px] w-px bg-rule-soft" aria-hidden />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] leading-snug font-semibold">
                  {job.title}
                  <span className="text-ink-soft"> · {job.company}</span>
                </h3>
                {job.rank ? (
                  <span className="font-mono text-[15px] font-medium tabular-nums">
                    {job.rank.score}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-ink-soft">not scored</span>
                )}
              </div>

              {job.rank?.why && (
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                  {job.rank.why}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-soft">
                <span>{job.locationRaw}</span>
                <span className="text-rule">/</span>
                <span>{job.sourceKind}</span>
                <span className="text-rule">/</span>
                <span className="inline-flex items-center gap-1.5">
                  <FidelityMark fidelity={job.dateFidelity} />
                  {dateLabel(job)}
                </span>
              </div>

              {(job.rank?.tier || job.rank?.sponsorshipGate) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {job.rank?.tier && TIER_LABELS[job.rank.tier] && (
                    <span
                      className={`pill ${job.rank.tier === "strong" ? "pill-go" : ""}`}
                    >
                      {TIER_LABELS[job.rank.tier]}
                    </span>
                  )}
                  {job.rank?.sponsorshipGate && (
                    <span className="pill pill-warn">may need work authorization</span>
                  )}
                </div>
              )}

              {/* Red flags come back as whole sentences, so they read as prose.
                  Setting them in a pill turned a caveat into shouting. */}
              {job.rank?.redFlags.length ? (
                <ul className="mt-2 space-y-1">
                  {job.rank.redFlags.map((flag) => (
                    <li
                      key={flag}
                      className="flex gap-2 text-[12px] leading-relaxed text-ink-soft"
                    >
                      <span className="text-ember" aria-hidden>
                        &#9650;
                      </span>
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await queueApply({
                      profileId,
                      atsKey: job.key.atsKey,
                      slugKey: job.key.slugKey,
                      company: job.company,
                      title: job.title,
                      applyUrl: job.applyUrl,
                    });
                    hide(job.key.slugKey);
                  }}
                >
                  Apply
                </button>
                <button
                  className="btn btn-quiet"
                  onClick={async () => {
                    await dismissJob({
                      profileId,
                      atsKey: job.key.atsKey,
                      slugKey: job.key.slugKey,
                      company: job.company,
                      title: job.title,
                      applyUrl: job.applyUrl,
                    });
                    hide(job.key.slugKey);
                  }}
                >
                  Dismiss
                </button>
                <a
                  className="link ml-1 text-[13px]"
                  href={job.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open posting
                </a>
                <a
                  className="link text-[13px]"
                  href={linkedInPeopleUrl(job.company)}
                  target="_blank"
                  rel="noreferrer"
                  title={`Find people at ${job.company} on LinkedIn to connect with`}
                >
                  People at {job.company}
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
