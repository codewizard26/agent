import { describe, it, expect } from "vitest";
import { assertSharedDatabase } from "./database.js";

describe("assertSharedDatabase", () => {
  it("accepts a worker pointed at the shared database", () => {
    expect(() =>
      assertSharedDatabase({ DATABASE_URL: "postgresql://user:pw@host/db" }),
    ).not.toThrow();
  });

  it("refuses to start without DATABASE_URL", () => {
    // createDb() falls back to a local PGlite file when the variable is unset.
    // That fallback is fine for a test run and wrong for this process: the
    // worker then polls an empty scratch database for ever while the web app
    // writes tasks to Neon, and every click looks like a broken button.
    expect(() => assertSharedDatabase({})).toThrow(/DATABASE_URL/);
  });

  it("names the fix rather than just the fault", () => {
    expect(() => assertSharedDatabase({ DATABASE_URL: "  " })).toThrow(/env-file/i);
  });
});
