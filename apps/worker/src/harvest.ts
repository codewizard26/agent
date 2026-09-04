import type { Page } from "playwright-core";
import type { HarvestedField } from "./fillers/types.js";

/**
 * Enumerates every visible form control with its human label. Matching is on
 * label / aria-label / placeholder, never on `name` — React-controlled ATS forms
 * mostly have no name attributes at all.
 */
export async function harvestFields(page: Page): Promise<HarvestedField[]> {
  return page.evaluate(() => {
    function labelFor(el: HTMLElement): string {
      const id = el.getAttribute("id");
      if (id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (byFor?.textContent?.trim()) return byFor.textContent.trim();
      }
      const wrapping = el.closest("label");
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

      const aria = el.getAttribute("aria-label");
      if (aria?.trim()) return aria.trim();

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const target = document.getElementById(labelledBy);
        if (target?.textContent?.trim()) return target.textContent.trim();
      }
      return el.getAttribute("placeholder")?.trim() ?? "";
    }

    function selectorFor(el: HTMLElement, index: number): string {
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      el.setAttribute("data-job-agent", String(index));
      return `[data-job-agent="${index}"]`;
    }

    // Clear markers from any earlier harvest. Without this, a re-harvest
    // reassigns indices from zero while stale attributes survive, and a
    // selector captured in the first pass silently resolves to a different
    // element in the second — a mis-fill no assertion would catch.
    document
      .querySelectorAll("[data-job-agent]")
      .forEach((e) => e.removeAttribute("data-job-agent"));

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("input, textarea, select"),
    );

    const out: HarvestedField[] = [];
    elements.forEach((el, index) => {
      const type = el.getAttribute("type") ?? el.tagName.toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") return;
      // The captcha response field is not something to fill.
      if ((el.getAttribute("name") ?? "").includes("captcha")) return;

      const rect = el.getBoundingClientRect();
      const visible = type === "file" || rect.width > 0 || rect.height > 0;
      if (!visible) return;

      const rawLabel = labelFor(el);
      if (!rawLabel) return;

      out.push({
        selector: selectorFor(el, index),
        label: rawLabel.replace(/\*/g, "").replace(/\s+/g, " ").trim(),
        type,
        required: el.hasAttribute("required") || rawLabel.includes("*"),
        options:
          el instanceof HTMLSelectElement
            ? Array.from(el.options).map((o) => o.text.trim())
            : [],
      });
    });
    return out;
  });
}
