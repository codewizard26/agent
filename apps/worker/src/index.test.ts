import { describe, it, expect, vi } from "vitest";
import { processTask, type ProcessDeps } from "./index.js";
import type { AtsFiller } from "./fillers/types.js";

const task = {
  id: "task-1",
  profileId: "profile-1",
  atsKey: "greenhouse:gitlab/1",
  slugKey: "gitlab|senior engineer",
  company: "GitLab",
  title: "Senior Engineer",
  applyUrl: "https://job-boards.greenhouse.io/gitlab/jobs/1",
};

function fakePage(url: string, goto?: () => Promise<unknown>) {
  return {
    goto: vi.fn(goto ?? (async () => ({ status: () => 200 }))),
    url: () => url,
    waitForTimeout: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => {}),
  } as never;
}

function deps(over: Partial<ProcessDeps> = {}): ProcessDeps {
  const filler: AtsFiller = {
    name: "greenhouse",
    matches: () => true,
    fill: async () => ({
      filled: [{ label: "Email", answerKey: "email" }],
      blocked: ["Why do you want to work at GitLab?"],
    }),
  };
  return {
    openBrowser: vi.fn(async () => ({
      context: {} as never,
      page: fakePage("https://job-boards.greenhouse.io/gitlab/jobs/1"),
      close: vi.fn(async () => {}),
    })),
    fillers: [filler],
    answers: new Map([["email", "nikhilmishra2608@gmail.com"]]),
    resumePath: "/tmp/resume.pdf",
    ...over,
  };
}

describe("processTask", () => {
  it("ends at awaiting_human — the worker never submits", async () => {
    const result = await processTask(task, deps());
    expect(result.status).toBe("awaiting_human");
  });

  it("reports the blocked free-text question", async () => {
    const result = await processTask(task, deps());
    expect(result.blocked).toContain("Why do you want to work at GitLab?");
  });

  it("records what was filled and from which key", async () => {
    const result = await processTask(task, deps());
    expect(result.fillReport.filled[0]).toEqual({
      label: "Email",
      answerKey: "email",
    });
  });

  it("selects the filler by the resolved landing url", async () => {
    const generic: AtsFiller = {
      name: "generic",
      matches: () => true,
      fill: async () => ({ filled: [], blocked: [] }),
    };
    const greenhouse: AtsFiller = {
      name: "greenhouse",
      matches: (url) => url.includes("greenhouse.io"),
      fill: async () => ({ filled: [], blocked: [] }),
    };
    const result = await processTask(
      task,
      deps({
        fillers: [generic, greenhouse],
        // redirected away from greenhouse to the company's own site
        openBrowser: vi.fn(async () => ({
          context: {} as never,
          page: fakePage("https://about.gitlab.com/jobs/1"),
          close: vi.fn(async () => {}),
        })),
      }),
    );
    expect(result.fillerUsed).toBe("generic");
  });

  it("returns failed rather than throwing when navigation dies", async () => {
    const result = await processTask(
      task,
      deps({
        openBrowser: vi.fn(async () => ({
          context: {} as never,
          page: fakePage(task.applyUrl, async () => {
            throw new Error("net::ERR_ABORTED");
          }),
          close: vi.fn(async () => {}),
        })),
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("ERR_ABORTED");
  });
});
