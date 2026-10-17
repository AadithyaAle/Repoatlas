import { formatPercent } from "@/lib/dashboard/format";
import { sparkBars, sparklineGeometry } from "@/lib/dashboard/sparkline";
import { cn } from "@/lib/utils";

export type SparklineProps = {
  values: readonly number[];
  /** Accessible name, e.g. "Healthy share per sync". */
  label: string;
  /** Optional per-value descriptions (SVG tooltips), same length as `values`. */
  pointLabels?: readonly string[];
  variant?: "line" | "bars";
  width?: number;
  height?: number;
  min?: number;
  max?: number;
  formatValue?: (value: number) => string;
  /** Tailwind stroke class for the line variant. */
  strokeClassName?: string;
  /** Tailwind fill class for the area (line) or bars. */
  fillClassName?: string;
  /** Text shown when there are no values. */
  emptyText?: string;
  className?: string;
};

/** Tiny trend chart (SVG). Stretches to its container width; height is fixed. */
export function Sparkline({
  values,
  label,
  pointLabels,
  variant = "line",
  width = 120,
  height = 32,
  min = 0,
  max = 100,
  formatValue = (v) => formatPercent(v),
  strokeClassName = "stroke-primary",
  fillClassName,
  emptyText = "No data yet",
  className,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        {emptyText}
      </div>
    );
  }

  const description = `${label}: ${values.map(formatValue).join(", ")}`;
  const tooltip = (i: number) => pointLabels?.[i] ?? formatValue(values[i] ?? 0);

  return (
    <svg
      role="img"
      aria-label={description}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block w-full overflow-visible", className)}
      style={{ height }}
    >
      {variant === "bars" ? (
        sparkBars(values, { width, height, min, max }).map((bar, i) => (
          <rect
            key={i}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={1}
            className={fillClassName ?? "fill-primary/70"}
          >
            <title>{tooltip(i)}</title>
          </rect>
        ))
      ) : (
        <SparkLine
          values={values}
          width={width}
          height={height}
          min={min}
          max={max}
          strokeClassName={strokeClassName}
          fillClassName={fillClassName ?? "fill-primary/10"}
          title={values.map((_, i) => tooltip(i)).join("\n")}
        />
      )}
    </svg>
  );
}

function SparkLine({
  values,
  width,
  height,
  min,
  max,
  strokeClassName,
  fillClassName,
  title,
}: {
  values: readonly number[];
  width: number;
  height: number;
  min: number;
  max: number;
  strokeClassName: string;
  fillClassName: string;
  title: string;
}) {
  const geometry = sparklineGeometry(values, { width, height, min, max });
  return (
    <g>
      <title>{title}</title>
      <path d={geometry.area} className={cn("stroke-none", fillClassName)} />
      <path
        d={geometry.line}
        fill="none"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={strokeClassName}
      />
    </g>
  );
}
