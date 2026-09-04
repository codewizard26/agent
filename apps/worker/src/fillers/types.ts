import type { Page } from "playwright-core";

export interface HarvestedField {
  /** Stable selector for this element within the page. */
  selector: string;
  /** Human label — the thing we actually match on. Asterisk stripped. */
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

export interface FillContext {
  page: Page;
  /** Resolved answers by canonical key. Absent means unanswered. */
  answers: Map<string, string>;
  resumePath: string;
  /**
   * Writes an answer for a field the answer bank does not cover. Absent, or
   * returning null, means the field is left for a person.
   */
  compose?: (field: HarvestedField) => Promise<string | null>;
}

export interface FillOutcome {
  filled: { label: string; answerKey: string }[];
  blocked: string[];
}

export interface AtsFiller {
  name: string;
  /** True when this filler handles the page's resolved landing host. */
  matches: (url: string) => boolean;
  fill: (ctx: FillContext) => Promise<FillOutcome>;
}
