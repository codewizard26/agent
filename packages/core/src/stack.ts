/** Canonical spellings used for both discovery and evidence matching. */
const ALIASES: Record<string, string[]> = {
  react: ["react", "react.js", "reactjs"],
  node: ["node", "node.js", "nodejs"],
  express: ["express", "express.js", "expressjs"],
  "next.js": ["next.js", "nextjs", "next js"],
  postgresql: ["postgresql", "postgres", "postgre sql"],
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  mongodb: ["mongodb", "mongo db", "mongo"],
};

export function canonicalStack(term: string): string {
  const lower = term.toLowerCase().trim();
  return Object.entries(ALIASES).find(([, aliases]) => aliases.includes(lower))?.[0] ?? lower;
}

export function containsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

export function stackMatchCount(text: string, stack: string[]): number {
  const skills = new Set(stack.flatMap((s) => s.split("/")).map(canonicalStack));
  return [...skills].filter((skill) =>
    (ALIASES[skill] ?? [skill]).some((alias) => containsTerm(text, alias)),
  ).length;
}
