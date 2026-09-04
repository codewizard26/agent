import type { NormalizedJob } from "./types.js";
/** True when any entry names India, an Indian city, or a region covering it. */
export declare function mentionsIndia(values: string[]): boolean;
/** True only when an entry names India itself or one of its cities. */
export declare function mentionsIndiaStrict(values: string[]): boolean;
export declare function mentionsWorldwide(values: string[]): boolean;
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
export declare function isIndiaEligible(job: NormalizedJob): boolean;
/** True when the posting positively names India — used for ordering, not filtering. */
export declare function isIndiaLocated(job: NormalizedJob): boolean;
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
export declare function isIndiaLocatedStrict(job: NormalizedJob): boolean;
/**
 * A posting explicitly restricted away from India. This is the ONLY
 * India-related reason the filter rejects anything.
 */
export declare function isIndiaExcluded(job: NormalizedJob): boolean;
/**
 * India ordering for the path that has no rankings: India-located roles first,
 * then India-eligible, then the rest. Ordering only — nothing is dropped, and
 * the sort is stable so each tier keeps its incoming order.
 */
export declare function sortByIndiaPriority<T extends NormalizedJob>(jobs: T[]): T[];
