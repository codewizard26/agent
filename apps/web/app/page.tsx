import Link from "next/link";
import { createDb, profiles, listFeed } from "@job-agent/db";

export const dynamic = "force-dynamic";

/**
 * Every scored job on one board, plotted at its own score.
 *
 * A list can only show the top of a run. The shape underneath it — whether the
 * eighties are a cluster or a lone spike above a long tail in the thirties — is
 * what says how the morning actually went, and it is the one thing on this page
 * worth spending colour on.
 */
function Spine({ scores }: { scores: number[] }) {
  if (scores.length === 0) return null;
  return (
    <div className="relative h-9" aria-hidden>
      <div className="spine-axis absolute inset-x-0 bottom-3 h-px" />
      {scores.map((score, i) => (
        <span
          key={i}
          className="spine-tick absolute bottom-3 w-px"
          style={{
            left: `${score}%`,
            height: `${8 + (score / 100) * 20}px`,
            backgroundColor: score >= 70 ? "var(--color-signal)" : "var(--color-ink-soft)",
            opacity: score >= 70 ? 0.95 : 0.4,
          }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-0 flex justify-between text-[11px] text-ink-soft">
        <span className="num">0</span>
        <span className="num">100</span>
      </div>
    </div>
  );
}

function relativeTime(then: Date | undefined): string {
  if (!then) return "not fetched yet";
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function Home() {
  const db = createDb();
  const rows = await db.select().from(profiles);

  const boards = await Promise.all(
    rows.map(async (profile) => {
      const feed = await listFeed(db, profile.id);
      const scored = feed.filter((job) => job.score !== null);
      return {
        profile,
        total: feed.length,
        scores: scored.map((job) => job.score as number),
        strong: scored.filter((job) => job.tier === "strong").length,
        top: scored.slice(0, 3),
        lastSeen: feed
          .map((row) => row.lastSeenAt)
          .sort((a, b) => b.getTime() - a.getTime())[0],
      };
    }),
  );

  const onBoard = boards.reduce((sum, b) => sum + b.total, 0);
  const strong = boards.reduce((sum, b) => sum + b.strong, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
      {rows.length === 0 ? (
        <section>
          <h1 className="display text-5xl font-extrabold">Nobody is hunting yet</h1>
          <p className="mt-4 max-w-[54ch] text-[15px] leading-relaxed text-ink-soft">
            A profile holds one person&rsquo;s resume, the seniority they are
            aiming at and the regions they will work in. Create the first one and
            the board fills on the next fetch.
          </p>
          <code className="mt-6 inline-block rounded border border-rule bg-card px-3 py-2 font-mono text-[12px]">
            pnpm --filter @job-agent/web add-profile --profile ./profiles/you.json
          </code>
        </section>
      ) : (
        <>
          <section>
            <h1 className="display text-[3.25rem] font-extrabold leading-[0.98] sm:text-[4rem]">
              <span className="num tabular-nums">{onBoard}</span> postings
              <br />
              survived the filter
            </h1>
            <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
              Scored against {boards.length}{" "}
              {boards.length === 1 ? "resume" : "resumes"} across company boards,
              India-native sites and a web search that reaches LinkedIn and
              Naukri. {strong > 0 ? `${strong} came back a strong match.` : ""}
            </p>
          </section>

          <div className="mt-14 space-y-12">
            {boards.map(({ profile, total, scores, top, lastSeen }) => (
              <section key={profile.id} className="border-t border-rule pt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h2 className="display text-3xl font-bold">
                    <Link href={`/profiles/${profile.id}`} className="hover:text-signal">
                      {profile.name}
                    </Link>
                  </h2>
                  <p className="text-[13px] text-ink-soft">
                    <span className="num">{total}</span> on the board, refreshed{" "}
                    {relativeTime(lastSeen)}
                  </p>
                </div>

                <div className="mt-5">
                  <Spine scores={scores} />
                </div>

                {top.length > 0 ? (
                  <ol className="mt-5">
                    {top.map((job) => (
                      <li
                        key={job.slugKey}
                        className="flex items-baseline gap-4 border-b border-rule-soft py-2.5 last:border-b-0"
                      >
                        <span className="num w-8 shrink-0 text-[15px] font-medium">
                          {job.score}
                        </span>
                        <a
                          className="link min-w-0 flex-1 truncate text-[14px]"
                          href={job.applyUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {job.title}
                        </a>
                        <span className="shrink-0 text-[13px] text-ink-soft">
                          {job.company}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-5 text-[14px] text-ink-soft">
                    Nothing scored yet. Open the board and fetch.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link href={`/profiles/${profile.id}`} className="btn btn-primary">
                    Open board
                  </Link>
                  <Link href={`/answers/${profile.id}`} className="btn btn-quiet">
                    Application answers
                  </Link>
                  {!profile.autoSubmitAuthorized && (
                    <span className="text-[13px] text-ink-soft">
                      Applications stop for review before submitting
                    </span>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
