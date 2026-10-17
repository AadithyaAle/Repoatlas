"use client";

import { AlertTriangle, Pencil, Play } from "lucide-react";
import Link from "next/link";

import { DonutGauge } from "@/components/charts/donut-gauge";
import { Sparkline } from "@/components/charts/sparkline";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TourHealth } from "@/lib/api/types";
import { formatPercent } from "@/lib/dashboard/format";
import {
  HEALTH_TONE_META,
  attentionCount,
  healthTone,
  syncHistoryToPoints,
} from "@/lib/dashboard/health";
import { cn, shortSha } from "@/lib/utils";

import { DriftCountList } from "./drift-count-list";
import { TraineeProgressTable } from "./trainee-progress-table";

/** One owned tour on the dashboard: health ring, drift counts, sync trend and trainees. */
export function TourHealthCard({ item }: { item: TourHealth }) {
  const { tour } = item;
  const hasSteps = tour.step_count > 0;
  const score = hasSteps ? item.health_score : null;
  const tone = healthTone(score);
  const toneMeta = HEALTH_TONE_META[tone];
  const points = syncHistoryToPoints(item.sync_history);
  const latest = points[points.length - 1];
  const attention = attentionCount(tour.health);

  return (
    <Card className="gap-5">
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <DonutGauge
            value={score}
            label={`Health of ${tour.title}`}
            indicatorClassName={toneMeta.stroke}
            className="self-center sm:self-start"
          >
            <span className={cn("text-lg font-semibold tabular-nums", toneMeta.text)}>
              {formatPercent(score)}
            </span>
            <span className="text-[10px] tracking-wide text-muted-foreground uppercase">health</span>
          </DonutGauge>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-base font-semibold">
                <Link href={`/tours/${tour.id}`} className="rounded-sm hover:text-primary">
                  {tour.title}
                </Link>
              </h3>
              {tour.visibility === "PRIVATE" && <Badge variant="outline">Private</Badge>}
              <Badge variant="outline" className={cn("border-transparent bg-muted", toneMeta.text)}>
                {toneMeta.label}
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-mono">
                {tour.repository.owner}/{tour.repository.name}
              </span>{" "}
              · {tour.step_count} {tour.step_count === 1 ? "step" : "steps"} · base{" "}
              <code className="text-xs">{shortSha(tour.base_commit_sha)}</code> ·{" "}
              {tour.last_synced_at ? (
                <>
                  synced <RelativeTime iso={tour.last_synced_at} />
                </>
              ) : (
                "never synced"
              )}
            </p>
            <DriftCountList counts={tour.health} />
            {attention > 0 && (
              <p className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" aria-hidden />
                {attention} {attention === 1 ? "step needs" : "steps need"} review
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-2 sm:flex-col">
            <Button size="sm" asChild>
              <Link href={`/tours/${tour.id}`}>
                <Play /> Open player
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/tours/${tour.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <section className="space-y-2" aria-label="Sync history">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-xs font-medium text-muted-foreground">
                Sync history{points.length > 0 ? ` (${points.length})` : ""}
              </h4>
              {latest && (
                <span className="text-xs font-medium tabular-nums">
                  {formatPercent(latest.value)} healthy
                </span>
              )}
            </div>
            <Sparkline
              variant="bars"
              label="Healthy share per sync run, oldest to newest"
              values={points.map((p) => p.value)}
              pointLabels={points.map((p) => p.label)}
              height={40}
              emptyText="Not synced yet"
              fillClassName={toneMeta.fill}
            />
          </section>
          <section className="min-w-0 space-y-2" aria-label="Trainees">
            <h4 className="text-xs font-medium text-muted-foreground">
              Trainees ({item.trainees.length})
            </h4>
            <TraineeProgressTable trainees={item.trainees} tourTitle={tour.title} />
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
