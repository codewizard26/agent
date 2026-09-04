import { createDb, saveFeed } from "@job-agent/db";
import { runFetch } from "@job-agent/core";
import { prepareFetch, toFeedRows } from "../../../lib/feed-fetch";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const {
    profileId,
    timeFrameDays,
    rankLimit = null,
    maxBoards = null,
    skipModelSources = false,
  } = (await request.json()) as {
    profileId: string;
    timeFrameDays: number | null;
    rankLimit?: number | null;
    maxBoards?: number | null;
    skipModelSources?: boolean;
  };

  const db = createDb();
  const prepared = await prepareFetch(db, profileId, {
    timeFrameDays,
    rankLimit,
    maxBoards,
    skipModelSources,
  });
  if (!prepared) return new Response("profile not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runFetch({
          ...prepared,
          timeFrameDays,
          rankLimit: rankLimit ?? undefined,
        })) {
          // An on-demand fetch writes the board too, so what the user just
          // looked at is still there after a reload.
          if (event.type === "done") {
            await saveFeed(db, profileId, toFeedRows(event.results));
          }
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
