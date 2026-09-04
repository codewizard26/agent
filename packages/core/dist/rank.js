import { z } from "zod";
const RankedJobSchema = z.object({
    jobKey: z.string(),
    score: z.number(),
    tier: z.enum(["strong", "stretch", "skip"]),
    why: z.string(),
    redFlags: z.array(z.string()),
    sponsorshipGate: z.boolean(),
    indiaEligible: z.boolean(),
    timezoneGate: z.string().nullable(),
    resumeHooks: z.array(z.string()),
});
const BatchSchema = z.object({ rankings: z.array(RankedJobSchema) });
/**
 * Exported so the candidates CLI can write the exact same text `rankJobs`
 * would send. If ranking happens in a Claude Code conversation instead of
 * through the API, both paths see identical input and cannot drift.
 */
export function profileBrief(profile) {
    return [
        `Name: ${profile.fullName}`,
        `Years of experience: ${profile.yearsExperience}`,
        `Target seniority: ${profile.seniorityBands.join(", ")}`,
        `Core stack: ${profile.coreStack.join(", ")}`,
        `Bonus differentiators: ${profile.bonusStack.join(", ") || "none"}`,
    ].join("\n");
}
export function jobBrief(job, descriptionChars = 2000) {
    return [
        `jobKey: ${job.key.slugKey}`,
        `Title: ${job.title}`,
        `Company: ${job.company}`,
        `Location: ${job.locationRaw}${job.remote ? " (remote)" : ""}`,
        `Hiring locations: ${job.locationRestrictions.join(", ") || "not stated"}`,
        `Description: ${job.descriptionText.slice(0, descriptionChars)}`,
    ].join("\n");
}
/**
 * Scores jobs against a profile. Batches are independent: a failed batch loses
 * only its own jobs, and those simply render unranked rather than disappearing.
 * Returns a map keyed by slugKey.
 */
export async function rankJobs(jobs, profile, client, batchSize = 20, 
/**
 * Measured 2026-08-29 on the same 10 jobs: low 35s, medium 66s, high 113s,
 * with low and medium agreeing within ~2 points per job. Ranking is ~95% of
 * fetch wall clock, so this single word outweighs every source-count knob.
 */
effort = "medium") {
    const out = new Map();
    if (jobs.length === 0)
        return out;
    const batches = [];
    for (let i = 0; i < jobs.length; i += batchSize) {
        batches.push(jobs.slice(i, i + batchSize));
    }
    const settled = await Promise.allSettled(batches.map(async (batch) => {
        const parsed = await client.parse({
            schema: BatchSchema,
            schemaName: "job_rankings",
            tier: "rank",
            effort,
            // Reasoning tokens come out of this budget, so it is sized well above
            // what the rankings themselves need. A response that runs out returns
            // no object at all rather than a short one.
            maxOutputTokens: 48000,
            system: "You rank job postings against one candidate's profile. Score 0-100 on " +
                "fit. Set sponsorshipGate true when the posting implies work " +
                "authorization the candidate does not have — the language for this is " +
                "varied, so read for intent, not keywords. Bonus differentiators should " +
                "raise a score but never be treated as a requirement.\n\n" +
                "The candidate is based in India. Set indiaEligible true when someone " +
                "living in India could hold this role — an Indian office, a role open " +
                "worldwide, or remote work with no stated country restriction. Set it " +
                "false only when the posting positively excludes India. Treat IST " +
                "overlap and a stated willingness to hire in India as positives that " +
                "raise the score. Return one entry per job, echoing its jobKey exactly.",
            prompt: `CANDIDATE\n${profileBrief(profile)}\n\nJOBS\n${batch
                .map((job) => jobBrief(job))
                .join("\n\n---\n\n")}`,
        });
        return parsed?.rankings ?? [];
    }));
    // A rejected batch used to vanish silently, which made a systematic failure
    // look like "the model declined to rank anything". Failures are counted and
    // reported so an unranked feed is distinguishable from a broken one.
    const failures = [];
    for (const result of settled) {
        if (result.status !== "fulfilled") {
            failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
            continue;
        }
        for (const ranking of result.value)
            out.set(ranking.jobKey, ranking);
    }
    if (failures.length > 0) {
        console.warn(`ranking: ${failures.length}/${batches.length} batches failed — ` +
            `${out.size}/${jobs.length} jobs ranked. First error: ${failures[0]}`);
    }
    return out;
}
