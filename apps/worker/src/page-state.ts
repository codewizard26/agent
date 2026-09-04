/**
 * What the worker actually landed on.
 *
 * A board row can outlive the posting behind it: boards delete filled roles and
 * the feed keeps the row until the next fetch. Without this the worker treated
 * a "job not found" page as a form, harvested nothing, and sat there — the task
 * neither finished nor failed.
 */
export interface PageFacts {
  /** HTTP status of the final response, after redirects. Null when unknown. */
  status: number | null;
  text: string;
  /** Fields harvestFields could see. Zero means nothing to fill. */
  fieldCount: number;
}

export type PageKind =
  /** A real application form. */
  | { kind: "form" }
  /** The posting is gone — removed, filled, or a dead link. */
  | { kind: "gone"; reason: string }
  /** Live, but not an application: a listing or a search page. */
  | { kind: "no-form" };

const GONE_PHRASES = [
  /no longer (available|accepting|open)/i,
  /job not found/i,
  /position has been filled/i,
  /has been removed/i,
  /this (job|role|position|posting) is closed/i,
  /(job|posting) (you are looking for|does not exist)/i,
  /404/,
];

export function classifyPage(facts: PageFacts): PageKind {
  if (facts.status !== null && facts.status >= 400) {
    return { kind: "gone", reason: `HTTP ${facts.status}` };
  }

  // Only consult the wording when there is no form. A live posting can say
  // "close" or "filled" anywhere in its description, and a page with fields to
  // fill is an application whatever its prose says.
  if (facts.fieldCount === 0) {
    const phrase = GONE_PHRASES.find((p) => p.test(facts.text));
    if (phrase) return { kind: "gone", reason: `page says: ${phrase.source}` };
    return { kind: "no-form" };
  }

  return { kind: "form" };
}

/**
 * A ceiling on one whole task.
 *
 * Playwright's timeouts bound a navigation or a click, not a task that wanders:
 * a redirect chain, a consent wall, a page that never settles. Without this the
 * queue stops at the first job that hangs and nothing after it ever runs.
 */
export async function withDeadline<T>(
  work: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: gave up after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
