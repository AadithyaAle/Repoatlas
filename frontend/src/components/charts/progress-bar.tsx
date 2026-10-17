import type * as React from "react";

import { formatPercent, ratioToPercent } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

export type ProgressBarProps = {
  value: number;
  max?: number;
  /** Accessible name; visible above the bar in the `stacked` layout. */
  label: string;
  /** Visible value text (defaults to the percentage). */
  valueLabel?: React.ReactNode;
  /** `stacked`: label row above the bar. `inline`: bar with the value on its right. */
  layout?: "stacked" | "inline";
  size?: "sm" | "md";
  /** Tailwind background class for the filled part. */
  indicatorClassName?: string;
  className?: string;
};

/** Accessible progress bar (`role="progressbar"`) that always shows its value as text. */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueLabel,
  layout = "stacked",
  size = "sm",
  indicatorClassName = "bg-primary",
  className,
}: ProgressBarProps) {
  const pct = ratioToPercent(value, max);
  const percentText = formatPercent(pct);
  const text = valueLabel ?? percentText;

  const bar = (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuetext={typeof valueLabel === "string" ? valueLabel : percentText}
      className={cn(
        "w-full overflow-hidden rounded-full bg-muted",
        size === "sm" ? "h-1.5" : "h-2.5",
        layout === "inline" && "flex-1",
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", indicatorClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );

  if (layout === "inline") {
    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)}>
        {bar}
        <span className="shrink-0 text-xs font-medium tabular-nums">{text}</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">{text}</span>
      </div>
      {bar}
    </div>
  );
}
