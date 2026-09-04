import { z } from "zod";
import type { LlmClient } from "@job-agent/core";
import type { HarvestedField } from "./fillers/types.js";

/**
 * Writes an answer to a question the answer bank does not cover.
 *
 * This is the step that lets a run finish without stopping, and it is the one
 * place where text nobody has read reaches an employer. Everything here exists
 * to keep that text tied to fact: the prompt carries the resume and the stored
 * answers, and says to leave a question unanswered rather than invent for it.
 */
export interface ComposeContext {
  resumeText: string;
  /** Answer-bank values already resolved, so the model stays consistent with them. */
  known: Map<string, string>;
  company: string;
  title: string;
}

export function buildComposePrompt(field: HarvestedField, ctx: ComposeContext): string {
  const known = [...ctx.known.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  const options = field.options.length
    ? `\nThis control only accepts one of these exactly:\n${field.options.join("\n")}`
    : "";
  return [
    `Application for ${ctx.title} at ${ctx.company}.`,
    "",
    "Answer the question below as this candidate, in the first person, using",
    "only what the resume and stored answers below support. Two or three",
    "sentences at most. State nothing about them that is not evidenced here —",
    "no invented employers, dates, salaries or legal declarations. If the",
    "question cannot be answered from this material, return an empty string.",
    "",
    `QUESTION\n${field.label}${options}`,
    "",
    `STORED ANSWERS\n${known || "none"}`,
    "",
    `RESUME\n${ctx.resumeText.slice(0, 6000)}`,
  ].join("\n");
}

/**
 * A select only accepts its own labels: "yes" typed into a control whose option
 * reads "Yes, I am authorized" selects nothing, and the form submits with the
 * field empty. Null means leave it alone rather than guess.
 */
export function coerceToOption(answer: string, options: string[]): string | null {
  if (options.length === 0) return answer;
  const exact = options.find((o) => o.toLowerCase() === answer.toLowerCase());
  if (exact) return exact;
  const partial = options.find(
    (o) =>
      o.toLowerCase().startsWith(answer.toLowerCase()) ||
      answer.toLowerCase().startsWith(o.toLowerCase()),
  );
  return partial ?? null;
}

const AnswerSchema = z.object({ answer: z.string() });

export type AnswerComposer = (field: HarvestedField) => Promise<string | null>;

export function createAnswerComposer(client: LlmClient, ctx: ComposeContext): AnswerComposer {
  return async (field) => {
    const parsed = await client
      .parse({
        schema: AnswerSchema,
        schemaName: "application_answer",
        tier: "utility",
        maxOutputTokens: 2048,
        prompt: buildComposePrompt(field, ctx),
      })
      .catch(() => null);
    const answer = parsed?.answer?.trim();
    if (!answer) return null;
    return coerceToOption(answer, field.options);
  };
}
