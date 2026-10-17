import { describe, expect, it } from "vitest";

import {
  DRIFT_META,
  DRIFT_STATUSES,
  formatSimilarity,
  isHealthy,
  needsAttention,
  normalizeCounts,
  summarizeHealth,
} from "./drift";

describe("drift metadata", () => {
  it("describes every status", () => {
    for (const status of DRIFT_STATUSES) {
      expect(DRIFT_META[status].label).not.toBe("");
      expect(DRIFT_META[status].description).not.toBe("");
    }
    expect(DRIFT_META.DRIFTED_AUTO_FIXED.description).toBe(
      "Code moved; line numbers were updated automatically.",
    );
  });

  it("classifies statuses", () => {
    expect(needsAttention("OUTDATED_NEEDS_REVIEW")).toBe(true);
    expect(needsAttention("BROKEN_FILE_DELETED")).toBe(true);
    expect(needsAttention("DRIFTED_AUTO_FIXED")).toBe(false);
    expect(isHealthy("DRIFTED_AUTO_FIXED")).toBe(true);
    expect(isHealthy("UNVERIFIED")).toBe(false);
  });
});

describe("summarizeHealth", () => {
  it("computes percent of steps not needing attention", () => {
    const summary = summarizeHealth([
      "HEALTHY",
      "DRIFTED_AUTO_FIXED",
      "OUTDATED_NEEDS_REVIEW",
      "UNVERIFIED",
    ]);
    expect(summary).toMatchObject({ total: 4, healthy: 2, attention: 1, unverified: 1, percent: 75 });
    expect(summary.counts.OUTDATED_NEEDS_REVIEW).toBe(1);
  });

  it("treats an empty tour as healthy", () => {
    expect(summarizeHealth([]).percent).toBe(100);
  });
});

describe("normalizeCounts / formatSimilarity", () => {
  it("normalises count maps", () => {
    expect(normalizeCounts({ HEALTHY: 3, BOGUS: 2 })).toEqual({
      HEALTHY: 3,
      DRIFTED_AUTO_FIXED: 0,
      OUTDATED_NEEDS_REVIEW: 0,
      BROKEN_FILE_DELETED: 0,
      UNVERIFIED: 0,
    });
    expect(normalizeCounts(null).HEALTHY).toBe(0);
  });

  it("formats similarity ratios", () => {
    expect(formatSimilarity(0.873)).toBe("87%");
    expect(formatSimilarity(1)).toBe("100%");
    expect(formatSimilarity(64)).toBe("64%");
    expect(formatSimilarity(null)).toBe("—");
  });
});
