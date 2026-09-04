import Link from "next/link";
import { createDb, profiles } from "@job-agent/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = createDb();
  const rows = await db.select().from(profiles);

  return (
    <main className="mx-auto max-w-5xl px-6 pt-12">
      <span className="eyebrow">Who is hunting</span>
      <h1 className="display mt-1 text-4xl font-extrabold sm:text-5xl">Profiles</h1>
      <p className="mt-3 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        Each profile keeps its own board, its own search window and its own answer
        bank. Open one to fetch, score and triage today&rsquo;s postings.
      </p>

      {rows.length === 0 ? (
        <div className="sheet mt-8 p-6">
          <h2 className="text-[15px] font-semibold">No profiles yet</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            Create the first one, then come back and fetch a board.
          </p>
          <code className="mt-3 inline-block rounded border border-rule bg-paper px-2.5 py-1.5 font-mono text-[12px]">
            pnpm --filter @job-agent/web seed
          </code>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id} className="sheet group flex flex-col p-5">
              <Link
                href={`/profiles/${p.id}`}
                className="display text-2xl font-bold group-hover:text-signal"
              >
                {p.name}
              </Link>
              <p className="mt-1 font-mono text-[12px] text-ink-soft">{p.ownerEmail}</p>
              <div className="mt-4 flex items-center gap-2 border-t border-rule-soft pt-3">
                <Link href={`/profiles/${p.id}`} className="btn btn-primary">
                  Open board
                </Link>
                <Link href={`/answers/${p.id}`} className="btn btn-quiet">
                  Answers
                </Link>
                {!p.autoSubmitAuthorized && (
                  <span className="pill ml-auto">assisted apply</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
