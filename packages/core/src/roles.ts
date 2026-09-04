import type { ParsedProfile } from "./resume.js";

/**
 * Which *kind of job* this is, as opposed to how senior it is.
 *
 * `deriveTitleKeywords` answers seniority — a 2026 graduate accepts "new grad"
 * and rejects "staff". Nothing answered the other half: whether the posting is
 * a software engineering role at all. The stack check does not cover it, since
 * it reads the whole description, and a recruiter or sales posting at a React
 * shop lists React and Node in its own boilerplate. That is where the
 * irrelevant results came from.
 */

/** Titles that name a software engineering role. */
const ROLE_TERMS = [
  "software engineer",
  "software developer",
  "software development engineer",
  "sde",
  "swe",
  "frontend",
  "front end",
  "front-end",
  "backend",
  "back end",
  "back-end",
  "full stack",
  "fullstack",
  "full-stack",
  "mern",
  "web developer",
  "web engineer",
  "application developer",
  "application engineer",
  "applications engineer",
  "product engineer",
  "platform engineer",
  "infrastructure engineer",
  "devops",
  "site reliability",
  "mobile developer",
  "mobile engineer",
  "android developer",
  "ios developer",
  "react",
  "react native",
  "node",
  "javascript",
  "typescript",
  "python developer",
  "java developer",
  "golang",
  "ui developer",
  "ui engineer",
  "programmer",
  // QA titles. "QA Engineer" already cleared the bare "engineer" term below,
  // but "QA Tester", "Manual Tester" and "SDET" name no engineer or developer
  // and were rejected as non-engineering roles.
  "qa",
  "quality assurance",
  "sdet",
  "tester",
  "test engineer",
  "test automation",
  "automation engineer",
  // Bare "engineer" and "developer" catch "Backend Engineer II" and
  // "Developer, Payments", which no specific term above would. They are broad
  // on purpose, and NON_ENGINEERING_TERMS is what keeps them honest.
  "engineer",
  "developer",
];

/**
 * Titles that contain "engineer" or "developer" and are not this job.
 *
 * Every entry here exists because the bare "engineer"/"developer" terms above
 * would otherwise admit it: a Sales Engineer, a Technical Recruiter at a dev
 * tools company, a Business Development Manager. Checked before the accept
 * list, so a title matching both is rejected.
 */
const NON_ENGINEERING_TERMS = [
  "sales",
  "presales",
  "pre-sales",
  "solutions engineer",
  "solution engineer",
  "support engineer",
  "customer success",
  "customer engineer",
  "account executive",
  "account manager",
  "business development",
  "recruit",
  "talent acquisition",
  "sourcer",
  "marketing",
  "content",
  "community",
  "copywriter",
  "designer",
  "ux researcher",
  "hardware",
  "mechanical",
  "electrical",
  "civil engineer",
  "chemical",
  "industrial engineer",
  "biomedical",
  "network engineer",
  "field engineer",
  "process engineer",
  "quality engineer",
  "safety",
  "teacher",
  "trainer",
  "instructor",
  "faculty",
];

function pattern(term: string): RegExp {
  // Whole-word, so "sde" does not match "inside" and "node" does not match
  // "nodes" in a sentence — the same lesson INDIA_TERMS learned the hard way.
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

const ROLE_PATTERNS = ROLE_TERMS.map(pattern);
const NON_ENGINEERING_PATTERNS = NON_ENGINEERING_TERMS.map(pattern);

/**
 * Is this title a software engineering role?
 *
 * Reads the TITLE ONLY. The description is where the false positives live — a
 * sales posting describing the product's React frontend reads as an engineering
 * role by any text measure, and the title is the one field that does not lie.
 */
export function isEngineeringRole(title: string): boolean {
  if (NON_ENGINEERING_PATTERNS.some((p) => p.test(title))) return false;
  return ROLE_PATTERNS.some((p) => p.test(title));
}

/** Stack terms that place someone on one side of the front/back line. */
const FRONTEND_STACK = [
  "react",
  "next.js",
  "nextjs",
  "angular",
  "vue",
  "svelte",
  "html",
  "css",
  "tailwind",
  "redux",
  "javascript",
  "typescript",
];

const BACKEND_STACK = [
  "node",
  "express",
  "django",
  "flask",
  "spring",
  "asp.net",
  ".net",
  "rails",
  "laravel",
  "postgresql",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "graphql",
  "rest",
  "java",
  "python",
  "go",
  "c#",
];

function hasAny(stack: string[], terms: string[]): boolean {
  const lower = stack.map((s) => s.toLowerCase());
  return terms.some((t) => lower.some((s) => s === t || s.startsWith(`${t} `)));
}

/**
 * The role titles to actually search for, read off the resume's own stack.
 *
 * "software engineer" is always there — it is the title most postings use
 * regardless of layer. Front and back end are added by what the person has
 * actually worked in, and someone with both gets "full stack" too. This is what
 * makes the searches match the resume rather than a fixed guess.
 */
export function deriveRoleFamilies(profile: ParsedProfile): string[] {
  // A profile may name the roles it is actually going after. Reading the stack
  // can only ever produce the layers someone has already worked in, so a
  // candidate aiming at QA or AI work has no way to say so otherwise. The LAST
  // entry is the primary role — `buildSearchQueries` uses it alone for the
  // sources that over-constrain on a long OR chain.
  if (profile.targetRoles && profile.targetRoles.length > 0) {
    return profile.targetRoles;
  }

  const stack = [...profile.coreStack, ...profile.bonusStack];
  const frontend = hasAny(stack, FRONTEND_STACK);
  const backend = hasAny(stack, BACKEND_STACK);

  const families = ["software engineer"];
  if (frontend) families.push("frontend developer");
  if (backend) families.push("backend developer");
  if (frontend && backend) families.push("full stack developer");
  return families;
}
