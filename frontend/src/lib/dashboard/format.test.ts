import { describe, expect, it } from "vitest";

import { clampPercent, formatPercent, formatRatio, ratioToPercent, sumValues } from "./format";

describe("clampPercent / ratioToPercent", () => {
  it("clamps to 0..100 and handles non-finite input", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("computes safe ratios", () => {
    expect(ratioToPercent(1, 4)).toBe(25);
    expect(ratioToPercent(1, 0)).toBe(0);
    expect(ratioToPercent(5, 4)).toBe(100);
    expect(ratioToPercent(Number.NaN, 4)).toBe(0);
  });
});

describe("formatPercent", () => {
  it("rounds and clamps", () => {
    expect(formatPercent(42.4)).toBe("42%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(150)).toBe("100%");
    expect(formatPercent(12.345, 1)).toBe("12.3%");
  });

  it("never rounds tiny or almost-complete values to 0% / 100%", () => {
    expect(formatPercent(0.4)).toBe("<1%");
    expect(formatPercent(99.6)).toBe(">99%");
  });

  it("renders a dash for missing values", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatRatio / sumValues", () => {
  it("formats 0..1 ratios", () => {
    expect(formatRatio(0.75)).toBe("75%");
    expect(formatRatio(1)).toBe("100%");
    expect(formatRatio(null)).toBe("—");
  });

  it("sums only positive finite values", () => {
    expect(sumValues([1, 2, -3, Number.NaN, 4])).toBe(7);
    expect(sumValues([])).toBe(0);
  });
});
