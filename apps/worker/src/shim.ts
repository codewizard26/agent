/**
 * Makes `page.evaluate` survive esbuild's keepNames transform.
 *
 * `tsx` — how this worker runs — compiles with keepNames on, which rewrites
 * every named function into `__name(fn, "fn")`. esbuild puts that helper in the
 * module scope, but `page.evaluate` serialises the function and runs it inside
 * the page, where nothing named `__name` exists. The browser throws
 * "ReferenceError: __name is not defined" and harvestFields returns no fields
 * at all, so an application fills nothing and blocks nothing.
 *
 * Verified 2026-09-04 on a live GitLab Greenhouse form: the task failed with
 * exactly that error, `filled: []`, `blocked: []`.
 *
 * Vitest transforms without keepNames, which is why the harvest tests pass
 * against a real browser while the worker fills nothing. The shim makes both
 * paths behave the same rather than papering over one of them.
 */
export const KEEP_NAMES_SHIM = `
  if (typeof globalThis.__name !== "function") {
    globalThis.__name = function (target) { return target; };
  }
`;
