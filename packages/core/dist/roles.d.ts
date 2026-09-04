import type { ParsedProfile } from "./resume.js";
/**
 * Is this title a software engineering role?
 *
 * Reads the TITLE ONLY. The description is where the false positives live — a
 * sales posting describing the product's React frontend reads as an engineering
 * role by any text measure, and the title is the one field that does not lie.
 */
export declare function isEngineeringRole(title: string): boolean;
/**
 * The role titles to actually search for, read off the resume's own stack.
 *
 * "software engineer" is always there — it is the title most postings use
 * regardless of layer. Front and back end are added by what the person has
 * actually worked in, and someone with both gets "full stack" too. This is what
 * makes the searches match the resume rather than a fixed guess.
 */
export declare function deriveRoleFamilies(profile: ParsedProfile): string[];
