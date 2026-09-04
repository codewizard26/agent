"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { startApplying } from "../app/actions";

/**
 * Runs the queue. Apply builds the list; this is the moment a real browser
 * opens and starts working through it, one job at a time.
 */
export function StartApplying({
  profileId,
  heldCount,
}: {
  profileId: string;
  heldCount: number;
}) {
  const [pending, start] = useTransition();
  const [released, setReleased] = useState<number | null>(null);
  const router = useRouter();

  if (heldCount === 0 && released === null) return null;

  return (
    <div className="sheet mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="max-w-[58ch]">
        <p className="text-[14px] font-semibold">
          {released !== null
            ? `Working through ${released} ${released === 1 ? "job" : "jobs"}`
            : `${heldCount} ${heldCount === 1 ? "job is" : "jobs are"} ready to apply to`}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          {released !== null
            ? "A browser is open and working through them one at a time. Anything it cannot answer stops and waits for you."
            : "Nothing opens until you start. A browser then works through them one at a time, in the order you added them."}
        </p>
      </div>
      <button
        className="btn btn-go shrink-0"
        disabled={pending || heldCount === 0}
        onClick={() =>
          start(async () => {
            setReleased(await startApplying(profileId));
            router.refresh();
          })
        }
      >
        {pending ? "Starting…" : "Start applying"}
      </button>
    </div>
  );
}
