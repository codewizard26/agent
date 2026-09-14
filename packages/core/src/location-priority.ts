/** Delhi NCR is a preference, never an exclusion of other locations. */
export function isPreferredLocation(location: string): boolean {
  return /\b(gurugram|gurgaon|noida|delhi|ncr)\b/i.test(location);
}
