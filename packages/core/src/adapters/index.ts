import { parse as parseYaml } from "yaml";
import type { NormalizedJob } from "../types.js";

export interface BoardsConfig {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
}

export function loadBoards(yamlText: string): BoardsConfig {
  const raw = (parseYaml(yamlText) ?? {}) as Partial<BoardsConfig>;
  return {
    greenhouse: raw.greenhouse ?? [],
    lever: raw.lever ?? [],
    ashby: raw.ashby ?? [],
  };
}

/** ATS-direct postings win over aggregator reposts of the same role. */
function isAtsDirect(job: NormalizedJob): boolean {
  return job.atsKind !== null;
}

export function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const bySlug = new Map<string, NormalizedJob>();
  for (const job of jobs) {
    const existing = bySlug.get(job.key.slugKey);
    if (!existing) {
      bySlug.set(job.key.slugKey, job);
      continue;
    }
    // Prefer ATS-direct; among equals, prefer the one carrying a description.
    const replace =
      (isAtsDirect(job) && !isAtsDirect(existing)) ||
      (isAtsDirect(job) === isAtsDirect(existing) &&
        job.descriptionText.length > existing.descriptionText.length);
    if (replace) bySlug.set(job.key.slugKey, job);
  }
  return [...bySlug.values()];
}

/**
 * Runs fn over items with at most `limit` in flight. Never throws — every
 * outcome comes back as a settled result so one dead board cannot abort a fetch.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
