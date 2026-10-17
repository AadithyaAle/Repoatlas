import type { FileRole } from "@/lib/api/types";

import { ratioToPercent, sumValues } from "./format";

export type BreakdownItem<K extends string = string> = {
  key: K;
  count: number;
  /** Share of the total, 0..100. */
  percent: number;
};

/** Display order for file roles: most architecturally interesting first. */
export const ROLE_ORDER: readonly FileRole[] = [
  "ENTRY_POINT",
  "GOD_MODULE",
  "CORE_UTILITY",
  "STANDARD",
  "LEAF",
  "ISOLATED",
];

/** Tailwind background classes per role (used by the stacked bar + legend swatches). */
export const ROLE_COLOR_CLASSES: Record<FileRole, string> = {
  ENTRY_POINT: "bg-sky-500",
  GOD_MODULE: "bg-rose-500",
  CORE_UTILITY: "bg-violet-500",
  STANDARD: "bg-zinc-400 dark:bg-zinc-500",
  LEAF: "bg-emerald-500",
  ISOLATED: "bg-zinc-300 dark:bg-zinc-700",
};

function isFileRole(value: string): value is FileRole {
  return (ROLE_ORDER as readonly string[]).includes(value);
}

/**
 * Turn the API's `role_breakdown` map into an ordered list (see `ROLE_ORDER`), skipping zero
 * counts and unknown roles. Percentages are relative to the included roles.
 */
export function orderRoleBreakdown(
  breakdown: Record<string, number> | null | undefined,
): BreakdownItem<FileRole>[] {
  if (!breakdown) return [];
  const entries = Object.entries(breakdown).filter(
    (entry): entry is [FileRole, number] =>
      isFileRole(entry[0]) && Number.isFinite(entry[1]) && entry[1] > 0,
  );
  const total = sumValues(entries.map(([, count]) => count));
  return entries
    .sort(([a], [b]) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b))
    .map(([key, count]) => ({ key, count, percent: ratioToPercent(count, total) }));
}

const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  javascript: "JavaScript",
};

const LANGUAGE_COLORS: Record<string, string> = {
  python: "bg-amber-500",
  typescript: "bg-sky-500",
  javascript: "bg-yellow-400",
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language;
}

export function languageColorClass(language: string): string {
  return LANGUAGE_COLORS[language.toLowerCase()] ?? "bg-zinc-400 dark:bg-zinc-500";
}

/** Language breakdown sorted by file count (desc), then name; zero counts dropped. */
export function orderLanguageBreakdown(
  breakdown: Record<string, number> | null | undefined,
): BreakdownItem[] {
  if (!breakdown) return [];
  const entries = Object.entries(breakdown).filter(
    ([, count]) => Number.isFinite(count) && count > 0,
  );
  const total = sumValues(entries.map(([, count]) => count));
  return entries
    .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))
    .map(([key, count]) => ({ key, count, percent: ratioToPercent(count, total) }));
}
