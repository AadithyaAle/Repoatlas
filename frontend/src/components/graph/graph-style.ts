import type { Language, RiskLevel } from "@/lib/api/types";

/** Colour used for circular dependencies (nodes and edges). */
export const CYCLE_COLOR = "oklch(0.64 0.24 25)";

/** Colour of the blast-radius origin (the selected file). */
export const ORIGIN_COLOR = "var(--primary)";

/** Blast-radius depth palette: hot (direct) → cool (far). Always paired with a depth number. */
export const DEPTH_COLORS = {
  1: "oklch(0.74 0.18 50)",
  2: "oklch(0.85 0.16 95)",
  3: "oklch(0.76 0.12 220)",
} as const;

export function depthColor(depth: number): string {
  if (depth <= 0) return ORIGIN_COLOR;
  if (depth === 1) return DEPTH_COLORS[1];
  if (depth === 2) return DEPTH_COLORS[2];
  return DEPTH_COLORS[3];
}

export function depthLabel(depth: number): string {
  if (depth <= 0) return "Selected file";
  if (depth === 1) return "Direct dependents";
  return `Depth ${depth}`;
}

export const LANGUAGE_META: Record<Language, { label: string; color: string }> = {
  python: { label: "Python", color: "#3572A5" },
  javascript: { label: "JavaScript", color: "#f1e05a" },
  typescript: { label: "TypeScript", color: "#3178c6" },
};

export const RISK_META: Record<
  RiskLevel,
  { label: string; color: string; textClassName: string; description: string }
> = {
  LOW: {
    label: "Low",
    color: "oklch(0.72 0.17 162)",
    textClassName: "text-emerald-600 dark:text-emerald-400",
    description: "Few files depend on this one. Changes are well contained.",
  },
  MEDIUM: {
    label: "Medium",
    color: "oklch(0.8 0.16 85)",
    textClassName: "text-amber-600 dark:text-amber-400",
    description: "A noticeable slice of the codebase depends on this file. Review dependents before changing its API.",
  },
  HIGH: {
    label: "High",
    color: "oklch(0.72 0.19 45)",
    textClassName: "text-orange-600 dark:text-orange-400",
    description: "Many files are affected, directly or transitively. Prefer additive, backwards-compatible changes.",
  },
  CRITICAL: {
    label: "Critical",
    color: "oklch(0.64 0.24 25)",
    textClassName: "text-red-600 dark:text-red-400",
    description: "A large part of the repository breaks if this file's behaviour changes. Treat as core infrastructure.",
  },
};

/** Thresholds mirrored from the backend (`graph_algorithms.risk_level`). */
export const RISK_THRESHOLDS: readonly { level: RiskLevel; below: number | null }[] = [
  { level: "LOW", below: 5 },
  { level: "MEDIUM", below: 15 },
  { level: "HIGH", below: 35 },
  { level: "CRITICAL", below: null },
];
