import { harvestFields } from "../harvest.js";
import type { AtsFiller, FillContext, FillOutcome } from "./types.js";

/**
 * Labels observed on live Greenhouse forms (gitlab, discord), mapped to answer
 * bank keys. Matching is on label text because these forms are React-controlled
 * and carry no useful name attributes.
 */
export const GREENHOUSE_LABEL_MAP: Record<string, string> = {
  "first name": "full_name",
  "last name": "full_name",
  "full name": "full_name",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  country: "location",
  "location (city)": "location",
  location: "location",
  "linkedin profile": "linkedin_url",
  linkedin: "linkedin_url",
  "github profile": "github_url",
  github: "github_url",
  website: "portfolio_url",
  "portfolio url": "portfolio_url",
  "notice period": "notice_period",
  "expected salary": "expected_compensation",
  "salary expectation": "expected_compensation",
  "years of experience": "years_experience",
  gender: "eeo_gender",
  "race / ethnicity": "eeo_race",
  "veteran status": "eeo_veteran",
  "disability status": "eeo_disability",
};

export function matchAnswerKey(label: string): string | null {
  return GREENHOUSE_LABEL_MAP[label.trim().toLowerCase()] ?? null;
}

/** Builds a label-matching filler from a base vocabulary plus per-ATS additions. */
export function createLabelFiller(
  name: string,
  hosts: string[],
  extraMap: Record<string, string> = {},
): AtsFiller {
  const map = { ...GREENHOUSE_LABEL_MAP, ...extraMap };
  return {
    name,
    matches: (url) => hosts.some((h) => url.includes(h)),
    async fill(ctx: FillContext): Promise<FillOutcome> {
      const fields = await harvestFields(ctx.page);
      const filled: FillOutcome["filled"] = [];
      const blocked: string[] = [];

      for (const field of fields) {
        if (field.type === "file") {
          await ctx.page.setInputFiles(field.selector, ctx.resumePath).catch(() => {});
          filled.push({ label: field.label, answerKey: "resume" });
          continue;
        }
        const key = map[field.label.trim().toLowerCase()];
        const value = key ? ctx.answers.get(key) : undefined;
        if (!key || !value) {
          // Company-specific questions and unanswered keys both land here.
          blocked.push(field.label);
          continue;
        }
        if (field.type === "select") {
          await ctx.page.selectOption(field.selector, { label: value }).catch(() => {});
        } else {
          await ctx.page.fill(field.selector, value).catch(() => {});
        }
        filled.push({ label: field.label, answerKey: key });
      }
      return { filled, blocked };
    },
  };
}

export const greenhouseFiller: AtsFiller = createLabelFiller("greenhouse", [
  "job-boards.greenhouse.io",
  "boards.greenhouse.io",
]);
