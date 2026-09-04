import { describe, it, expect } from "vitest";
import { createDb } from "./client.js";

/**
 * Its own file on purpose: schema.test.ts owns a shared PGlite instance and
 * closes it in teardown, and touching DATABASE_URL from inside that file left
 * the teardown closing an instance this test had already replaced.
 */
describe("createDb without DATABASE_URL", () => {
  it("names the missing variable when running on Vercel", () => {
    // The local PGlite fallback is right for tests and a fresh clone, and wrong
    // in a deployed function: PGlite is not installed there, so the fallback
    // fails with "Cannot find module '@electric-sql/pglite'" — an error naming
    // a dependency rather than the unset variable that caused it.
    const prevUrl = process.env.DATABASE_URL;
    const prevVercel = process.env.VERCEL;
    delete process.env.DATABASE_URL;
    process.env.VERCEL = "1";
    try {
      expect(() => createDb()).toThrow(/DATABASE_URL/);
    } finally {
      if (prevUrl) process.env.DATABASE_URL = prevUrl;
      if (prevVercel) process.env.VERCEL = prevVercel;
      else delete process.env.VERCEL;
    }
  });

  it("still takes an explicit connection string over the environment", () => {
    expect(() => createDb("postgresql://user:pw@example.test/db")).not.toThrow();
  });
});
