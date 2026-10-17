import { RISK_META, RISK_THRESHOLDS } from "@/components/graph/graph-style";
import type { RiskLevel } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Score breakpoints → each band gets an equal quarter of the gauge (scores are skewed low). */
const BANDS: readonly [number, number][] = [
  [0, 5],
  [5, 15],
  [15, 35],
  [35, 100],
];

/** Map a 0–100 risk score onto a 0–1 gauge position using equal-width bands. */
export function riskGaugePosition(score: number): number {
  const s = Math.min(100, Math.max(0, score));
  for (let i = 0; i < BANDS.length; i++) {
    const [lo, hi] = BANDS[i]!;
    if (s < hi || i === BANDS.length - 1) {
      return (i + (s - lo) / (hi - lo)) / BANDS.length;
    }
  }
  return 1;
}

export type RiskMeterProps = {
  score: number;
  level: RiskLevel;
  className?: string;
};

/** Segmented bar gauge for a blast-radius risk score with the level spelled out. */
export function RiskMeter({ score, level, className }: RiskMeterProps) {
  const meta = RISK_META[level];
  const position = riskGaugePosition(score);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Risk score
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{score.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
        </div>
        <span
          className={cn(
            "rounded-md border px-2 py-1 text-xs font-semibold tracking-wide uppercase",
            meta.textClassName,
          )}
          style={{ borderColor: `color-mix(in oklab, ${meta.color} 45%, transparent)` }}
        >
          {meta.label} risk
        </span>
      </div>

      <div
        role="meter"
        aria-label="Blast radius risk score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number(score.toFixed(2))}
        aria-valuetext={`${score.toFixed(1)} out of 100, ${meta.label} risk`}
        className="relative pt-1"
      >
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {RISK_THRESHOLDS.map(({ level: bandLevel }) => (
            <div
              key={bandLevel}
              className={cn("h-full flex-1 transition-opacity", bandLevel !== level && "opacity-35")}
              style={{ backgroundColor: RISK_META[bandLevel].color }}
            />
          ))}
        </div>
        <div
          aria-hidden
          className="absolute top-0 h-4.5 w-1 -translate-x-1/2 rounded-full bg-foreground shadow ring-2 ring-background transition-[left] duration-500 motion-reduce:transition-none"
          style={{ left: `${position * 100}%` }}
        />
        <div className="mt-1.5 grid grid-cols-4 text-[10px] text-muted-foreground tabular-nums">
          {RISK_THRESHOLDS.map(({ level: bandLevel, below }, i) => {
            const from = i === 0 ? 0 : (RISK_THRESHOLDS[i - 1]?.below ?? 0);
            return (
              <span key={bandLevel} className={cn(bandLevel === level && "font-medium text-foreground")}>
                {RISK_META[bandLevel].label} {below === null ? `≥${from}` : `${from}–${below}`}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
