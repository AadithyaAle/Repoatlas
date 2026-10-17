/** Pure number/percentage helpers shared by the dashboard, repo page and chart primitives. */

/** Clamp to the 0..100 range; non-finite input becomes 0. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** `part / total` as a clamped 0..100 percentage (0 when `total` is not positive). */
export function ratioToPercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return clampPercent((part / total) * 100);
}

/**
 * Format a 0..100 percentage, e.g. `42%`. Values are clamped. With `fractionDigits = 0`, tiny
 * non-zero values render as `<1%` and almost-complete values as `>99%` so rounding never
 * pretends something is empty or done when it isn't.
 */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const clamped = clampPercent(value);
  if (fractionDigits === 0) {
    if (clamped > 0 && clamped < 1) return "<1%";
    if (clamped > 99 && clamped < 100) return ">99%";
  }
  return `${clamped.toFixed(fractionDigits)}%`;
}

/** Format a 0..1 ratio (e.g. first-try accuracy) as a percentage. */
export function formatRatio(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatPercent(value * 100, fractionDigits);
}

/** Sum of the positive, finite values of a record / array. */
export function sumValues(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) if (Number.isFinite(v) && v > 0) total += v;
  return total;
}
