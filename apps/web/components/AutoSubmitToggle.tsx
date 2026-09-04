"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAutoSubmit } from "../app/actions";

/**
 * The consent gate for sending applications without a human in the loop.
 *
 * Written as a plain statement of what will happen rather than a feature name,
 * because the consequence — a real application, under this person's name, in an
 * employer's system — is not recoverable and the copy is the last thing anyone
 * reads before it becomes possible.
 */
export function AutoSubmitToggle({
  profileId,
  authorized,
}: {
  profileId: string;
  authorized: boolean;
}) {
  const [on, setOn] = useState(authorized);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="sheet mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="max-w-[60ch]">
        <p className="text-[14px] font-semibold">
          {on ? "Applications are sent automatically" : "Applications stop for your review"}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          {on
            ? "The worker fills each form and presses submit. It still stops and hands you the browser whenever a question has no answer in the answer bank, or the page does not confirm the send."
            : "The worker fills each form and hands you the browser. Nothing is sent until you press submit yourself."}
        </p>
      </div>
      <button
        className={`btn shrink-0 ${on ? "btn-quiet" : "btn-go"}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setAutoSubmit({ profileId, authorized: !on });
            setOn(!on);
            router.refresh();
          })
        }
      >
        {on ? "Stop sending automatically" : "Send automatically"}
      </button>
    </div>
  );
}
