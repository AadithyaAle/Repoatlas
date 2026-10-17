/** Pure geometry for the `<Sparkline/>` chart primitive. */

export type SparklineGeometry = {
  points: { x: number; y: number }[];
  /** SVG path `d` for the line (empty when there are no values). */
  line: string;
  /** SVG path `d` for the filled area under the line. */
  area: string;
};

export type SparklineOptions = {
  width: number;
  height: number;
  /** Domain minimum (default: 0). */
  min?: number;
  /** Domain maximum (default: 100). */
  max?: number;
  /** Vertical padding so the stroke isn't clipped (default: 2). */
  padding?: number;
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Map values onto an SVG box: x spreads evenly from 0 to `width`, y is inverted (higher values
 * are nearer the top). A single value draws a flat line across the full width.
 */
export function sparklineGeometry(
  values: readonly number[],
  { width, height, min = 0, max = 100, padding = 2 }: SparklineOptions,
): SparklineGeometry {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { points: [], line: "", area: "" };

  const span = max - min || 1;
  const usable = Math.max(0, height - padding * 2);
  const yFor = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    return round(padding + usable - ((clamped - min) / span) * usable);
  };

  const series = finite.length === 1 ? [...finite, ...finite] : finite;
  const step = width / (series.length - 1);
  const points = series.map((v, i) => ({ x: round(i * step), y: yFor(v) }));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const firstX = points[0]?.x ?? 0;
  const lastX = points[points.length - 1]?.x ?? width;
  const area = `${line} L${lastX} ${height} L${firstX} ${height} Z`;
  return { points, line, area };
}

export type SparkBar = { x: number; y: number; width: number; height: number };

/** Evenly spaced bars (min height 1.5px so zero values stay visible). */
export function sparkBars(
  values: readonly number[],
  { width, height, min = 0, max = 100, gap = 2 }: SparklineOptions & { gap?: number },
): SparkBar[] {
  const n = values.length;
  if (n === 0) return [];
  const barWidth = Math.max(1, (width - gap * (n - 1)) / n);
  const span = max - min || 1;
  return values.map((v, i) => {
    const clamped = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
    const h = Math.max(1.5, ((clamped - min) / span) * height);
    return {
      x: round(i * (barWidth + gap)),
      y: round(height - h),
      width: round(barWidth),
      height: round(h),
    };
  });
}
