"use client";

import { useState } from "react";
import { saveAnswer } from "../app/actions";

interface Row {
  id: string;
  key: string;
  label: string;
  value: string | null;
}

export function AnswerBankForm({ rows }: { rows: Row[] }) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [blank, setBlank] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((row) => [row.id, !row.value])),
  );

  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.id} className="grid gap-1.5">
          <label
            className="flex items-center gap-2 text-[13px] font-semibold"
            htmlFor={row.id}
          >
            {row.label}
            {blank[row.id] && <span className="pill pill-warn">blank</span>}
            {saved[row.id] && <span className="pill pill-go">saved</span>}
          </label>
          <input
            id={row.id}
            className="input"
            defaultValue={row.value ?? ""}
            onBlur={async (e) => {
              const value = e.target.value;
              await saveAnswer({ id: row.id, value });
              setBlank((b) => ({ ...b, [row.id]: value.trim() === "" }));
              setSaved((s) => ({ ...s, [row.id]: true }));
              // The confirmation is about the keystroke that just happened, so
              // it clears itself rather than sitting there for the whole session.
              setTimeout(() => setSaved((s) => ({ ...s, [row.id]: false })), 2000);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
