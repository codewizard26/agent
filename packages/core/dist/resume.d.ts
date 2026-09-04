import { z } from "zod";
import type { LlmClient } from "./llm.js";
export type SeniorityBand = "entry" | "junior" | "mid" | "senior" | "staff" | "principal" | "lead" | "manager";
export interface Posture {
    regions: string[];
    remoteGlobal: boolean;
    needsSponsorship: boolean;
    /**
     * Rank India-eligible roles above others, and keep on-site roles that are in
     * India. Both seeded profiles are India-based, so this defaults true.
     */
    indiaPriority: boolean;
}
export interface ParsedProfile {
    fullName: string;
    yearsExperience: number;
    graduationYear: number | null;
    seniorityBands: SeniorityBand[];
    coreStack: string[];
    bonusStack: string[];
    titlesAccept: string[];
    titlesReject: string[];
    /**
     * The role families to search for, when the resume's stack does not imply
     * them. Omit to let `deriveRoleFamilies` read them off the stack.
     */
    targetRoles?: string[];
}
export declare const DEFAULT_POSTURE_INDIA: Posture;
export declare const DEFAULT_POSTURE_REMOTE_GLOBAL: Posture;
/**
 * The full profile including the two derived title lists. `parseResume` builds
 * one of these from a model; the candidates CLI validates a hand-written one
 * against it, so a profile authored outside the model path fails loudly on a
 * missing or misspelled field instead of silently filtering nothing.
 */
export declare const ParsedProfileSchema: z.ZodObject<{
    fullName: z.ZodString;
    yearsExperience: z.ZodNumber;
    graduationYear: z.ZodNullable<z.ZodNumber>;
    seniorityBands: z.ZodArray<z.ZodEnum<{
        entry: "entry";
        junior: "junior";
        mid: "mid";
        senior: "senior";
        staff: "staff";
        principal: "principal";
        lead: "lead";
        manager: "manager";
    }>>;
    coreStack: z.ZodArray<z.ZodString>;
    bonusStack: z.ZodArray<z.ZodString>;
    titlesAccept: z.ZodArray<z.ZodString>;
    titlesReject: z.ZodArray<z.ZodString>;
    targetRoles: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const PostureSchema: z.ZodObject<{
    regions: z.ZodArray<z.ZodString>;
    remoteGlobal: z.ZodBoolean;
    needsSponsorship: z.ZodBoolean;
    indiaPriority: z.ZodBoolean;
}, z.core.$strip>;
/**
 * A profile authored by hand instead of by `parseResume`. `resumePath` is the
 * PDF the apply worker uploads, so a profile without it can be fetched against
 * but not applied with.
 */
export declare const ProfileFileSchema: z.ZodObject<{
    name: z.ZodString;
    ownerEmail: z.ZodString;
    resumePath: z.ZodOptional<z.ZodString>;
    feedTimeFrameDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    parsedProfile: z.ZodObject<{
        fullName: z.ZodString;
        yearsExperience: z.ZodNumber;
        graduationYear: z.ZodNullable<z.ZodNumber>;
        seniorityBands: z.ZodArray<z.ZodEnum<{
            entry: "entry";
            junior: "junior";
            mid: "mid";
            senior: "senior";
            staff: "staff";
            principal: "principal";
            lead: "lead";
            manager: "manager";
        }>>;
        coreStack: z.ZodArray<z.ZodString>;
        bonusStack: z.ZodArray<z.ZodString>;
        titlesAccept: z.ZodArray<z.ZodString>;
        titlesReject: z.ZodArray<z.ZodString>;
        targetRoles: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    posture: z.ZodObject<{
        regions: z.ZodArray<z.ZodString>;
        remoteGlobal: z.ZodBoolean;
        needsSponsorship: z.ZodBoolean;
        indiaPriority: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ProfileFile = z.infer<typeof ProfileFileSchema>;
/**
 * Turns the model's band list into accept/reject title keywords.
 * A profile accepts its own bands and rejects every other band's keywords.
 * This is why nothing is hardcoded: a 2026 graduate accepts "new grad" while a
 * five-year engineer rejects it, from the same code path.
 */
export declare function deriveTitleKeywords(bands: SeniorityBand[]): {
    titlesAccept: string[];
    titlesReject: string[];
};
export declare function parseResume(resumeText: string, client: LlmClient): Promise<ParsedProfile>;
