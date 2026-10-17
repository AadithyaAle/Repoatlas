import { describe, expect, it } from "vitest";

import {
  ROLE_ORDER,
  languageColorClass,
  languageLabel,
  orderLanguageBreakdown,
  orderRoleBreakdown,
} from "./breakdown";

describe("orderRoleBreakdown", () => {
  it("orders by ROLE_ORDER, drops zero counts and unknown roles", () => {
    const result = orderRoleBreakdown({
      LEAF: 2,
      ENTRY_POINT: 1,
      GOD_MODULE: 0,
      BOGUS: 5,
      STANDARD: 1,
    });
    expect(result).toEqual([
      { key: "ENTRY_POINT", count: 1, percent: 25 },
      { key: "STANDARD", count: 1, percent: 25 },
      { key: "LEAF", count: 2, percent: 50 },
    ]);
  });

  it("handles empty / missing input", () => {
    expect(orderRoleBreakdown({})).toEqual([]);
    expect(orderRoleBreakdown(null)).toEqual([]);
  });

  it("covers every role exactly once", () => {
    expect(new Set(ROLE_ORDER).size).toBe(6);
  });
});

describe("orderLanguageBreakdown", () => {
  it("sorts by count desc then name", () => {
    const result = orderLanguageBreakdown({ python: 1, typescript: 3, javascript: 3, go: 0 });
    expect(result.map((r) => r.key)).toEqual(["javascript", "typescript", "python"]);
    expect(result[2]?.percent).toBeCloseTo((1 / 7) * 100);
  });

  it("labels and colors known languages with a fallback", () => {
    expect(languageLabel("typescript")).toBe("TypeScript");
    expect(languageLabel("rust")).toBe("rust");
    expect(languageColorClass("python")).toBe("bg-amber-500");
    expect(languageColorClass("rust")).toContain("bg-zinc");
  });
});
