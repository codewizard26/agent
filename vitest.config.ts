import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts",
      // apps/web has no src/ — its code lives in app/, lib/ and components/.
      "apps/web/lib/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
  },
});
