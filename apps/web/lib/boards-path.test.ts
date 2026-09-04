import { describe, it, expect } from "vitest";
import { resolveBoardsPath } from "./boards-path";

describe("resolveBoardsPath", () => {
  it("finds boards.yaml two levels up, which is where next dev runs from", () => {
    const exists = (p: string) => p === "/repo/sources/boards.yaml";
    expect(resolveBoardsPath("/repo/apps/web", exists)).toBe("/repo/sources/boards.yaml");
  });

  it("finds it beside the app, which is where a deployed bundle has it", () => {
    // On Vercel the function's cwd is the project root, not apps/web, so the
    // ../../ hop lands outside the deployment and the fetch dies on a missing
    // file rather than on anything to do with jobs.
    const exists = (p: string) => p === "/var/task/sources/boards.yaml";
    expect(resolveBoardsPath("/var/task", exists)).toBe("/var/task/sources/boards.yaml");
  });

  it("names every place it looked when there is no boards file", () => {
    expect(() => resolveBoardsPath("/nowhere", () => false)).toThrow(/boards\.yaml/);
  });
});
