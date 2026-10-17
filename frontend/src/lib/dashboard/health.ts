import type { DriftStatus, RiskLevel, TourHealth } from "@/lib/api/types";
import { shortSha } from "@/lib/utils";

import { clampPercent, formatPercent, ratioToPercent, sumValues } from "./format";

export type SyncRun = TourHealth["sync_history"][number];

export type HealthTone = "healthy" | "warning" | "critical" | "unknown";

/** Health score (0..100) thresholds: `>= healthy` is green, `>= warning` amber, else red. */
export const HEALTH_THRESHOLDS = { healthy: 90, warning: 60 } as const;

/** Map a 0..100 health score to a tone. `null`/non-finite (e.g. a tour without steps) is unknown. */
export function healthTone(score: number | null | undefined): HealthTone {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unknown";
  const value = clampPercent(score);
  if (value >= HEALTH_THRESHOLDS.healthy) return "healthy";
  if (value >= HEALTH_THRESHOLDS.warning) return "warning";
  return "critical";
}

/** Literal Tailwind classes per tone (kept literal so Tailwind's scanner picks them up). */
export const HEALTH_TONE_META: Record<
  HealthTone,
  { label: string; text: string; stroke: string; fill: string; bg: string }
> = {
  healthy: {
    label: "Healthy",
    text: "text-emerald-600 dark:text-emerald-400",
    stroke: "stroke-emerald-500",
    fill: "fill-emerald-500/80",
    bg: "bg-emerald-500",
  },
  warning: {
    label: "Needs attention",
    text: "text-amber-600 dark:text-amber-400",
    stroke: "stroke-amber-500",
    fill: "fill-amber-500/80",
    bg: "bg-amber-500",
  },
  critical: {
    label: "Unhealthy",
    text: "text-destructive",
    stroke: "stroke-destructive",
    fill: "fill-destructive/80",
    bg: "bg-destructive",
  },
  unknown: {
    label: "Not verified",
    text: "text-muted-foreground",
    stroke: "stroke-muted-foreground",
    fill: "fill-muted-foreground/60",
    bg: "bg-muted-foreground",
  },
};

/** Statuses that count as "healthy" for the health score (matches the backend). */
export const HEALTHY_STATUSES: readonly DriftStatus[] = ["HEALTHY", "DRIFTED_AUTO_FIXED"];

/** Display order for drift statuses: good → bad → never checked. */
export const DRIFT_STATUS_ORDER: readonly DriftStatus[] = [
  "HEALTHY",
  "DRIFTED_AUTO_FIXED",
  "OUTDATED_NEEDS_REVIEW",
  "BROKEN_FILE_DELETED",
  "UNVERIFIED",
];

export type DriftCount = { status: DriftStatus; count: number };

/** Ordered non-zero drift counts from a `{status: count}` map (unknown statuses ignored). */
export function driftCounts(counts: Record<string, number> | null | undefined): DriftCount[] {
  if (!counts) return [];
  return DRIFT_STATUS_ORDER.flatMap((status) => {
    const count = counts[status] ?? 0;
    return Number.isFinite(count) && count > 0 ? [{ status, count }] : [];
  });
}

/** Share (0..100) of steps in a healthy status, or `null` when there are no steps. */
export function healthyShare(counts: Record<string, number> | null | undefined): number | null {
  if (!counts) return null;
  const total = sumValues(Object.values(counts));
  if (total === 0) return null;
  const healthy = sumValues(HEALTHY_STATUSES.map((s) => counts[s] ?? 0));
  return ratioToPercent(healthy, total);
}

/** Steps that need the owner's attention (outdated or broken). */
export function attentionCount(counts: Record<string, number> | null | undefined): number {
  if (!counts) return 0;
  return sumValues([counts.OUTDATED_NEEDS_REVIEW ?? 0, counts.BROKEN_FILE_DELETED ?? 0]);
}

export type SparkPoint = {
  /** Healthy share, 0..100. */
  value: number;
  /** Human-readable description (tooltip / screen readers). */
  label: string;
  at: string;
};

/**
 * Sync history (API order: newest first) → chronological sparkline points (oldest first).
 * Runs with no counted steps are skipped.
 */
export function syncHistoryToPoints(history: readonly SyncRun[] | null | undefined): SparkPoint[] {
  if (!history) return [];
  return [...history].reverse().flatMap((run) => {
    const share = healthyShare(run.counts);
    if (share === null) return [];
    return [
      {
        value: share,
        at: run.created_at,
        label: `${shortSha(run.from_commit_sha)} → ${shortSha(run.to_commit_sha)}: ${formatPercent(share)} healthy`,
      },
    ];
  });
}

/** Literal Tailwind classes per blast-radius risk level. */
export const RISK_LEVEL_META: Record<RiskLevel, { label: string; bar: string; badge: string }> = {
  LOW: {
    label: "Low",
    bar: "bg-emerald-500",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  MEDIUM: {
    label: "Medium",
    bar: "bg-amber-500",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  HIGH: {
    label: "High",
    bar: "bg-orange-500",
    badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  },
  CRITICAL: {
    label: "Critical",
    bar: "bg-rose-500",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  },
};
