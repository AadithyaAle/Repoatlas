import type { DriftStatus } from "@/lib/api/types";

export type DriftTone = "success" | "info" | "warning" | "danger" | "muted";

export type DriftMeta = {
  label: string;
  /** One-sentence explanation (tooltips, legends). */
  description: string;
  tone: DriftTone;
};

/** Display order: healthy first, problems last. */
export const DRIFT_STATUSES = [
  "HEALTHY",
  "DRIFTED_AUTO_FIXED",
  "OUTDATED_NEEDS_REVIEW",
  "BROKEN_FILE_DELETED",
  "UNVERIFIED",
] as const satisfies readonly DriftStatus[];

export const DRIFT_META: Record<DriftStatus, DriftMeta> = {
  HEALTHY: {
    label: "Healthy",
    description: "The pinned code is unchanged in the latest commit.",
    tone: "success",
  },
  DRIFTED_AUTO_FIXED: {
    label: "Auto-fixed",
    description: "Code moved; line numbers were updated automatically.",
    tone: "info",
  },
  OUTDATED_NEEDS_REVIEW: {
    label: "Needs review",
    description:
      "The pinned code changed significantly. Review the proposed location or re-pin the step.",
    tone: "warning",
  },
  BROKEN_FILE_DELETED: {
    label: "File deleted",
    description: "The pinned file no longer exists. Re-pin the step to another file or delete it.",
    tone: "danger",
  },
  UNVERIFIED: {
    label: "Unverified",
    description: "This step hasn't been checked against a newer commit yet. Run “Sync & verify”.",
    tone: "muted",
  },
};

/** Statuses that require the owner to act. */
export function needsAttention(status: DriftStatus): boolean {
  return status === "OUTDATED_NEEDS_REVIEW" || status === "BROKEN_FILE_DELETED";
}

/** Statuses considered healthy for the health bar (pinned code is valid). */
export function isHealthy(status: DriftStatus): boolean {
  return status === "HEALTHY" || status === "DRIFTED_AUTO_FIXED";
}

export type HealthSummary = {
  total: number;
  healthy: number;
  attention: number;
  unverified: number;
  /** 0–100, rounded. 100 for an empty tour. */
  percent: number;
  counts: Record<DriftStatus, number>;
};

export function emptyDriftCounts(): Record<DriftStatus, number> {
  return {
    HEALTHY: 0,
    DRIFTED_AUTO_FIXED: 0,
    OUTDATED_NEEDS_REVIEW: 0,
    BROKEN_FILE_DELETED: 0,
    UNVERIFIED: 0,
  };
}

/**
 * Health of a set of steps. UNVERIFIED steps count as healthy for the percentage (they have
 * never failed a check) but are reported separately.
 */
export function summarizeHealth(statuses: readonly DriftStatus[]): HealthSummary {
  const counts = emptyDriftCounts();
  for (const status of statuses) counts[status] += 1;
  const total = statuses.length;
  const attention = counts.OUTDATED_NEEDS_REVIEW + counts.BROKEN_FILE_DELETED;
  const healthy = counts.HEALTHY + counts.DRIFTED_AUTO_FIXED;
  const percent = total === 0 ? 100 : Math.round(((total - attention) / total) * 100);
  return { total, healthy, attention, unverified: counts.UNVERIFIED, percent, counts };
}

/** Normalise a sync report's `counts` map (unknown keys ignored, missing keys = 0). */
export function normalizeCounts(counts: Record<string, number> | null | undefined): Record<DriftStatus, number> {
  const result = emptyDriftCounts();
  if (!counts) return result;
  for (const status of DRIFT_STATUSES) {
    const value = counts[status];
    if (typeof value === "number" && Number.isFinite(value)) result[status] = value;
  }
  return result;
}

/** Similarity is a 0–1 ratio from the backend; tolerate 0–100 too. */
export function formatSimilarity(similarity: number | null | undefined): string {
  if (similarity === null || similarity === undefined || Number.isNaN(similarity)) return "—";
  const pct = similarity <= 1 ? similarity * 100 : similarity;
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
}
