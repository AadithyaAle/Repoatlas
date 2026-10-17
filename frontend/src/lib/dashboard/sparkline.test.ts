import { describe, expect, it } from "vitest";

import { sparkBars, sparklineGeometry } from "./sparkline";

describe("sparklineGeometry", () => {
  it("maps values onto the box with y inverted", () => {
    const g = sparklineGeometry([0, 100], { width: 100, height: 20, padding: 0 });
    expect(g.points).toEqual([
      { x: 0, y: 20 },
      { x: 100, y: 0 },
    ]);
    expect(g.line).toBe("M0 20 L100 0");
    expect(g.area).toBe("M0 20 L100 0 L100 20 L0 20 Z");
  });

  it("draws a flat full-width line for a single value", () => {
    const g = sparklineGeometry([50], { width: 100, height: 20, padding: 2 });
    expect(g.points).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
  });

  it("clamps out-of-domain values and ignores non-finite ones", () => {
    const g = sparklineGeometry([150, Number.NaN], { width: 10, height: 20, padding: 2 });
    expect(g.points.every((p) => p.y === 2)).toBe(true);
  });

  it("is empty without values", () => {
    expect(sparklineGeometry([], { width: 10, height: 10 })).toEqual({
      points: [],
      line: "",
      area: "",
    });
  });
});

describe("sparkBars", () => {
  it("spaces bars evenly with a minimum height", () => {
    expect(sparkBars([0, 100], { width: 10, height: 10, gap: 2 })).toEqual([
      { x: 0, y: 8.5, width: 4, height: 1.5 },
      { x: 6, y: 0, width: 4, height: 10 },
    ]);
    expect(sparkBars([], { width: 10, height: 10 })).toEqual([]);
  });
});
