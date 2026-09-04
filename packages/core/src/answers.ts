export type AnswerKind = "text" | "select" | "boolean" | "file";

export interface AnswerKeyDef {
  key: string;
  label: string;
  kind: AnswerKind;
  /** Seeded value. Null means the owner must supply it. */
  defaultValue: string | null;
  help?: string;
}

const DECLINE = "Decline to self-identify";

export const ANSWER_KEYS: AnswerKeyDef[] = [
  { key: "full_name", label: "Full name", kind: "text", defaultValue: null },
  { key: "email", label: "Email", kind: "text", defaultValue: null },
  { key: "phone", label: "Phone", kind: "text", defaultValue: null },
  { key: "location", label: "Current location (city, country)", kind: "text", defaultValue: null },
  { key: "linkedin_url", label: "LinkedIn URL", kind: "text", defaultValue: null },
  { key: "github_url", label: "GitHub URL", kind: "text", defaultValue: null },
  { key: "portfolio_url", label: "Portfolio URL", kind: "text", defaultValue: null },
  {
    key: "work_authorization",
    label: "Work authorization",
    kind: "text",
    defaultValue: null,
    help: "e.g. 'Authorized to work in India; available worldwide as a remote contractor'",
  },
  {
    key: "requires_sponsorship",
    label: "Requires visa sponsorship",
    kind: "boolean",
    defaultValue: null,
  },
  { key: "notice_period", label: "Notice period", kind: "text", defaultValue: null },
  {
    key: "expected_compensation",
    label: "Expected compensation",
    kind: "text",
    defaultValue: null,
  },
  { key: "years_experience", label: "Years of experience", kind: "text", defaultValue: null },
  // Voluntary. Declining is the default; only the owner changes these.
  { key: "eeo_gender", label: "EEO — gender", kind: "select", defaultValue: DECLINE },
  { key: "eeo_race", label: "EEO — race/ethnicity", kind: "select", defaultValue: DECLINE },
  { key: "eeo_veteran", label: "EEO — veteran status", kind: "select", defaultValue: DECLINE },
  { key: "eeo_disability", label: "EEO — disability status", kind: "select", defaultValue: DECLINE },
];

export interface NewAnswerRow {
  profileId: string;
  key: string;
  label: string;
  kind: AnswerKind;
  value: string | null;
}

export function seedAnswerRows(profileId: string): NewAnswerRow[] {
  return ANSWER_KEYS.map((def) => ({
    profileId,
    key: def.key,
    label: def.label,
    kind: def.kind,
    value: def.defaultValue,
  }));
}

/** An empty string is unanswered, not an answer. */
export function resolveAnswer(
  rows: { key: string; value: string | null }[],
  key: string,
): string | null {
  const row = rows.find((r) => r.key === key);
  if (!row?.value || row.value.trim() === "") return null;
  return row.value;
}
