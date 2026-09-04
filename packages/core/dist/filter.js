import { isIndiaExcluded, isIndiaLocatedStrict } from "./india.js";
import { isEngineeringRole } from "./roles.js";
import { ledgerMatchKeys } from "./job-key.js";
/** Phrases that gate a posting to local work authorization. */
const AUTHORIZATION_GATES = [
    /must be (legally )?authoriz(ed|ation) to work in/i,
    /must reside in/i,
    /us citizens? only/i,
    /u\.s\. citizens? only/i,
    /requires? (a )?security clearance/i,
    /no (visa )?sponsorship/i,
    /work authorization required/i,
];
/** Timezone demands incompatible with IST. */
const TIMEZONE_GATES = [
    /\bpst\b.{0,20}(core|overlap|hours)/i,
    /(core|overlap|hours).{0,20}\bpst\b/i,
    /must overlap .{0,20}(pacific|eastern) (time|hours)/i,
];
function haystack(job) {
    return `${job.title} ${job.locationRaw} ${job.descriptionText}`;
}
function countStackMatches(job, stack) {
    const text = haystack(job).toLowerCase();
    return stack.filter((tech) => text.includes(tech.toLowerCase())).length;
}
function matchesAny(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
}
export function filterJobs(jobs, profile, posture, opts) {
    const passed = [];
    const rejected = [];
    for (const job of jobs) {
        const reject = (reason) => rejected.push({ job, reason });
        // Ledger first — it is the cheapest check and the user's explicit choice.
        if (ledgerMatchKeys(job.key).some((k) => opts.ledgerKeys.has(k))) {
            reject("already applied or dismissed");
            continue;
        }
        if (opts.timeFrameDays !== null) {
            if (!job.postedAt) {
                reject(`no post date (${job.sourceKind} exposes none)`);
                continue;
            }
            const ageDays = (opts.now.getTime() - job.postedAt.getTime()) / 86_400_000;
            if (ageDays > opts.timeFrameDays) {
                reject(`outside time frame (${Math.round(ageDays)}d old)`);
                continue;
            }
        }
        // Seniority — derived from the profile's own bands, never a fixed list.
        if (matchesAny(job.title, profile.titlesReject)) {
            reject("seniority band mismatch");
            continue;
        }
        // Role family. The stack check below reads the whole description, so a
        // recruiter or sales posting at a React shop clears it on the employer's
        // own boilerplate. The title is the field that does not lie, and this is
        // the gate that keeps non-engineering roles out of an engineer's feed.
        if (!isEngineeringRole(job.title)) {
            reject("not a software engineering role");
            continue;
        }
        const text = haystack(job);
        if (!posture.needsSponsorship && AUTHORIZATION_GATES.some((r) => r.test(text))) {
            reject("geography or work-authorization gate");
            continue;
        }
        if (TIMEZONE_GATES.some((r) => r.test(text))) {
            reject("incompatible timezone requirement");
            continue;
        }
        // India priority: a posting that positively excludes India is the ONLY
        // India-related rejection. Absence of an India signal never rejects —
        // most sources state no restriction at all.
        if (posture.indiaPriority && isIndiaExcluded(job)) {
            reject("employer will not hire from India");
            continue;
        }
        // Geography is decided by `posture.regions`, the profile's own list of
        // acceptable regions. Two tokens are read: "india" admits roles located in
        // India, "remote" admits remote roles wherever they are based.
        //
        // A profile carrying only "india" therefore rejects remote-anywhere roles —
        // that is the whole point of the narrower posture, and it is why the check
        // reads `regions` rather than `remoteGlobal`. `remoteGlobal` says whether
        // remote work may be for any employer, not whether relocation is on the
        // table; gating on it once meant the India-only profile got no geography
        // filter at all, which is the looser outcome, exactly backwards.
        //
        // Strict India matching: `isIndiaLocatedStrict` excludes APAC/Asia/IST, so
        // an India-only profile does not silently readmit the surrounding region.
        const acceptsRemote = posture.regions.includes("remote");
        const indiaOk = posture.indiaPriority && isIndiaLocatedStrict(job);
        if (!indiaOk && !(job.remote && acceptsRemote)) {
            reject(`geography: outside profile regions (${posture.regions.join(", ")})`);
            continue;
        }
        // Stack overlap, but only where there is text to overlap with. A search
        // result has a title and nothing else; requiring two stack matches against
        // an empty description is not a test the posting can fail on its merits,
        // it is a test it cannot take. Absent evidence, the role and seniority
        // gates above stand on their own and the ranker scores the rest — the same
        // rule `isIndiaEligible` follows for an empty restriction list.
        if (job.descriptionText.trim() !== "" && countStackMatches(job, profile.coreStack) < 2) {
            reject("fewer than 2 core stack matches");
            continue;
        }
        passed.push(job);
    }
    return { passed, rejected };
}
