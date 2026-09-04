/** Markers that a posting is open regardless of country. */
const WORLDWIDE = [
    "worldwide",
    "anywhere",
    "global",
    "remote - global",
    "any location",
];
/**
 * India proper — the country and its hiring cities. Nothing here names a place
 * outside India, so a match is a positive statement that the role sits in India.
 */
const INDIA_STRICT_TERMS = [
    "india",
    "bangalore",
    "bengaluru",
    "hyderabad",
    "pune",
    "mumbai",
    "delhi",
    "gurgaon",
    "gurugram",
    "noida",
    "chennai",
    "kolkata",
    "ahmedabad",
    "jaipur",
    "indore",
];
/**
 * The strict terms plus regional markers that merely *cover* India. A role
 * scoped to APAC, Asia or IST hours is reachable from India but is not located
 * there — a Singapore "Backend Engineer, APAC" matches every one of these.
 *
 * That difference decides where each list may be used: the broad list orders
 * and admits, the strict list gates. Using the broad list for an India-only
 * region gate quietly readmits the whole APAC region the gate exists to cut.
 */
const INDIA_TERMS = [...INDIA_STRICT_TERMS, "apac", "asia", "ist"];
function normalized(values) {
    return values.map((v) => v.toLowerCase().trim()).filter(Boolean);
}
/**
 * Whole-word matching. Substring matching read fine until it ran: "Specialist",
 * "Scientist" and "Administrator" all contain the IST timezone marker,
 * "Apache" contains "apac", and "Indiana" contains "india" — enough false
 * positives to put California roles above a Mumbai one in the India ordering.
 */
function termPattern(term) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}
const INDIA_PATTERNS = INDIA_TERMS.map(termPattern);
const INDIA_STRICT_PATTERNS = INDIA_STRICT_TERMS.map(termPattern);
const WORLDWIDE_PATTERNS = WORLDWIDE.map(termPattern);
/** True when any entry names India, an Indian city, or a region covering it. */
export function mentionsIndia(values) {
    return normalized(values).some((v) => INDIA_PATTERNS.some((p) => p.test(v)));
}
/** True only when an entry names India itself or one of its cities. */
export function mentionsIndiaStrict(values) {
    return normalized(values).some((v) => INDIA_STRICT_PATTERNS.some((p) => p.test(v)));
}
export function mentionsWorldwide(values) {
    return normalized(values).some((v) => WORLDWIDE_PATTERNS.some((p) => p.test(v)));
}
/**
 * Can someone based in India take this job?
 *
 * The load-bearing rule: an EMPTY restriction list means unrestricted, so it is
 * eligible. Seven of the eleven sources carry no restriction field at all — read
 * [] as "ineligible" and almost the whole feed disappears.
 *
 * Only a non-empty list that names neither India nor a worldwide marker is a
 * positive exclusion.
 */
export function isIndiaEligible(job) {
    if (job.locationRestrictions.length === 0) {
        // No stated restriction. Fall back to the location text, which is only ever
        // used to say "yes", never to say "no".
        return true;
    }
    return (mentionsIndia(job.locationRestrictions) ||
        mentionsWorldwide(job.locationRestrictions));
}
/** True when the posting positively names India — used for ordering, not filtering. */
export function isIndiaLocated(job) {
    return (mentionsIndia([job.locationRaw]) ||
        mentionsIndia(job.locationRestrictions) ||
        mentionsIndia([job.title]));
}
/**
 * Is the role itself *in* India? Two narrowings over `isIndiaLocated`, and each
 * one is the difference between "India-only" and "India-eligible":
 *
 * 1. Strict terms — no APAC/Asia/IST, so a Singapore "Engineer, APAC" does not
 *    read as an Indian role.
 * 2. Location and title only — `locationRestrictions` is deliberately NOT read.
 *    A remote posting restricted to India is one an Indian candidate may take,
 *    which is `isIndiaEligible`'s question, not this one. Reading it here would
 *    readmit remote-anywhere-but-India roles through the back door.
 *
 * `descriptionText` is not read either, by the same logic that governs
 * `isIndiaLocated`: a posting whose location says "Remote" and whose body
 * mentions a Bangalore office reads as not located in India.
 */
export function isIndiaLocatedStrict(job) {
    return mentionsIndiaStrict([job.locationRaw]) || mentionsIndiaStrict([job.title]);
}
/**
 * A posting explicitly restricted away from India. This is the ONLY
 * India-related reason the filter rejects anything.
 */
export function isIndiaExcluded(job) {
    return job.locationRestrictions.length > 0 && !isIndiaEligible(job);
}
/**
 * India ordering for the path that has no rankings: India-located roles first,
 * then India-eligible, then the rest. Ordering only — nothing is dropped, and
 * the sort is stable so each tier keeps its incoming order.
 */
export function sortByIndiaPriority(jobs) {
    const tier = (job) => {
        if (isIndiaLocated(job))
            return 2;
        return isIndiaEligible(job) ? 1 : 0;
    };
    return [...jobs].sort((a, b) => tier(b) - tier(a));
}
