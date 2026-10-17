import type { Language } from "@/lib/api/types";

/** Inclusive, 1-based line range (structurally identical to the code viewer's `LineRange`). */
export type LineRange = { start: number; end: number };

/** Mirrors backend `StepCreate._range`: `end_line - start_line` may not exceed 400. */
export const MAX_STEP_LINE_SPAN = 400;

/** "L12–L40", or "L12" for a single line. */
export function formatLineRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}–L${end}`;
}

export function formatRange(range: LineRange | null | undefined): string {
  return range ? formatLineRange(range.start, range.end) : "—";
}

/** Number of lines covered by an inclusive range. */
export function lineCount(range: LineRange): number {
  return Math.max(0, range.end - range.start + 1);
}

/** Order two line numbers into a range. */
export function normalizeRange(a: number, b: number): LineRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function sameRange(a: LineRange | null | undefined, b: LineRange | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.start === b.start && a.end === b.end;
}

/**
 * Client-side mirror of the backend line-range rules. Returns an error message or `null`.
 * `maxLine` (file length) is optional — the server re-validates (`INVALID_LINE_RANGE`).
 */
export function validateLineRange(
  range: LineRange | null | undefined,
  maxLine?: number,
): string | null {
  if (!range) return "Select the lines to pin in the code viewer.";
  const { start, end } = range;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "Line numbers must be integers.";
  if (start < 1) return "Lines start at 1.";
  if (end < start) return "The end line must be on or after the start line.";
  if (end - start > MAX_STEP_LINE_SPAN) {
    return `A step may pin at most ${MAX_STEP_LINE_SPAN} lines (selected ${lineCount(range)}).`;
  }
  if (maxLine !== undefined && end > maxLine) {
    return `The file only has ${maxLine} lines.`;
  }
  return null;
}

/** Best-effort language detection for snippets whose file is not in the graph. */
export function languageFromPath(path: string): Language {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (/\.(m|c)?jsx?$/.test(lower)) return "javascript";
  return "typescript";
}

/** "src/app/page.tsx" → "page.tsx". */
export function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}
