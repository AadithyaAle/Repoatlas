"use client";

import { Users } from "lucide-react";

import { ProgressBar } from "@/components/charts/progress-bar";
import { RelativeTime } from "@/components/common/relative-time";
import type { TraineeProgress } from "@/lib/api/types";
import { formatRatio } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

function accuracyClass(accuracy: number | null): string {
  if (accuracy === null) return "text-muted-foreground";
  if (accuracy >= 0.8) return "text-emerald-600 dark:text-emerald-400";
  if (accuracy >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

/** Trainees of one tour: progress, first-try checkpoint accuracy and last activity. */
export function TraineeProgressTable({
  trainees,
  tourTitle,
}: {
  trainees: readonly TraineeProgress[];
  tourTitle: string;
}) {
  if (trainees.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <Users className="size-4 shrink-0" aria-hidden />
        No trainees yet — share the player link to onboard someone.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">Trainee progress for {tourTitle}</caption>
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Trainee
            </th>
            <th scope="col" className="w-48 px-3 py-2 text-left font-medium">
              Progress
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              First-try accuracy
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Last activity
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {trainees.map((t) => {
            const name = t.user_login ?? `user ${t.user_id.slice(0, 8)}`;
            return (
              <tr key={t.user_id}>
                <td className="max-w-0 truncate px-3 py-2 font-medium" title={name}>
                  {t.user_login ? `@${t.user_login}` : <span className="text-muted-foreground">{name}</span>}
                </td>
                <td className="px-3 py-2">
                  <ProgressBar
                    layout="inline"
                    label={`${name} progress`}
                    value={t.completed_steps}
                    max={Math.max(t.total_steps, 1)}
                    valueLabel={`${t.completed_steps}/${t.total_steps}`}
                    indicatorClassName={
                      t.total_steps > 0 && t.completed_steps >= t.total_steps
                        ? "bg-emerald-500"
                        : "bg-primary"
                    }
                  />
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-medium tabular-nums",
                    accuracyClass(t.first_try_accuracy),
                  )}
                >
                  {formatRatio(t.first_try_accuracy)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  <RelativeTime iso={t.last_activity_at} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
