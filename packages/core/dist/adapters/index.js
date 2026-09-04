import { parse as parseYaml } from "yaml";
export function loadBoards(yamlText) {
    const raw = (parseYaml(yamlText) ?? {});
    return {
        greenhouse: raw.greenhouse ?? [],
        lever: raw.lever ?? [],
        ashby: raw.ashby ?? [],
    };
}
/** ATS-direct postings win over aggregator reposts of the same role. */
function isAtsDirect(job) {
    return job.atsKind !== null;
}
export function dedupeJobs(jobs) {
    const bySlug = new Map();
    for (const job of jobs) {
        const existing = bySlug.get(job.key.slugKey);
        if (!existing) {
            bySlug.set(job.key.slugKey, job);
            continue;
        }
        // Prefer ATS-direct; among equals, prefer the one carrying a description.
        const replace = (isAtsDirect(job) && !isAtsDirect(existing)) ||
            (isAtsDirect(job) === isAtsDirect(existing) &&
                job.descriptionText.length > existing.descriptionText.length);
        if (replace)
            bySlug.set(job.key.slugKey, job);
    }
    return [...bySlug.values()];
}
/**
 * Runs fn over items with at most `limit` in flight. Never throws — every
 * outcome comes back as a settled result so one dead board cannot abort a fetch.
 */
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            try {
                results[index] = { status: "fulfilled", value: await fn(items[index]) };
            }
            catch (reason) {
                results[index] = { status: "rejected", reason };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}
