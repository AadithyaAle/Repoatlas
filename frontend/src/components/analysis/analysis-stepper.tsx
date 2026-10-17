import { Check, Loader2, X } from "lucide-react";

import { PIPELINE, getStepStates, type PipelineStatus } from "@/lib/analysis-steps";
import type { AnalysisStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export type AnalysisStepperProps = {
  status: AnalysisStatus;
  /** Step to mark as failed when `status === "FAILED"`. */
  failedAt?: PipelineStatus;
  className?: string;
};

/** Vertical stepper over PENDING → FETCHING_TREE → PARSING_AST → COMPUTING_GRAPH → COMPLETED. */
export function AnalysisStepper({ status, failedAt, className }: AnalysisStepperProps) {
  const states = getStepStates(status, failedAt);

  return (
    <ol className={cn("space-y-0", className)} aria-label="Analysis progress">
      {PIPELINE.map((step, index) => {
        const state = states[index]?.state ?? "upcoming";
        const isLast = index === PIPELINE.length - 1;
        return (
          <li
            key={step.status}
            className="relative flex gap-4 pb-6 last:pb-0"
            aria-current={state === "current" ? "step" : undefined}
          >
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-8 left-[15px] h-[calc(100%-2rem)] w-px",
                  state === "complete" ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                state === "complete" && "border-primary bg-primary text-primary-foreground",
                state === "current" && "border-primary bg-primary/10 text-primary",
                state === "failed" && "border-destructive bg-destructive/10 text-destructive",
                state === "upcoming" && "bg-background text-muted-foreground",
              )}
            >
              {state === "complete" ? (
                <Check className="size-4" aria-hidden />
              ) : state === "current" ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : state === "failed" ? (
                <X className="size-4" aria-hidden />
              ) : (
                index + 1
              )}
            </span>
            <div className="min-w-0 pt-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  state === "upcoming" && "text-muted-foreground",
                  state === "failed" && "text-destructive",
                )}
              >
                {step.label}
                <span className="sr-only">
                  {" "}
                  ({state === "current" ? "in progress" : state})
                </span>
              </p>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
