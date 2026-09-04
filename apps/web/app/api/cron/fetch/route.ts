import { createDb, profiles, saveFeed } from "@job-agent/db";
import { runFetch } from "@job-agent/core";
import { CRON_PRESET, prepareFetch, toFeedRows } from "../../../../lib/feed-fetch";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Refreshes every profile's board. Vercel calls this on the schedule in
 * `vercel.json`; run it by hand with
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/fetch
 * since Vercel crons do not fire against a local dev server.
 */
export async function GET(request: Request): Promise<Response> {
  // Every call to this route spends money on ranking, so deployed it must never
  // be open. Locally an unset secret is a convenience; on a deploy it is refused
  // rather than quietly serving a public endpoint that bills the user.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.VERCEL) {
      return new Response("CRON_SECRET is not set", { status: 500 });
    }
  } else if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const db = createDb();
  const rows = await db.select().from(profiles);
  const report: Record<string, string> = {};

  // Profiles run in parallel. Sequentially, two profiles took 3m03s against the
  // 300s ceiling — a third would have exceeded it, because each profile fetches
  // the same 58 sources over again. Parallelism buys headroom; the real fix, if
  // this ever grows past a handful of profiles, is fetching once and filtering
  // per profile.
  await Promise.all(
    rows.map(async (profile) => {
      try {
        // Each profile brings its own window; everything else is the shared,
        // deliberately bounded preset.
        const timeFrameDays =
          profile.feedTimeFrameDays === undefined
            ? CRON_PRESET.timeFrameDays
            : profile.feedTimeFrameDays;
        const prepared = await prepareFetch(db, profile.id, {
          ...CRON_PRESET,
          timeFrameDays,
        });
        if (!prepared) return;

        for await (const event of runFetch({
          ...prepared,
          timeFrameDays,
          rankLimit: CRON_PRESET.rankLimit ?? undefined,
        })) {
          if (event.type === "done") {
            await saveFeed(db, profile.id, toFeedRows(event.results));
            report[profile.name] = `${event.results.length} jobs`;
          } else if (event.type === "error") {
            report[profile.name] = `error: ${event.message}`;
          }
        }
      } catch (error) {
        // One profile failing must not cost the others their refresh.
        report[profile.name] =
          `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }),
  );

  return Response.json({ ranAt: new Date().toISOString(), report });
}
