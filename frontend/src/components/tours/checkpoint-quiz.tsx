"use client";

import { CheckCircle2, CircleX, ListChecks, RotateCcw } from "lucide-react";
import * as React from "react";

import { SignInButton } from "@/components/auth/login-card";
import { Button } from "@/components/ui/button";
import { useAnswerStep } from "@/lib/api/hooks";
import type { Answer, CheckpointPublic } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { MarkdownContent } from "./markdown";
import { ApiErrorAlert, ButtonSpinner } from "./shared";

export type CheckpointQuizProps = {
  tourId: string;
  stepId: string;
  checkpoint: CheckpointPublic;
  signedIn: boolean;
  /** Already completed according to progress (answer not revealed by the API). */
  alreadyCompleted: boolean;
  /** Path to return to after sign-in. */
  signInNext: string;
  onCompleted: (answer: Answer) => void;
};

const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-8px)" },
  { transform: "translateX(8px)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(5px)" },
  { transform: "translateX(0)" },
];

/** Multiple-choice checkpoint. Mount with `key={step.id}` so state resets per step. */
export function CheckpointQuiz({
  tourId,
  stepId,
  checkpoint,
  signedIn,
  alreadyCompleted,
  signInNext,
  onCompleted,
}: CheckpointQuizProps) {
  const answer = useAnswerStep(tourId);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<Answer | null>(null);
  const containerRef = React.useRef<HTMLFieldSetElement>(null);
  const id = React.useId();
  const solved = result?.correct === true;

  const shake = () => {
    const el = containerRef.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(SHAKE, { duration: 420, easing: "ease-in-out" });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (selected === null || !signedIn) return;
    answer.mutate(
      { stepId, body: { selected_index: selected } },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.correct || res.completed) onCompleted(res);
          if (!res.correct) shake();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby={`${id}-question`}>
      <fieldset
        ref={containerRef}
        disabled={!signedIn || solved || answer.isPending}
        className="space-y-2 rounded-lg border bg-muted/20 p-3"
        aria-describedby={result ? `${id}-feedback` : undefined}
      >
        <legend id={`${id}-question`} className="flex items-center gap-1.5 px-1 text-sm font-semibold">
          <ListChecks className="size-4 text-primary" aria-hidden />
          Checkpoint
        </legend>
        <MarkdownContent className="font-medium">{checkpoint.question}</MarkdownContent>
        <div role="radiogroup" aria-label="Answer options" className="space-y-1.5">
          {checkpoint.options.map((option, index) => {
            const checked = selected === index;
            const isCorrectPick = solved && checked;
            const isWrongPick = result !== null && !result.correct && checked;
            return (
              <label
                key={index}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border bg-background p-2.5 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-default",
                  checked && "border-primary",
                  isCorrectPick && "border-emerald-500 bg-emerald-500/10",
                  isWrongPick && "border-destructive bg-destructive/10",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-option`}
                  value={index}
                  checked={checked}
                  onChange={() => setSelected(index)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="flex-1">{option}</span>
                {isCorrectPick && <CheckCircle2 className="size-4 text-emerald-600" aria-label="Correct" />}
                {isWrongPick && <CircleX className="size-4 text-destructive" aria-label="Incorrect" />}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div id={`${id}-feedback`} aria-live="polite">
        {result && result.correct && (
          <div className="space-y-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4" aria-hidden /> Correct!
              {result.attempts > 1 && (
                <span className="font-normal text-muted-foreground">
                  ({result.attempts} attempts)
                </span>
              )}
            </p>
            {result.explanation && <MarkdownContent>{result.explanation}</MarkdownContent>}
          </div>
        )}
        {result && !result.correct && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
            <p className="flex items-center gap-1.5 font-medium text-destructive">
              <CircleX className="size-4" aria-hidden /> Not quite — try again.
            </p>
            <p className="text-xs text-muted-foreground">
              Attempt {result.attempts}. Re-read the highlighted code and pick another answer.
            </p>
          </div>
        )}
      </div>

      <ApiErrorAlert error={answer.error} title="Couldn't submit your answer" />

      {!signedIn ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">Sign in to answer checkpoints and track progress.</span>
          <SignInButton next={signInNext} />
        </div>
      ) : (
        !solved && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={selected === null || answer.isPending}>
              {answer.isPending ? (
                <ButtonSpinner />
              ) : result && !result.correct ? (
                <RotateCcw aria-hidden />
              ) : null}
              {result && !result.correct ? "Try again" : "Check answer"}
            </Button>
            {alreadyCompleted && !result && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" aria-hidden /> You already completed this checkpoint
              </span>
            )}
          </div>
        )
      )}
    </form>
  );
}
