import { describe, it, expect } from "vitest";
import { resolveResumePath } from "./resume.js";

describe("resolveResumePath", () => {
  it("uses the resume belonging to the profile the task came from", () => {
    // Two people share this database and each application must carry its own
    // person's resume. The profile row is the only correct source.
    expect(
      resolveResumePath({
        name: "Shambhavi Soumya",
        resumeBlobUrl: "/Users/x/Downloads/resumenew.pdf",
      }),
    ).toBe("/Users/x/Downloads/resumenew.pdf");
  });

  it("refuses to fall back to a shared path when a profile has no resume", () => {
    // The previous fallback was a single RESUME_PATH env var. On a profile with
    // no resume of its own, that uploads whatever file it points at — which on
    // a two-person install is the other person's resume, sent under this
    // person's name. Failing the task is the only safe outcome.
    expect(() =>
      resolveResumePath({ name: "Nikhil Mishra", resumeBlobUrl: null }),
    ).toThrow(/Nikhil Mishra/);
  });

  it("names the profile in the error so the fix is obvious", () => {
    expect(() => resolveResumePath({ name: "Nikhil Mishra", resumeBlobUrl: "" })).toThrow(
      /no resume on file/i,
    );
  });
});
