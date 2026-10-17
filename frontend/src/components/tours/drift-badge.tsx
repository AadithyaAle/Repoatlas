"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileX2,
  type LucideIcon,
  Wand2,
} from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DriftStatus } from "@/lib/api/types";
import { DRIFT_META, type DriftTone } from "@/lib/tours/drift";
import { cn } from "@/lib/utils";

export const DRIFT_ICONS: Record<DriftStatus, LucideIcon> = {
  HEALTHY: CheckCircle2,
  DRIFTED_AUTO_FIXED: Wand2,
  OUTDATED_NEEDS_REVIEW: AlertTriangle,
  BROKEN_FILE_DELETED: FileX2,
  UNVERIFIED: CircleHelp,
};

/** Tailwind classes per tone (badge background + text). */
export const DRIFT_TONE_CLASSES: Record<DriftTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "border-border bg-muted text-muted-foreground",
};

export type DriftBadgeProps = {
  status: DriftStatus;
  /** Hide the text label (icon only, label kept for screen readers). */
  iconOnly?: boolean;
  /** Disable the explanatory tooltip. */
  noTooltip?: boolean;
  className?: string;
};

/** Drift status pill (icon + label) with a tooltip explaining the status. */
export function DriftBadge({ status, iconOnly = false, noTooltip = false, className }: DriftBadgeProps) {
  const meta = DRIFT_META[status];
  const Icon = DRIFT_ICONS[status];

  const badge = (
    <span
      data-drift-status={status}
      tabIndex={noTooltip ? undefined : 0}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        DRIFT_TONE_CLASSES[meta.tone],
        className,
      )}
      aria-label={iconOnly || !noTooltip ? `${meta.label}: ${meta.description}` : undefined}
    >
      <Icon className="size-3" aria-hidden />
      {iconOnly ? <span className="sr-only">{meta.label}</span> : <span>{meta.label}</span>}
    </span>
  );

  if (noTooltip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{meta.label}</p>
        <p className="opacity-80">{meta.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
