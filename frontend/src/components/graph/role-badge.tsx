import type * as React from "react";

import type { FileRole } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export type RoleMeta = {
  label: string;
  /** One-line description of what the role means for a developer. */
  description: string;
  /** The exact classification rule used by the analyzer. */
  rule: string;
  /** CSS colour (used for dots, minimap, legend). */
  color: string;
  /** Tailwind classes for the badge. */
  badgeClassName: string;
};

/** Display order (most interesting first). */
export const ROLE_ORDER: readonly FileRole[] = [
  "ENTRY_POINT",
  "GOD_MODULE",
  "CORE_UTILITY",
  "STANDARD",
  "LEAF",
  "ISOLATED",
];

export const ROLE_META: Record<FileRole, RoleMeta> = {
  ENTRY_POINT: {
    label: "Entry point",
    description:
      "Nothing in the repo imports this file, but it imports others — execution likely starts here (CLI, server, page, script).",
    rule: "in-degree = 0 and out-degree > 0",
    color: "oklch(0.72 0.17 162)",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  GOD_MODULE: {
    label: "God module",
    description:
      "Heavily imported and heavily importing — a coupling hotspot. Changes here are risky and it is a refactoring candidate.",
    rule: "in-degree ≥ 5 and out-degree ≥ 5",
    color: "oklch(0.68 0.21 15)",
    badgeClassName: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  CORE_UTILITY: {
    label: "Core utility",
    description:
      "Imported by many files while depending on little — a shared foundation. Stable, but every change ripples widely.",
    rule: "in-degree ≥ 5 and out-degree ≤ 2",
    color: "oklch(0.72 0.14 230)",
    badgeClassName: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  STANDARD: {
    label: "Standard",
    description: "An ordinary file in the middle of the graph that matches no special rule.",
    rule: "none of the other rules match",
    color: "oklch(0.7 0.02 286)",
    badgeClassName: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  },
  LEAF: {
    label: "Leaf",
    description:
      "Imported by other files but imports no project files itself — usually constants, types or small helpers.",
    rule: "in-degree > 0 and out-degree = 0",
    color: "oklch(0.7 0.16 295)",
    badgeClassName: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  ISOLATED: {
    label: "Isolated",
    description:
      "No project imports in either direction — standalone scripts, config, or code loaded dynamically.",
    rule: "in-degree = 0 and out-degree = 0",
    color: "oklch(0.55 0.01 286)",
    badgeClassName: "border-zinc-500/20 bg-transparent text-muted-foreground",
  },
};

export type RoleBadgeProps = {
  role: FileRole;
  /** Show the role description as a native tooltip (title attribute). */
  withTitle?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"span">, "children" | "role">;

/** Coloured badge for a file's structural role. Colour is paired with a text label. */
export function RoleBadge({ role, withTitle = true, className, ...props }: RoleBadgeProps) {
  const meta = ROLE_META[role];
  return (
    <span
      data-role={role}
      title={withTitle ? `${meta.label}: ${meta.rule}` : undefined}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
        meta.badgeClassName,
        className,
      )}
      {...props}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}
