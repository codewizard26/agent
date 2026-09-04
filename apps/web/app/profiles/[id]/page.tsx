import Link from "next/link";
import { eq } from "drizzle-orm";
import { createDb, profiles, listFeed } from "@job-agent/db";
import { resolveLlmProvider } from "@job-agent/core";
import { canApplyHere } from "../../../lib/apply-availability";
import { FetchPanel } from "../../../components/FetchPanel";
import { ApplyQueue } from "../../../components/ApplyQueue";
import { AutoSubmitToggle } from "../../../components/AutoSubmitToggle";
import { listApplyTasks } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createDb();
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, id));
  if (!profile) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="display text-3xl font-extrabold">No such profile</h1>
        <p className="mt-2 text-sm text-ink-soft">
          The link points at a profile that is not in the database.{" "}
          <Link className="link" href="/">
            Back to profiles
          </Link>
          .
        </p>
      </main>
    );
  }

  const [tasks, feed] = await Promise.all([listApplyTasks(id), listFeed(db, id)]);

  // The board renders from storage, so it is there instantly on load. A fetch
  // replaces it in place; the nightly cron refills it in the background.
  const results = feed.map((row) => ({
    key: { atsKey: row.atsKey, slugKey: row.slugKey },
    company: row.company,
    title: row.title,
    locationRaw: row.locationRaw,
    applyUrl: row.applyUrl,
    sourceKind: row.sourceKind,
    postedAt: row.postedAt?.toISOString() ?? null,
    dateFidelity: row.dateFidelity as "true" | "reported" | "none",
    rank:
      row.score === null
        ? null
        : {
            score: row.score,
            tier: row.tier ?? "",
            why: row.why ?? "",
            redFlags: (row.redFlags as string[] | null) ?? [],
            sponsorshipGate: row.sponsorshipGate,
          },
  }));

  const window =
    profile.feedTimeFrameDays === null ? "any" : `${profile.feedTimeFrameDays ?? 7} days`;

  // Keywords for the manual LinkedIn/Naukri searches. Same parsed profile the
  // filter uses, so the prefilled search matches what the board is scored on.
  const parsed = profile.parsedProfile as {
    titlesAccept?: string[];
    coreStack?: string[];
  } | null;
  // Undefined when there is nothing to prefill — a keyword-less LinkedIn or
  // Naukri link is just their homepage with a location filter, so the panel
  // hides the links rather than offering an empty search.
  const titlesAccept = parsed?.titlesAccept ?? [];
  const coreStack = parsed?.coreStack ?? [];
  const searchProfile =
    titlesAccept.length > 0 || coreStack.length > 0
      ? { titlesAccept, coreStack }
      : undefined;

  const lastSeen = feed
    .map((r) => r.lastSeenAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <main className="mx-auto max-w-5xl px-6 pt-10">
      <div className="mb-8">
        <span className="label">Profile</span>
        <h1 className="display mt-1 text-4xl font-extrabold sm:text-5xl">
          {profile.name}
        </h1>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-4 font-mono text-[12px] sm:grid-cols-4">
          <div>
            <dt className="text-ink-soft">On the board</dt>
            <dd className="mt-0.5 text-[15px] tabular-nums">{results.length}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Window</dt>
            <dd className="mt-0.5 text-[15px]">{window}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Refreshed</dt>
            <dd className="mt-0.5 text-[15px]">
              {lastSeen?.toLocaleString() ?? "never"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Next refill</dt>
            <dd className="mt-0.5 text-[15px]">nightly</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 text-[13px]">
          <Link className="link" href={`/answers/${id}`}>
            Edit application answers
          </Link>
          <Link className="link" href="/">
            All profiles
          </Link>
        </div>
      </div>

      {results.length === 0 && (
        <p className="sheet mb-5 p-4 text-[13px] text-ink-soft">
          Nothing on the board yet. Fetch now, or leave it — the next refill runs
          overnight.
        </p>
      )}

      <FetchPanel
        profileId={id}
        initialResults={results}
        defaultTimeFrameDays={profile.feedTimeFrameDays ?? null}
        searchProfile={searchProfile}
        provider={resolveLlmProvider()}
        canApply={canApplyHere()}
      />
      {canApplyHere() && <AutoSubmitToggle
        profileId={id}
        authorized={profile.autoSubmitAuthorized}
      />}
      <ApplyQueue tasks={tasks as never} canApply={canApplyHere()} />
    </main>
  );
}
