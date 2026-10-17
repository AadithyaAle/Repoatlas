"use client";

import { ArrowRight, CheckCircle2, GitCommitHorizontal, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SyncReport, SyncStepResult } from "@/lib/api/types";
import { DRIFT_META, DRIFT_STATUSES, formatSimilarity, needsAttention, normalizeCounts } from "@/lib/tours/drift";
import { formatLineRange } from "@/lib/tours/lines";
import { cn, shortSha } from "@/lib/utils";

import { DRIFT_ICONS, DRIFT_TONE_CLASSES, DriftBadge } from "./drift-badge";

export type SyncReportDialogProps = {
  report: SyncReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the review sheet for a step that needs attention. */
  onReview: (stepId: string) => void;
};

function newRange(result: SyncStepResult): string {
  if (result.new_start_line === null || result.new_end_line === null) return "—";
  return formatLineRange(result.new_start_line, result.new_end_line);
}

/** Result of "Sync & verify": commit range, per-status counts and per-step outcomes. */
export function SyncReportDialog({ report, open, onOpenChange, onReview }: SyncReportDialogProps) {
  const counts = normalizeCounts(report?.counts);
  const steps = report ? [...report.steps].sort((a, b) => a.position - b.position) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sync report</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <GitCommitHorizontal className="size-4" aria-hidden />
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {shortSha(report?.from_commit_sha)}
              </code>
              <ArrowRight className="size-3.5" aria-label="to" />
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {shortSha(report?.to_commit_sha)}
              </code>
              {report?.up_to_date && (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" aria-hidden /> Already on the latest commit
                </span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {report && (
          <>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Step counts by status">
              {DRIFT_STATUSES.map((status) => {
                const meta = DRIFT_META[status];
                const Icon = DRIFT_ICONS[status];
                return (
                  <li
                    key={status}
                    className={cn("rounded-lg border p-3", DRIFT_TONE_CLASSES[meta.tone])}
                    title={meta.description}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      <Icon className="size-3.5" aria-hidden />
                      {meta.label}
                    </div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">{counts[status]}</div>
                  </li>
                );
              })}
            </ul>

            {steps.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                This tour has no steps to verify.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Per-step sync results</caption>
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Step</th>
                      <th scope="col" className="px-3 py-2 font-medium">Lines</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Similarity</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((result) => (
                      <tr key={result.step_id} className="border-t align-top">
                        <td className="max-w-56 px-3 py-2">
                          <div className="truncate font-medium">
                            {result.position + 1}. {result.title}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground" title={result.file_path}>
                            {result.file_path}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                          {formatLineRange(result.old_start_line, result.old_end_line)}
                          <ArrowRight className="mx-1 inline size-3" aria-label="to" />
                          {newRange(result)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatSimilarity(result.similarity)}</td>
                        <td className="px-3 py-2">
                          <DriftBadge status={result.status} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {needsAttention(result.status) && (
                            <Button size="sm" variant="outline" onClick={() => onReview(result.step_id)}>
                              <Wrench aria-hidden />
                              {result.status === "BROKEN_FILE_DELETED" ? "Fix" : "Review"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
