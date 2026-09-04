import { describe, it, expect, vi } from "vitest";
import { parseHnComment, type HnComment } from "./hn.js";

const comment: HnComment = {
  objectID: "43210",
  comment_text:
    "Acme Robotics | Senior Full Stack Engineer | REMOTE (worldwide) | " +
    "TypeScript, React, Node, Postgres | apply at https://acme.example/jobs/42",
  created_at_i: 1787850715,
};

function fakeClient(parsed: unknown) {
  return {
    parse: vi.fn().mockResolvedValue(parsed),
    searchWeb: vi.fn(),
  } as never;
}

describe("hn adapter", () => {
  it("builds a normalized job from a parsed comment", async () => {
    const job = await parseHnComment(
      comment,
      fakeClient({
        isJobPosting: true,
        company: "Acme Robotics",
        title: "Senior Full Stack Engineer",
        location: "Remote (worldwide)",
        remote: true,
        applyUrl: "https://acme.example/jobs/42",
      }),
    );
    expect(job).not.toBeNull();
    expect(job!.company).toBe("Acme Robotics");
    expect(job!.sourceKind).toBe("hn");
    expect(job!.dateFidelity).toBe("true");
  });

  it("takes postedAt from the comment timestamp, not the model", async () => {
    const job = await parseHnComment(comment, fakeClient({
      isJobPosting: true,
      company: "Acme Robotics",
      title: "Senior Full Stack Engineer",
      location: "Remote",
      remote: true,
      applyUrl: "https://acme.example/jobs/42",
    }));
    expect(job!.postedAt?.getTime()).toBe(comment.created_at_i * 1000);
  });

  it("drops comments the model says are not job postings", async () => {
    const job = await parseHnComment(
      comment,
      fakeClient({
        isJobPosting: false,
        company: "",
        title: "",
        location: "",
        remote: false,
        applyUrl: "",
      }),
    );
    expect(job).toBeNull();
  });

  it("drops comments when parsing returns null", async () => {
    expect(await parseHnComment(comment, fakeClient(null))).toBeNull();
  });
});
