"use client";

import { HeartPulse } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DriftStatus } from "@/lib/api/types";
import { DRIFT_META, DRIFT_STATUSES, summarizeHealth } from "@/lib/tours/drift";
import { cn } from "@/lib/utils";

const SEGMENT_CLASSES: Record<DriftStatus, string> = {
  HEALTHY: "bg-emerald-500",
  DRIFTED_AUTO_FIXED: "bg-sky-500",
  OUTDATED_NEEDS_REVIEW: "bg-amber-500",
  BROKEN_FILE_DELETED: "bg-red-500",
  UNVERIFIED: "bg-muted-foreground/40",
};

/** Stacked health bar (per drift status) with an overall "% healthy" figure. */
export function HealthBar({
  statuses,
  className,
}: {
  statuses: readonly DriftStatus[];
  className?: string;
}) {
  const summary = summarizeHealth(statuses);
  const tone =
    summary.percent >= 90
      ? "text-emerald-600 dark:text-emerald-400"
      : summary.percent >= 60
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className={cn(
            "flex min-w-48 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
          role="group"
          aria-label={`Tour health ${summary.percent}% — ${summary.attention} step(s) need attention, ${summary.unverified} unverified`}
        >
          <HeartPulse className={cn("size-4 shrink-0", tone)} aria-hidden />
          <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            {summary.total > 0 &&
              DRIFT_STATUSES.map((status) =>
                summary.counts[status] > 0 ? (
                  <div
                    key={status}
                    className={SEGMENT_CLASSES[status]}
                    style={{ width: `${(summary.counts[status] / summary.total) * 100}%` }}
                  />
                ) : null,
              )}
          </div>
          <span className={cn("text-sm font-semibold tabular-nums", tone)}>{summary.percent}%</span>
          <span className="text-xs text-muted-foreground">healthy</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {DRIFT_STATUSES.map((status) => (
            <li key={status} className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", SEGMENT_CLASSES[status])} aria-hidden />
              {DRIFT_META[status].label}: {summary.counts[status]}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
