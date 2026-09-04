import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { RANK_MODEL, UTILITY_MODEL } from "./models.js";
function modelFor(tier) {
    return tier === "rank" ? RANK_MODEL : UTILITY_MODEL;
}
/**
 * The Responses API counts reasoning tokens against `max_output_tokens`, and a
 * response that runs out comes back `incomplete` with `output_parsed` null —
 * indistinguishable from a refusal unless you check. Every truncation throws
 * here so a systematically undersized budget surfaces as an error instead of a
 * feed where nothing is ranked.
 */
function assertComplete(response) {
    if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason ?? "unknown";
        throw new Error(`model response incomplete: ${reason}`);
    }
}
export function createOpenAiClient(client = new OpenAI()) {
    return {
        async parse(opts) {
            const response = await client.responses.parse({
                model: modelFor(opts.tier),
                reasoning: { effort: opts.effort ?? "low" },
                max_output_tokens: opts.maxOutputTokens ?? 16000,
                input: [
                    ...(opts.system
                        ? [{ role: "system", content: opts.system }]
                        : []),
                    { role: "user", content: opts.prompt },
                ],
                text: { format: zodTextFormat(opts.schema, opts.schemaName) },
            });
            assertComplete(response);
            return response.output_parsed ?? null;
        },
        async searchWeb(opts) {
            const response = await client.responses.create({
                model: modelFor("rank"),
                reasoning: { effort: "low" },
                max_output_tokens: 16000,
                tools: [{ type: "web_search" }],
                input: opts.prompt,
            });
            // A search that hits the token ceiling still returns whatever it found,
            // and partial findings beat none — this one does not throw.
            return response.output_text ?? "";
        },
    };
}
