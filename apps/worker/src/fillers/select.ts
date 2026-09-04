import type { AtsFiller } from "./types.js";

/**
 * Picks by the page's RESOLVED landing host, not by the source adapter —
 * Coinbase, Stripe and Consensys all redirect their Greenhouse boards to
 * bespoke careers sites. The generic filler matches everything, so it is
 * considered last regardless of list order.
 */
export function selectFiller(url: string, fillers: AtsFiller[]): AtsFiller {
  const specific = fillers.find((f) => f.name !== "generic" && f.matches(url));
  if (specific) return specific;

  const generic = fillers.find((f) => f.name === "generic");
  if (!generic) throw new Error("no generic filler registered");
  return generic;
}
