import { z } from "zod";
import type { LlmClient } from "@job-agent/core";
import { harvestFields } from "../harvest.js";
import type { AtsFiller, FillContext, FillOutcome, HarvestedField } from "./types.js";

/** Below this, a mapping is treated as no mapping. Guessing is worse than asking. */
export const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Fields are matched by index, not by label. Matching on an echoed label looked
 * fine and silently mapped nothing: the prompt lists labels decorated with their
 * type ("First Name (text, required)"), and a model that echoes that decorated
 * string never equals the bare label it came from.
 */
const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      index: z.number(),
      answerKey: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
});

export interface LabelMapping {
  label: string;
  selector: string;
  answerKey: string | null;
}

export async function mapLabelsToKeys(
  fields: HarvestedField[],
  answerKeys: string[],
  client: LlmClient,
): Promise<LabelMapping[]> {
  const base: LabelMapping[] = fields.map((f) => ({
    label: f.label,
    selector: f.selector,
    answerKey: null,
  }));

  const parsed = await client.parse({
    schema: MappingSchema,
    schemaName: "label_mappings",
    tier: "utility",
    maxOutputTokens: 8192,
    prompt:
      "Map each form field label to one of these stored answer keys, or null " +
      "when no key fits. A question specific to this company or role (for " +
      "example 'why do you want to work here') has no stored answer — return " +
      "null for it. Confidence is 0 to 1.\n\n" +
      "Answer with the index of each field exactly as numbered below.\n\n" +
      `KEYS\n${answerKeys.join(", ")}\n\nFIELDS\n${fields
        .map((f, i) => `${i}. ${f.label} (${f.type}${f.required ? ", required" : ""})`)
        .join("\n")}`,
  });

  if (!parsed) return base;

  const offered = new Set(answerKeys);
  for (const mapping of parsed.mappings) {
    const target = base[mapping.index];
    if (!target) continue;
    if (!mapping.answerKey) continue;
    if (mapping.confidence < CONFIDENCE_THRESHOLD) continue;
    // Never accept a key the model invented.
    if (!offered.has(mapping.answerKey)) continue;
    target.answerKey = mapping.answerKey;
  }
  return base;
}

export function createGenericFiller(client: LlmClient): AtsFiller {
  return {
    name: "generic",
    matches: () => true, // last resort — the selector tries it only after the rest
    async fill(ctx: FillContext): Promise<FillOutcome> {
      const fields = await harvestFields(ctx.page);
      const mappings = await mapLabelsToKeys(fields, [...ctx.answers.keys()], client);

      const filled: FillOutcome["filled"] = [];
      const blocked: string[] = [];

      for (const field of fields) {
        if (field.type === "file") {
          // A swallowed failure here is an application submitted with no
          // resume attached, which auto-submit would send without anyone
          // noticing. Report it as blocked so the task goes to a human.
          const uploaded = await ctx.page
            .setInputFiles(field.selector, ctx.resumePath)
            .then(() => true)
            .catch(() => false);
          if (uploaded) filled.push({ label: field.label, answerKey: "resume" });
          else blocked.push(`${field.label} (resume upload failed)`);
          continue;
        }

        const mapping = mappings.find((m) => m.selector === field.selector);
        let value = mapping?.answerKey ? ctx.answers.get(mapping.answerKey) : undefined;
        if (!value && ctx.compose) {
          value = (await ctx.compose(field)) ?? undefined;
        }

        if (!value) {
          blocked.push(field.label);
          continue;
        }

        if (field.type === "select") {
          await ctx.page.selectOption(field.selector, { label: value }).catch(() => {});
        } else {
          await ctx.page.fill(field.selector, value).catch(() => {});
        }
        filled.push({ label: field.label, answerKey: mapping?.answerKey ?? "composed" });
      }

      return { filled, blocked };
    },
  };
}
