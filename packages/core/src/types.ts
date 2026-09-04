export type SourceKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "remoteok"
  | "arbeitnow"
  | "hn"
  | "websearch"
  | "bluesky"
  | "remotive"
  | "himalayas"
  | "jobicy"
  | "instahyre"
  | "ycombinator";

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable";

/**
 * 'true'     — a machine-readable creation field from the source.
 * 'reported' — a date a model read off a page. Usable, but not a real field.
 * 'none'     — the source exposes no date at all.
 */
export type DateFidelity = "true" | "reported" | "none";

export interface JobKey {
  /** Exact ATS identity, e.g. "greenhouse:discord/8599937002". Null when unknown. */
  atsKey: string | null;
  /** Fallback identity, e.g. "discord|senior software engineer". Always present. */
  slugKey: string;
}

export interface NormalizedJob {
  key: JobKey;
  sourceKind: SourceKind;
  company: string;
  title: string;
  locationRaw: string;
  remote: boolean;
  /**
   * Where the employer will hire from, when the source states it. Empty means
   * unrestricted — most sources carry no such field, so [] must read as
   * "eligible", never "ineligible".
   */
  locationRestrictions: string[];
  descriptionText: string;
  applyUrl: string;
  atsKind: AtsKind | null;
  atsRef: string | null;
  postedAt: Date | null;
  dateFidelity: DateFidelity;
}
