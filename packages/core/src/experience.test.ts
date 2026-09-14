import { describe, expect, it } from "vitest";
import { hasFresherRequirements } from "./experience.js";

describe("strict fresher requirements", () => {
  it("accepts explicit experience ranges in titles", () => {
    expect(hasFresherRequirements("Developer (0-2 years)", "React and Node.js")).toBe(true);
  });
  it.each(["Freshers welcome", "No prior experience required", "Experience: 0–2 years", "1 to 2 years of experience", "Experience: 6–18 months", "2 years of relevant experience"])("accepts %s", (text) => {
    expect(hasFresherRequirements("Software Developer", text)).toBe(true);
  });
  it.each(["", "Junior role, React and Node.js", "Experience: 2–4 years", "Experience: 3 years", "Experience: 2+ years", "No freshers", "Freshers are not eligible", "Minimum 2 years experience", "Experience: 0–3 years", "Company founded 2 years ago", "Freshers welcome. Minimum 4 years experience required."])("rejects %s", (text) => {
    expect(hasFresherRequirements("Software Developer", text)).toBe(false);
  });
});
