import { z } from "zod";
export const DEFAULT_POSTURE_INDIA = {
    regions: ["india", "remote"],
    remoteGlobal: false,
    needsSponsorship: false,
    indiaPriority: true,
};
export const DEFAULT_POSTURE_REMOTE_GLOBAL = {
    regions: ["remote"],
    remoteGlobal: true,
    needsSponsorship: false,
    indiaPriority: true,
};
const ExtractionSchema = z.object({
    fullName: z.string(),
    yearsExperience: z.number(),
    graduationYear: z.number().nullable(),
    seniorityBands: z.array(z.enum(["entry", "junior", "mid", "senior", "staff", "principal", "lead", "manager"])),
    coreStack: z.array(z.string()),
    bonusStack: z.array(z.string()),
});
/**
 * The full profile including the two derived title lists. `parseResume` builds
 * one of these from a model; the candidates CLI validates a hand-written one
 * against it, so a profile authored outside the model path fails loudly on a
 * missing or misspelled field instead of silently filtering nothing.
 */
export const ParsedProfileSchema = ExtractionSchema.extend({
    titlesAccept: z.array(z.string()),
    titlesReject: z.array(z.string()),
    targetRoles: z.array(z.string()).optional(),
});
export const PostureSchema = z.object({
    regions: z.array(z.string()),
    remoteGlobal: z.boolean(),
    needsSponsorship: z.boolean(),
    indiaPriority: z.boolean(),
});
/**
 * A profile authored by hand instead of by `parseResume`. `resumePath` is the
 * PDF the apply worker uploads, so a profile without it can be fetched against
 * but not applied with.
 */
export const ProfileFileSchema = z.object({
    name: z.string(),
    ownerEmail: z.string(),
    resumePath: z.string().optional(),
    /** Cron fetch window in days. null means "any"; omit to leave it unchanged. */
    feedTimeFrameDays: z.number().nullable().optional(),
    parsedProfile: ParsedProfileSchema,
    posture: PostureSchema,
});
/** Title keywords associated with each band, used to derive accept/reject lists. */
const BAND_KEYWORDS = {
    entry: ["entry level", "new grad", "graduate", "trainee", "associate"],
    junior: ["junior", "jr", "sde 1", "software engineer i"],
    mid: ["mid level", "sde 2", "software engineer ii", "engineer ii"],
    senior: ["senior", "sr", "sde 3", "software engineer iii"],
    staff: ["staff"],
    principal: ["principal"],
    lead: ["lead", "tech lead"],
    manager: ["manager", "engineering manager", "director", "vp", "head of"],
};
/** Always rejected regardless of band — these are not the roles being sought. */
const ALWAYS_REJECT = ["intern", "internship"];
/**
 * Turns the model's band list into accept/reject title keywords.
 * A profile accepts its own bands and rejects every other band's keywords.
 * This is why nothing is hardcoded: a 2026 graduate accepts "new grad" while a
 * five-year engineer rejects it, from the same code path.
 */
export function deriveTitleKeywords(bands) {
    const accepted = new Set(bands);
    const titlesAccept = bands.flatMap((b) => BAND_KEYWORDS[b]);
    const titlesReject = Object.keys(BAND_KEYWORDS)
        .filter((b) => !accepted.has(b))
        .flatMap((b) => BAND_KEYWORDS[b])
        .concat(ALWAYS_REJECT);
    return { titlesAccept, titlesReject };
}
export async function parseResume(resumeText, client) {
    const parsed = await client.parse({
        schema: ExtractionSchema,
        schemaName: "resume_profile",
        tier: "utility",
        maxOutputTokens: 8192,
        prompt: "Extract a structured profile from this resume. seniorityBands should " +
            "be the bands this person should be applying to right now — a 2026 " +
            "graduate with under a year of experience is ['entry','junior'], a " +
            "five-year engineer is ['mid','senior']. coreStack is the languages and " +
            "frameworks they would be hired for; bonusStack is specialist " +
            "differentiators that should score well but never be required.\n\n" +
            resumeText,
    });
    if (!parsed)
        throw new Error("Resume could not be parsed into a profile");
    return { ...parsed, ...deriveTitleKeywords(parsed.seniorityBands) };
}
