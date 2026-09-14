/** Strict evidence gate for fresher feeds. Unknown and open-ended ranges fail. */
export function hasFresherRequirements(title: string, description: string): boolean {
  const text = `${title}. ${description}`;
  if (/\bno freshers?\b|\bfreshers? (?:are )?not (?:eligible|accepted|allowed)\b/i.test(text)) return false;
  const requirements = [...text.matchAll(
    /\b(\d+(?:\.\d+)?)\s*(?:([-–—]|to)\s*(\d+(?:\.\d+)?))?\s*(\+)?\s*(years?|yrs?|months?)\b(?:\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+)?experience)?/gi,
  )].filter((match) => {
    const before = text.slice(Math.max(0, match.index! - 45), match.index);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 45);
    return (match.index! < title.length || /experience|minimum|at least|require/i.test(before + match[0] + after)) &&
      !/preferred|nice.to.have/i.test((before.split(/[.;\n]/).pop() ?? "") + (after.split(/[.;\n]/)[0] ?? ""));
  });
  let evidence = /\bintern(?:ship)?\b/i.test(title) || /\bfreshers?\b|\bnew grad(?:uate)?s?\b|\bno (?:prior |previous |work )?experience (?:required|needed)\b/i.test(text);
  for (const match of requirements) {
    const divisor = /^month/i.test(match[5]!) ? 12 : 1;
    const minimum = Number(match[1]) / divisor;
    const maximum = Number(match[3] ?? match[1]) / divisor;
    const before = text.slice(Math.max(0, match.index! - 20), match.index);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 15);
    if (match[4] || minimum > 2 || maximum > 2 ||
        (!match[3] && /(?:at least|minimum(?: of)?)\s*$/i.test(before)) ||
        /^\s*(?:or more|and above|and up)\b/i.test(after)) return false;
    evidence = true;
  }
  return evidence;
}
