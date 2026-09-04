import { describe, it, expect, vi } from "vitest";
import { mapLabelsToKeys, CONFIDENCE_THRESHOLD } from "./generic.js";
import type { HarvestedField } from "./types.js";

const fields: HarvestedField[] = [
  { selector: "#a", label: "First Name", type: "text", required: true, options: [] },
  { selector: "#b", label: "Work Email", type: "email", required: true, options: [] },
  {
    selector: "#c",
    label: "Why do you want to work at Discord?",
    type: "textarea",
    required: true,
    options: [],
  },
];

function fakeClient(mappings: unknown) {
  return {
    parse: vi.fn().mockResolvedValue({ mappings }),
    searchWeb: vi.fn(),
  } as never;
}

describe("mapLabelsToKeys", () => {
  it("maps a confident label to its answer key", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["full_name", "email"],
      fakeClient([{ index: 1, answerKey: "email", confidence: 0.95 }]),
    );
    expect(result.find((m) => m.label === "Work Email")?.answerKey).toBe("email");
  });

  it("drops a mapping below the confidence threshold", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["email"],
      fakeClient([
        { index: 1, answerKey: "email", confidence: CONFIDENCE_THRESHOLD - 0.01 },
      ]),
    );
    expect(result.find((m) => m.label === "Work Email")?.answerKey).toBeNull();
  });

  it("leaves a per-job free-text question unmapped", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["full_name", "email"],
      fakeClient([
        { index: 2, answerKey: null, confidence: 0.99 },
      ]),
    );
    expect(
      result.find((m) => m.label.startsWith("Why do you"))?.answerKey,
    ).toBeNull();
  });

  it("returns every field unmapped when the model returns nothing", async () => {
    const client = {
      parse: vi.fn().mockResolvedValue(null),
      searchWeb: vi.fn(),
    } as never;
    const result = await mapLabelsToKeys(fields, ["email"], client);
    expect(result).toHaveLength(3);
    expect(result.every((m) => m.answerKey === null)).toBe(true);
  });

  it("never maps to a key that was not offered", async () => {
    const result = await mapLabelsToKeys(
      fields,
      ["full_name"],
      fakeClient([{ index: 1, answerKey: "email", confidence: 0.99 }]),
    );
    expect(result.find((m) => m.label === "Work Email")?.answerKey).toBeNull();
  });
});
