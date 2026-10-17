"use client";

import { Check, Crosshair, FolderSearch, Trash2, Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { CodeViewer, type LineRange as ViewerLineRange } from "@/components/code/code-viewer";
import { DiffViewer } from "@/components/code/diff-viewer";
import { ErrorState } from "@/components/common/error-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useFile, useResolveStep } from "@/lib/api/hooks";
import type { Language, ResolveDriftInput, Step } from "@/lib/api/types";
import { DRIFT_META, formatSimilarity } from "@/lib/tours/drift";
import { formatLineRange, type LineRange, validateLineRange } from "@/lib/tours/lines";

import { DriftBadge } from "./drift-badge";
import { ApiErrorAlert, ButtonSpinner } from "./shared";

export type DriftReviewSheetProps = {
  tourId: string;
  analysisId: string;
  step: Step | null;
  language: Language;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BROKEN_FILE_DELETED: start re-pinning this step to another file in the builder. */
  onRelocate: (step: Step) => void;
  /** Ask the builder to delete the step (it owns the confirm dialog). */
  onDelete: (step: Step) => void;
};

/** Review sheet for OUTDATED_NEEDS_REVIEW / BROKEN_FILE_DELETED steps. */
export function DriftReviewSheet({
  tourId,
  analysisId,
  step,
  language,
  open,
  onOpenChange,
  onRelocate,
  onDelete,
}: DriftReviewSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
        {step ? (
          // Keyed so local state (re-pin mode, selection) resets per step.
          <ReviewBody
            key={step.id}
            tourId={tourId}
            analysisId={analysisId}
            step={step}
            language={language}
            onDone={() => onOpenChange(false)}
            onRelocate={onRelocate}
            onDelete={onDelete}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>Step not found</SheetTitle>
            <SheetDescription>It may have been deleted.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReviewBody({
  tourId,
  analysisId,
  step,
  language,
  onDone,
  onRelocate,
  onDelete,
}: {
  tourId: string;
  analysisId: string;
  step: Step;
  language: Language;
  onDone: () => void;
  onRelocate: (step: Step) => void;
  onDelete: (step: Step) => void;
}) {
  const resolve = useResolveStep(tourId);
  const [repinning, setRepinning] = React.useState(false);
  const [selection, setSelection] = React.useState<LineRange | null>(null);
  const [pendingAction, setPendingAction] = React.useState<ResolveDriftInput["action"] | null>(null);
  const isBroken = step.drift_status === "BROKEN_FILE_DELETED";
  const file = useFile(analysisId, repinning && !isBroken ? step.file_path : null);

  const hasProposal = step.proposed_start_line !== null && step.proposed_end_line !== null;
  // File length is re-validated server-side (INVALID_LINE_RANGE).
  const selectionError = repinning ? validateLineRange(selection) : null;

  const handleSelection = React.useCallback((range: ViewerLineRange | null) => {
    setSelection(range);
  }, []);

  const run = (body: ResolveDriftInput, success: string) => {
    setPendingAction(body.action);
    resolve.mutate(
      { stepId: step.id, body },
      {
        onSuccess: () => {
          toast.success(success);
          onDone();
        },
        onSettled: () => setPendingAction(null),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 pt-10 sm:p-6 sm:pt-10">
      <SheetHeader className="p-0">
        <div className="flex flex-wrap items-center gap-2">
          <DriftBadge status={step.drift_status} />
          {step.drift_similarity !== null && (
            <span className="text-xs text-muted-foreground">
              Similarity {formatSimilarity(step.drift_similarity)}
            </span>
          )}
        </div>
        <SheetTitle className="text-lg">
          Step {step.position + 1}: {step.title}
        </SheetTitle>
        <SheetDescription>{DRIFT_META[step.drift_status].description}</SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-3">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">File</dt>
          <dd className="truncate font-mono text-xs" title={step.file_path}>{step.file_path}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Pinned lines</dt>
          <dd className="font-mono text-xs">{formatLineRange(step.start_line, step.end_line)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Proposed lines</dt>
          <dd className="font-mono text-xs">
            {step.proposed_start_line !== null && step.proposed_end_line !== null
              ? formatLineRange(step.proposed_start_line, step.proposed_end_line)
              : "—"}
          </dd>
        </div>
      </dl>

      {isBroken ? (
        <Alert variant="destructive">
          <AlertTitle>The pinned file was deleted</AlertTitle>
          <AlertDescription>
            <p>
              <code className="font-mono">{step.file_path}</code> no longer exists in the latest
              snapshot. Re-pin the step to another file (title, explanation and checkpoint are
              kept) or delete it.
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <section aria-labelledby="drift-diff-heading" className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <h3 id="drift-diff-heading" className="text-sm font-medium text-foreground">
              Original snippet vs. proposed location
            </h3>
            <span>Left: pinned snapshot · Right: proposed</span>
          </div>
          <DiffViewer
            original={step.snippet_snapshot}
            modified={step.proposed_snippet ?? ""}
            language={language}
            path={step.file_path}
            height={360}
            className="overflow-hidden rounded-lg border"
          />
          {!step.proposed_snippet && (
            <p className="text-xs text-muted-foreground">
              No confident match was found — keep the original lines or re-pin manually.
            </p>
          )}
        </section>
      )}

      {repinning && !isBroken && (
        <section aria-labelledby="repin-heading" className="space-y-2">
          <h3 id="repin-heading" className="text-sm font-medium">
            Select the new lines in <code className="font-mono text-xs">{step.file_path}</code>
          </h3>
          {file.isPending ? (
            <Skeleton className="h-[360px] rounded-lg" />
          ) : file.isError ? (
            <ErrorState error={file.error} onRetry={() => void file.refetch()} compact />
          ) : (
            <CodeViewer
              content={file.data.content}
              language={file.data.language}
              path={file.data.path}
              highlight={
                step.proposed_start_line !== null && step.proposed_end_line !== null
                  ? { start: step.proposed_start_line, end: step.proposed_end_line }
                  : null
              }
              selectable
              onSelectionChange={handleSelection}
              height={360}
              className="overflow-hidden rounded-lg border"
            />
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {selection
              ? `Selected ${formatLineRange(selection.start, selection.end)}`
              : "Drag across line numbers or select text to choose a range."}
          </p>
          {selection && selectionError && (
            <p className="text-xs text-destructive" role="alert">{selectionError}</p>
          )}
        </section>
      )}

      <ApiErrorAlert error={resolve.error} title="Couldn't resolve this step" />

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {isBroken ? (
          <>
            <Button onClick={() => onRelocate(step)}>
              <FolderSearch aria-hidden /> Re-pin to another file
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => onDelete(step)}>
              <Trash2 aria-hidden /> Delete step
            </Button>
          </>
        ) : repinning ? (
          <>
            <Button
              onClick={() =>
                selection &&
                run(
                  { action: "repin", start_line: selection.start, end_line: selection.end },
                  `Re-pinned to ${formatLineRange(selection.start, selection.end)}`,
                )
              }
              disabled={!selection || Boolean(selectionError) || resolve.isPending}
            >
              {pendingAction === "repin" ? <ButtonSpinner /> : <Crosshair aria-hidden />}
              {selection ? `Re-pin to ${formatLineRange(selection.start, selection.end)}` : "Re-pin"}
            </Button>
            <Button variant="ghost" onClick={() => setRepinning(false)} disabled={resolve.isPending}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => run({ action: "accept_proposed" }, "Accepted the proposed location")}
              disabled={!hasProposal || resolve.isPending}
              title={hasProposal ? undefined : "No proposed location available"}
            >
              {pendingAction === "accept_proposed" ? <ButtonSpinner /> : <Check aria-hidden />}
              Accept proposed location
            </Button>
            <Button
              variant="outline"
              onClick={() => run({ action: "keep_original" }, "Kept the original lines")}
              disabled={resolve.isPending}
            >
              {pendingAction === "keep_original" ? <ButtonSpinner /> : <Undo2 aria-hidden />}
              Keep original lines
            </Button>
            <Button variant="outline" onClick={() => setRepinning(true)} disabled={resolve.isPending}>
              <Crosshair aria-hidden /> Re-pin manually
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
