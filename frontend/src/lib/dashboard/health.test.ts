import { describe, expect, it } from "vitest";

import {
  attentionCount,
  driftCounts,
  healthTone,
  healthyShare,
  syncHistoryToPoints,
  type SyncRun,
} from "./health";

describe("healthTone", () => {
  it("applies the thresholds", () => {
    expect(healthTone(100)).toBe("healthy");
    expect(healthTone(90)).toBe("healthy");
    expect(healthTone(89.9)).toBe("warning");
    expect(healthTone(60)).toBe("warning");
    expect(healthTone(59)).toBe("critical");
    expect(healthTone(0)).toBe("critical");
  });

  it("is unknown without a score", () => {
    expect(healthTone(null)).toBe("unknown");
    expect(healthTone(undefined)).toBe("unknown");
    expect(healthTone(Number.NaN)).toBe("unknown");
  });
});

describe("drift counts", () => {
  it("orders non-zero statuses and ignores unknown keys", () => {
    expect(driftCounts({ BROKEN_FILE_DELETED: 1, HEALTHY: 3, UNVERIFIED: 0, BOGUS: 2 })).toEqual([
      { status: "HEALTHY", count: 3 },
      { status: "BROKEN_FILE_DELETED", count: 1 },
    ]);
    expect(driftCounts(undefined)).toEqual([]);
  });

  it("computes the healthy share", () => {
    expect(healthyShare({ HEALTHY: 2, DRIFTED_AUTO_FIXED: 1, OUTDATED_NEEDS_REVIEW: 1 })).toBe(75);
    expect(healthyShare({})).toBeNull();
    expect(healthyShare(null)).toBeNull();
  });

  it("counts steps needing attention", () => {
    expect(attentionCount({ HEALTHY: 4, OUTDATED_NEEDS_REVIEW: 2, BROKEN_FILE_DELETED: 1 })).toBe(3);
    expect(attentionCount({})).toBe(0);
  });
});

describe("syncHistoryToPoints", () => {
  const run = (id: string, createdAt: string, counts: Record<string, number>): SyncRun => ({
    id,
    created_at: createdAt,
    from_commit_sha: `${id.repeat(7)}0000`,
    to_commit_sha: `${id.repeat(7)}ffff`,
    counts,
  });

  it("returns chronological points (API is newest first), skipping empty runs", () => {
    const points = syncHistoryToPoints([
      run("b", "2026-01-03T00:00:00Z", { HEALTHY: 1, BROKEN_FILE_DELETED: 1 }),
      run("a", "2026-01-02T00:00:00Z", { HEALTHY: 4 }),
      run("c", "2026-01-01T00:00:00Z", {}),
    ]);
    expect(points.map((p) => p.value)).toEqual([100, 50]);
    expect(points.map((p) => p.at)).toEqual(["2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"]);
    expect(points[1]?.label).toBe("bbbbbbb → bbbbbbb: 50% healthy");
  });

  it("handles missing history", () => {
    expect(syncHistoryToPoints([])).toEqual([]);
    expect(syncHistoryToPoints(undefined)).toEqual([]);
  });
});
