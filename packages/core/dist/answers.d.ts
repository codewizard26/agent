export type AnswerKind = "text" | "select" | "boolean" | "file";
export interface AnswerKeyDef {
    key: string;
    label: string;
    kind: AnswerKind;
    /** Seeded value. Null means the owner must supply it. */
    defaultValue: string | null;
    help?: string;
}
export declare const ANSWER_KEYS: AnswerKeyDef[];
export interface NewAnswerRow {
    profileId: string;
    key: string;
    label: string;
    kind: AnswerKind;
    value: string | null;
}
export declare function seedAnswerRows(profileId: string): NewAnswerRow[];
/** An empty string is unanswered, not an answer. */
export declare function resolveAnswer(rows: {
    key: string;
    value: string | null;
}[], key: string): string | null;
