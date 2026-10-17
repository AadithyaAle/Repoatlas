import type * as React from "react";

import { clampPercent, formatPercent } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

export type DonutGaugeProps = {
  /** 0..100; `null` renders an empty ring with a dash. */
  value: number | null;
  /** Accessible name, e.g. "Tour health". */
  label: string;
  size?: number;
  strokeWidth?: number;
  /** Tailwind stroke class for the filled arc, e.g. `stroke-emerald-500`. */
  indicatorClassName?: string;
  trackClassName?: string;
  /** Overrides the centered value text. */
  children?: React.ReactNode;
  className?: string;
};

/** Ring gauge (SVG) with the value printed in the middle. */
export function DonutGauge({
  value,
  label,
  size = 88,
  strokeWidth = 8,
  indicatorClassName = "stroke-primary",
  trackClassName = "stroke-muted",
  children,
  className,
}: DonutGaugeProps) {
  const pct = value === null ? 0 : clampPercent(value);
  const text = formatPercent(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * pct) / 100;
  const center = size / 2;

  return (
    <div
      role="img"
      aria-label={`${label}: ${text}`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={trackClassName}
        />
        {pct > 0 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className={cn("transition-[stroke-dasharray] duration-500", indicatorClassName)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        {children ?? <span className="text-lg font-semibold tabular-nums">{text}</span>}
      </div>
    </div>
  );
}
