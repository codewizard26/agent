/** Lowercase, strip punctuation, collapse whitespace. */
export function slugify(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}
/**
 * Normalizes a job title so the same role from different sources produces one key.
 * Order matters: strip bracketed and trailing fragments before slugifying, because
 * slugify would otherwise destroy the delimiters we key on.
 */
export function normalizeTitle(title) {
    let t = title;
    // "(Remote)", "(m/f/d)", "[Contract]"
    t = t.replace(/\s*[([][^)\]]*[)\]]/g, "");
    // trailing " - Bangalore", " – EMEA", " — Remote"
    t = t.replace(/\s+[-–—]\s+.*$/, "");
    return slugify(t);
}
export function buildJobKey(input) {
    const slugKey = `${slugify(input.company)}|${normalizeTitle(input.title)}`;
    const atsKey = input.atsKind && input.atsRef ? `${input.atsKind}:${input.atsRef}` : null;
    return { atsKey, slugKey };
}
/** Every key a ledger row for this job could match on. */
export function ledgerMatchKeys(key) {
    return key.atsKey ? [key.atsKey, key.slugKey] : [key.slugKey];
}
