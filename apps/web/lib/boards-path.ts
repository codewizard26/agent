import fs from "node:fs";
import path from "node:path";

/**
 * Where `sources/boards.yaml` lives, which differs between running and deployed.
 *
 * `next dev` runs with cwd = apps/web, so the file is two levels up at the repo
 * root. A Vercel function runs with cwd = the deployment root, where the same
 * file sits directly under `sources/`. Hard-coding the `../../` hop worked
 * locally and would have failed in production on a missing file, which reads as
 * a broken fetch rather than as a packaging problem.
 */
export function resolveBoardsPath(
  cwd: string = process.cwd(),
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const candidates = [
    path.join(cwd, "..", "..", "sources", "boards.yaml"),
    path.join(cwd, "sources", "boards.yaml"),
  ];
  const found = candidates.find(exists);
  if (!found) {
    throw new Error(`no boards.yaml found — looked in: ${candidates.join(", ")}`);
  }
  return found;
}
