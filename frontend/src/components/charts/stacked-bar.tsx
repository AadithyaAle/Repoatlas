import { formatPercent, ratioToPercent, sumValues } from "@/lib/dashboard/format";
import { cn, formatNumber } from "@/lib/utils";

export type StackedBarSegment = {
  key: string;
  label: string;
  value: number;
  /** Tailwind background class, e.g. `bg-sky-500`. */
  colorClass: string;
  /** Optional longer explanation (legend tooltip). */
  description?: string;
};

export type StackedBarProps = {
  segments: readonly StackedBarSegment[];
  /** Accessible name of the chart, e.g. "File roles". */
  label: string;
  formatValue?: (value: number) => string;
  showLegend?: boolean;
  className?: string;
  barClassName?: string;
};

/** Horizontal 100% stacked bar with a text legend (values + shares are always visible). */
export function StackedBar({
  segments,
  label,
  formatValue = formatNumber,
  showLegend = true,
  className,
  barClassName,
}: StackedBarProps) {
  const visible = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = sumValues(visible.map((s) => s.value));
  const rows = visible.map((s) => ({ ...s, percent: ratioToPercent(s.value, total) }));
  const summary =
    rows.length === 0
      ? "no data"
      : rows
          .map((s) => `${s.label} ${formatValue(s.value)} (${formatPercent(s.percent)})`)
          .join(", ");

  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="img"
        aria-label={`${label}: ${summary}`}
        className={cn("flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted", barClassName)}
      >
        {rows.map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${formatValue(s.value)} (${formatPercent(s.percent)})`}
            className={cn("h-full min-w-1 transition-[width]", s.colorClass)}
            style={{ width: `${s.percent}%` }}
          />
        ))}
      </div>
      {showLegend &&
        (rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-hidden>
            {rows.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5" title={s.description}>
                <span className={cn("size-2.5 rounded-sm", s.colorClass)} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{formatValue(s.value)}</span>
                <span className="text-muted-foreground/70 tabular-nums">
                  {formatPercent(s.percent)}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
