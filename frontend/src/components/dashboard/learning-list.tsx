"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { ProgressBar } from "@/components/charts/progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTour } from "@/lib/api/hooks";
import type { TourProgress } from "@/lib/api/types";
import { clampPercent, ratioToPercent } from "@/lib/dashboard/format";

/** Completion (0..100) derived from the step ids, falling back to the API's percentage. */
export function progressPercent(progress: TourProgress): number {
  if (progress.total_steps > 0) {
    return ratioToPercent(progress.completed_step_ids.length, progress.total_steps);
  }
  return clampPercent(progress.percent_complete);
}

/** Tour title (+ repository) for a tour id, fetched via `useTour`. */
export function TourTitle({ tourId }: { tourId: string }) {
  const tour = useTour(tourId);
  if (tour.isPending) {
    return (
      <div className="space-y-1.5" aria-busy="true">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>
    );
  }
  if (tour.isError) {
    return (
      <div>
        <p className="font-medium text-muted-foreground">Tour unavailable</p>
        <p className="text-xs text-muted-foreground">It may have been deleted or made private.</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{tour.data.title}</p>
      <p className="truncate font-mono text-xs text-muted-foreground">
        {tour.data.repository.owner}/{tour.data.repository.name}
        {tour.data.owner_login ? ` · by @${tour.data.owner_login}` : null}
      </p>
    </div>
  );
}

function LearningRow({ progress }: { progress: TourProgress }) {
  const completed = progress.completed_step_ids.length;
  const total = progress.total_steps;
  const done = total > 0 && completed >= total;
  const action = done ? "Review" : completed === 0 ? "Start" : "Resume";

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <TourTitle tourId={progress.tour_id} />
          </div>
          {done && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" aria-hidden /> Completed
            </span>
          )}
        </div>
        <ProgressBar
          label="Progress"
          value={progressPercent(progress)}
          valueLabel={`${completed}/${total} steps`}
          size="md"
          indicatorClassName={done ? "bg-emerald-500" : "bg-primary"}
        />
      </div>
      <Button size="sm" variant={done ? "outline" : "default"} asChild className="sm:self-center">
        <Link href={`/tours/${progress.tour_id}`}>
          {action} <ArrowRight />
        </Link>
      </Button>
    </li>
  );
}

/** "My learning": tours the signed-in user is taking. */
export function LearningList({ items }: { items: readonly TourProgress[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <LearningRow key={item.tour_id} progress={item} />
      ))}
    </ul>
  );
}
