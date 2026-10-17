import { DriftBadge } from "@/components/tours/drift-badge";
import { driftCounts } from "@/lib/dashboard/health";
import { cn } from "@/lib/utils";

/** Ordered `<DriftBadge/> ×count` chips for a `{status: count}` map (e.g. `TourSummary.health`). */
export function DriftCountList({
  counts,
  className,
  emptyText = "No steps yet",
  noTooltip = false,
}: {
  counts: Record<string, number>;
  className?: string;
  emptyText?: string;
  /** Disable badge tooltips (required when rendered inside a link/button). */
  noTooltip?: boolean;
}) {
  const items = driftCounts(counts);
  if (items.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{emptyText}</p>;
  }
  return (
    <ul
      className={cn("flex flex-wrap items-center gap-2", className)}
      aria-label="Steps by drift status"
    >
      {items.map(({ status, count }) => (
        <li key={status} className="inline-flex items-center gap-1">
          <DriftBadge status={status} noTooltip={noTooltip} />
          <span className="text-xs font-medium tabular-nums">×{count}</span>
        </li>
      ))}
    </ul>
  );
}
