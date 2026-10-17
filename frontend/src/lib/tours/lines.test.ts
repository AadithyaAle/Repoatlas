import { describe, expect, it } from "vitest";

import {
  basename,
  formatLineRange,
  formatRange,
  languageFromPath,
  lineCount,
  normalizeRange,
  sameRange,
  validateLineRange,
} from "./lines";

describe("formatLineRange", () => {
  it("formats ranges and single lines", () => {
    expect(formatLineRange(12, 40)).toBe("L12–L40");
    expect(formatLineRange(7, 7)).toBe("L7");
    expect(formatRange(null)).toBe("—");
    expect(formatRange({ start: 1, end: 2 })).toBe("L1–L2");
  });
});

describe("range helpers", () => {
  it("counts and normalises", () => {
    expect(lineCount({ start: 3, end: 3 })).toBe(1);
    expect(lineCount({ start: 1, end: 10 })).toBe(10);
    expect(normalizeRange(9, 2)).toEqual({ start: 2, end: 9 });
    expect(sameRange({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(sameRange({ start: 1, end: 2 }, null)).toBe(false);
    expect(sameRange(null, undefined)).toBe(true);
  });
});

describe("validateLineRange", () => {
  it("mirrors the backend rules", () => {
    expect(validateLineRange(null)).toMatch(/select/i);
    expect(validateLineRange({ start: 0, end: 3 })).toMatch(/start at 1/);
    expect(validateLineRange({ start: 5, end: 3 })).toMatch(/end line/);
    expect(validateLineRange({ start: 1, end: 401 })).toBeNull();
    expect(validateLineRange({ start: 1, end: 402 })).toMatch(/400/);
    expect(validateLineRange({ start: 1, end: 20 }, 10)).toMatch(/10 lines/);
    expect(validateLineRange({ start: 1, end: 10 }, 10)).toBeNull();
  });
});

describe("path helpers", () => {
  it("guesses languages", () => {
    expect(languageFromPath("app/main.py")).toBe("python");
    expect(languageFromPath("src/index.js")).toBe("javascript");
    expect(languageFromPath("src/App.jsx")).toBe("javascript");
    expect(languageFromPath("lib/x.mjs")).toBe("javascript");
    expect(languageFromPath("src/page.tsx")).toBe("typescript");
  });

  it("extracts basenames", () => {
    expect(basename("src/app/page.tsx")).toBe("page.tsx");
    expect(basename("README")).toBe("README");
  });
});
