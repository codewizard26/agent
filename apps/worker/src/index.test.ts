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

/**
 * `fieldCount` drives classifyPage: processTask now decides what it landed on
 * before filling, and a page with no fields is not treated as a form.
 */
function fakePage(url: string, goto?: () => Promise<unknown>, fieldCount = 6) {
  const fields = Array.from({ length: fieldCount }, (_, i) => ({
    selector: `#f${i}`, label: `Field ${i}`, type: "text", required: false, options: [],
  }));
  return {
    goto: vi.fn(goto ?? (async () => ({ status: () => 200 }))),
    url: () => url,
    waitForTimeout: vi.fn(async () => {}),
    bringToFront: vi.fn(async () => {}),
    innerText: vi.fn(async () => "Apply for this job"),
    evaluate: vi.fn(async () => fields),
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

describe("processTask with auto-submit", () => {
  const clean: AtsFiller = {
    name: "greenhouse",
    matches: () => true,
    fill: async () => ({ filled: [{ label: "Email", answerKey: "email" }], blocked: [] }),
  };

  function submittingPage(bodyText: string) {
    return {
      goto: vi.fn(async () => ({ status: () => 200 })),
      url: () => "https://job-boards.greenhouse.io/gitlab/jobs/1",
      waitForTimeout: vi.fn(async () => {}),
      waitForLoadState: vi.fn(async () => {}),
      bringToFront: vi.fn(async () => {}),
      evaluate: vi.fn(async () =>
        Array.from({ length: 6 }, (_, i) => ({
          selector: `#f${i}`, label: `Field ${i}`, type: "text", required: false, options: [],
        })),
      ),
      innerText: vi.fn(async () => bodyText),
      locator: () => ({
        first: () => ({
          count: async () => 1,
          isVisible: async () => true,
          click: vi.fn(async () => {}),
        }),
      }),
    } as never;
  }

  function submitDeps(bodyText: string, autoSubmit: boolean): ProcessDeps {
    return {
      ...deps({ fillers: [clean] }),
      openBrowser: vi.fn(async () => ({
        context: {} as never,
        page: submittingPage(bodyText),
        close: vi.fn(async () => {}),
      })),
      autoSubmit,
    };
  }

  it("submits and reports applied when the profile authorized it and nothing is blocked", async () => {
    const result = await processTask(task, submitDeps("Thanks for applying!", true));
    expect(result.status).toBe("applied");
  });

  it("still stops for the human when the profile has not authorized it", async () => {
    const result = await processTask(task, submitDeps("Thanks for applying!", false));
    expect(result.status).toBe("awaiting_human");
  });

  it("does not claim applied when the page never confirmed", async () => {
    // An unverified click must leave the task with the human. Recording an
    // application that may not exist is worse than asking twice.
    const result = await processTask(task, submitDeps("Submit application", true));
    expect(result.status).toBe("awaiting_human");
    expect(result.error).toMatch(/no confirmation/);
  });

  it("never submits while a required question is unanswered", async () => {
    const blocked = { ...submitDeps("Thanks for applying!", true), fillers: [
      { name: "gh", matches: () => true, fill: async () => ({ filled: [], blocked: ["Why us?"] }) } as AtsFiller,
    ] };
    const result = await processTask(task, blocked);
    expect(result.status).toBe("awaiting_human");
  });
});

describe("processTask when the browser will not open", () => {
  it("reports the task failed instead of throwing", async () => {
    // openBrowser sat outside the try, so a launch failure propagated out of
    // processTask, out of runWorkerLoop, and killed the worker process — which
    // under `pnpm dev` took the web server down with it. One locked Chrome
    // profile ended the whole session.
    const result = await processTask(task, {
      ...deps(),
      openBrowser: async () => {
        throw new Error(
          "browserType.launchPersistentContext: Opening in existing browser session.",
        );
      },
    });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/launchPersistentContext/);
  });
});
