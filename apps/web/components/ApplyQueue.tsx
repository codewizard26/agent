"use client";

import { markApplied } from "../app/actions";

interface Task {
  id: string;
  profileId: string;
  atsKey: string | null;
  slugKey: string;
  company: string;
  title: string;
  applyUrl: string;
  status: string;
  blockedFields: string[] | null;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "starting",
  opening: "opening the posting",
  filling: "filling the form",
  awaiting_human: "needs you",
  failed: "failed",
};

export function ApplyQueue({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;

  // Applying opens a real browser and takes half a minute. These rows are that
  // work in progress — an application that has finished leaves the list, so
  // anything still sitting at "starting" means no browser is driving it.
  const stalled = tasks.every((task) => task.status === "queued");

  return (
    <section className="mt-12">
      <h2 className="label">{tasks.length} in progress</h2>
      {stalled && (
        <p className="mt-2 max-w-[62ch] text-[13px] text-ink-soft">
          Nothing is being filled in. Applying drives a real browser from a
          second process, and it is not running — start both together with{" "}
          <code className="font-mono text-[12px]">pnpm dev</code> from the repo
          root.
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {tasks.map((task) => {
          const attention = task.status === "awaiting_human" || task.status === "failed";
          return (
            <li key={task.id} className="sheet p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] leading-snug font-semibold">
                  {task.title}
                  <span className="text-ink-soft"> · {task.company}</span>
                </span>
                <span className={`pill shrink-0 ${attention ? "pill-warn" : ""}`}>
                  {STATUS_LABELS[task.status] ?? task.status}
                </span>
              </div>
              {task.blockedFields?.length ? (
                <p className="mt-2 text-[13px] text-ember">
                  Fill these yourself: {task.blockedFields.join("; ")}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  className="link text-[13px]"
                  href={task.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the application
                </a>
                {task.status === "awaiting_human" && (
                  <button
                    className="btn btn-go ml-auto"
                    onClick={() =>
                      markApplied({
                        taskId: task.id,
                        profileId: task.profileId,
                        atsKey: task.atsKey,
                        slugKey: task.slugKey,
                        company: task.company,
                        title: task.title,
                        applyUrl: task.applyUrl,
                      })
                    }
                  >
                    I submitted this
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
