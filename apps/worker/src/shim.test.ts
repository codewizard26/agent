import { describe, it, expect } from "vitest";
import { KEEP_NAMES_SHIM } from "./shim.js";

describe("KEEP_NAMES_SHIM", () => {
  it("defines a __name that returns its target untouched", () => {
    // esbuild's keepNames transform — which tsx turns on, and which is how the
    // worker runs — rewrites every named function inside page.evaluate into
    // __name(fn, "fn"). That helper is injected into the module scope, not the
    // page, so the browser throws "__name is not defined" and harvestFields
    // returns nothing. Vitest transforms differently, which is why the suite
    // stayed green while every real application filled zero fields.
    const scope: Record<string, unknown> = {};
    new Function("globalThis", KEEP_NAMES_SHIM).call(scope, scope);
    const name = scope.__name as (t: unknown, n: string) => unknown;
    expect(typeof name).toBe("function");
    const fn = () => 42;
    expect(name(fn, "fn")).toBe(fn);
  });

  it("does not clobber a __name the page already has", () => {
    const existing = () => "theirs";
    const scope: Record<string, unknown> = { __name: existing };
    new Function("globalThis", KEEP_NAMES_SHIM).call(scope, scope);
    expect(scope.__name).toBe(existing);
  });
});
