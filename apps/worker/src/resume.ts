/**
 * Which resume file an application carries.
 *
 * This is one line of logic with its own module because getting it wrong is
 * invisible and unrecoverable: the wrong PDF uploads cleanly, the form submits,
 * and one person's application reaches an employer carrying another person's
 * resume. Nothing downstream would notice.
 */
export interface ResumeOwner {
  name: string;
  resumeBlobUrl: string | null;
}

export function resolveResumePath(profile: ResumeOwner): string {
  const path = profile.resumeBlobUrl?.trim();
  if (!path) {
    // Deliberately not a fallback. The previous behaviour reached for a single
    // RESUME_PATH env var, which on a two-person install is the other person's
    // file.
    throw new Error(
      `${profile.name} has no resume on file — set resumeBlobUrl on the profile ` +
        `(pnpm add-profile --profile <file.json> --resume <path.pdf>)`,
    );
  }
  return path;
}
