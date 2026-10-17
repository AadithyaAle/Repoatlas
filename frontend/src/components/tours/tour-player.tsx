"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Flag,
  Keyboard,
  Lock,
  Pencil,
  PlayCircle,
  RotateCcw,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { useSession } from "@/components/auth/auth-provider";
import { SignInButton, SignInPrompt } from "@/components/auth/login-card";
import { CodeViewer } from "@/components/code/code-viewer";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnswerStep, useFile, useGraph, useProgress, useTour } from "@/lib/api/hooks";
import type { Step, Tour, TourProgress } from "@/lib/api/types";
import { needsAttention } from "@/lib/tours/drift";
import { formatLineRange, languageFromPath } from "@/lib/tours/lines";
import {
  canAdvance,
  formatStepParam,
  isStepReachable,
  type NavigationState,
  parseStepParam,
  percentComplete,
  resolveStepIndex,
  type StepIndex,
} from "@/lib/tours/navigation";
import { cn } from "@/lib/utils";

import { CheckpointQuiz } from "./checkpoint-quiz";
import { DriftBadge } from "./drift-badge";
import { MarkdownContent } from "./markdown";
import { ApiErrorAlert, ButtonSpinner } from "./shared";

function PlayerSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6" aria-busy="true">
      <span className="sr-only">Loading tour…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-2 w-full" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
        <Skeleton className="h-[560px] rounded-xl" />
      </div>
    </div>
  );
}

/** `/tours/[id]` — tour player. */
export function TourPlayer({ tourId }: { tourId: string }) {
  const tour = useTour(tourId);
  const { status, isSignedIn } = useSession();
  const progress = useProgress(tourId, { enabled: isSignedIn });

  if (tour.isPending || status === "loading" || (isSignedIn && progress.isPending)) {
    return <PlayerSkeleton />;
  }
  if (tour.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ErrorState error={tour.error} onRetry={() => void tour.refetch()} />
      </div>
    );
  }

  return (
    <PlayerView
      tour={tour.data}
      signedIn={isSignedIn}
      progress={progress.data ?? null}
      progressError={isSignedIn && progress.isError ? progress.error : null}
      onRetryProgress={() => void progress.refetch()}
    />
  );
}

// ---------------------------------------------------------------------------

function PlayerView({
  tour,
  signedIn,
  progress,
  progressError,
  onRetryProgress,
}: {
  tour: Tour;
  signedIn: boolean;
  progress: TourProgress | null;
  progressError: unknown;
  onRetryProgress: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localCompleted, setLocalCompleted] = React.useState<ReadonlySet<string>>(() => new Set());

  const steps = React.useMemo(
    () => [...tour.steps].sort((a, b) => a.position - b.position),
    [tour.steps],
  );
  const stepIds = React.useMemo(() => steps.map((s) => s.id), [steps]);
  const completed = React.useMemo(() => {
    const set = new Set<string>(progress?.completed_step_ids ?? []);
    for (const id of localCompleted) set.add(id);
    return set;
  }, [progress, localCompleted]);

  const nav: NavigationState = { stepIds, completed, signedIn };
  const current = resolveStepIndex(parseStepParam(searchParams.get("step")), nav);
  const step = current === "done" ? undefined : steps[current];
  const percent = percentComplete(stepIds, completed);
  const completedCount = stepIds.filter((id) => completed.has(id)).length;
  const signInNext = `/tours/${tour.id}${current === "done" ? "" : `?step=${formatStepParam(current)}`}`;

  const goTo = (index: StepIndex) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", formatStepParam(index));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const markCompleted = (stepId: string) => {
    setLocalCompleted((prev) => {
      if (prev.has(stepId)) return prev;
      const next = new Set(prev);
      next.add(stepId);
      return next;
    });
  };

  const isLast = typeof current === "number" && current === steps.length - 1;
  const canPrev = typeof current === "number" ? current > 0 : steps.length > 0;
  const canNext = typeof current === "number" && canAdvance(current, nav);

  const goPrev = () => {
    if (current === "done") goTo(steps.length - 1);
    else if (current > 0) goTo(current - 1);
  };
  const goNext = () => {
    if (typeof current !== "number" || !canNext) return;
    goTo(isLast ? "done" : current + 1);
  };

  // Keyboard ←/→ (ignored while typing, inside the editor or the graph canvas).
  const onKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.closest(".monaco-editor, .react-flow, [role='dialog']"))
    ) {
      return;
    }
    if (event.key === "ArrowLeft" && canPrev) {
      event.preventDefault();
      goPrev();
    } else if (event.key === "ArrowRight" && canNext) {
      event.preventDefault();
      goNext();
    }
  });

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const header = (
    <PageHeader
      className="pb-4"
      eyebrow={
        <Link
          href={`/repos/${tour.repository.owner}/${tour.repository.name}`}
          className="font-mono normal-case hover:text-foreground"
        >
          {tour.repository.owner}/{tour.repository.name}
        </Link>
      }
      title={tour.title}
      description={
        <div className="space-y-1">
          {tour.description && <p className="line-clamp-2">{tour.description}</p>}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {tour.owner_login && <span>by @{tour.owner_login}</span>}
            <span>
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
            {tour.visibility === "PRIVATE" && (
              <Badge variant="outline">
                <Lock aria-hidden /> Private
              </Badge>
            )}
          </p>
        </div>
      }
      actions={
        tour.is_owner && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/tours/${tour.id}/edit`}>
              <Pencil aria-hidden /> Edit tour
            </Link>
          </Button>
        )
      }
    />
  );

  const progressBar =
    steps.length > 0 &&
    (signedIn ? (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {completedCount} of {steps.length} steps completed
          </span>
          <span className="font-medium tabular-nums text-foreground">{percent}%</span>
        </div>
        <Progress value={percent} aria-label="Tour progress" />
        {Boolean(progressError) && (
          <ErrorState
            compact
            title="Couldn't load your progress"
            error={progressError}
            onRetry={onRetryProgress}
            className="mt-2"
          />
        )}
      </div>
    ) : (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground">
          You&apos;re browsing read-only. Sign in to track your progress and answer checkpoints.
        </span>
        <SignInButton next={signInNext} />
      </div>
    ));

  if (steps.length === 0) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6">
        {header}
        <EmptyState
          icon={PlayCircle}
          title="This tour has no steps yet"
          description={
            tour.is_owner
              ? "Open the builder to pin your first code range."
              : "Check back later — the author hasn't added any steps."
          }
          action={
            tour.is_owner ? (
              <Button asChild>
                <Link href={`/tours/${tour.id}/edit`}>
                  <Pencil aria-hidden /> Open builder
                </Link>
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  if (current === "done" || !step) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6">
        {header}
        {progressBar}
        <CompletionScreen
          tour={tour}
          steps={steps}
          completed={completed}
          signedIn={signedIn}
          onRestart={() => goTo(0)}
          onOpenStep={(index) => goTo(index)}
        />
      </div>
    );
  }

  const index: number = current;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6 sm:px-6">
      {header}
      {progressBar}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <StepMedia tour={tour} step={step} steps={steps} />

        <div className="lg:sticky lg:top-20 lg:self-start">
          <StepCard
            key={step.id}
            tour={tour}
            step={step}
            index={index}
            total={steps.length}
            signedIn={signedIn}
            isCompleted={completed.has(step.id)}
            signInNext={signInNext}
            onCompleted={() => markCompleted(step.id)}
            onAdvance={() => goTo(isLast ? "done" : index + 1)}
          />

          <nav aria-label="Step navigation" className="mt-3 space-y-3 rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={goPrev} disabled={!canPrev}>
                <ChevronLeft aria-hidden /> Prev
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {index + 1} / {steps.length}
              </span>
              <Button
                size="sm"
                onClick={goNext}
                disabled={!canNext}
                title={!canNext ? "Complete this step to continue" : undefined}
              >
                {isLast ? (
                  <>
                    Finish <Flag aria-hidden />
                  </>
                ) : (
                  <>
                    Next <ChevronRight aria-hidden />
                  </>
                )}
              </Button>
            </div>
            <ol className="flex flex-wrap justify-center gap-1.5" aria-label="Steps">
              {steps.map((s, i) => {
                const reachable = isStepReachable(i, nav);
                const done = completed.has(s.id);
                const isCurrent = i === index;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      disabled={!reachable}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`Step ${i + 1}: ${s.title}${done ? " (completed)" : ""}${!reachable ? " (locked)" : ""}`}
                      title={`${i + 1}. ${s.title}`}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
                        isCurrent && "border-primary bg-primary text-primary-foreground",
                        !isCurrent && done && "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                        !isCurrent && !done && "bg-background hover:bg-accent",
                      )}
                    >
                      {done && !isCurrent ? <Check className="size-3" aria-hidden /> : i + 1}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="hidden items-center justify-center gap-1 text-[11px] text-muted-foreground sm:flex">
              <Keyboard className="size-3" aria-hidden /> Use ← / → to move between steps
            </p>
          </nav>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepMedia({ tour, step, steps }: { tour: Tour; step: Step; steps: readonly Step[] }) {
  const graph = useGraph(tour.analysis_id);
  const file = useFile(tour.analysis_id, step.file_path);
  const highlightPaths = React.useMemo(
    () => Array.from(new Set(steps.map((s) => s.file_path))),
    [steps],
  );
  const highlight = React.useMemo(
    () => ({ start: step.start_line, end: step.end_line }),
    [step.start_line, step.end_line],
  );

  return (
    <div className="min-w-0 space-y-4">
      <section aria-label="Dependency graph" className="relative h-64 overflow-hidden rounded-xl border lg:h-72">
        {graph.isPending ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : graph.isError ? (
          <ErrorState className="m-3" compact error={graph.error} onRetry={() => void graph.refetch()} />
        ) : (
          <GraphCanvas
            graph={graph.data}
            highlightPaths={highlightPaths}
            selectedPath={step.file_path}
            focusPath={step.file_path}
            className="h-full w-full"
          />
        )}
      </section>

      <section aria-label="Pinned code" className="overflow-hidden rounded-xl border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={step.file_path}>
            {step.file_path}
          </span>
          <Badge variant="outline" className="font-mono">
            {formatLineRange(step.start_line, step.end_line)}
          </Badge>
          {file.data?.html_url && (
            <a
              href={`${file.data.html_url}#L${step.start_line}-L${step.end_line}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              GitHub ↗
            </a>
          )}
        </div>
        {file.isPending ? (
          <Skeleton className="h-[460px] rounded-none" />
        ) : file.isError ? (
          <div className="space-y-2 p-3">
            <p className="text-xs text-muted-foreground">
              The file couldn&apos;t be loaded from this snapshot — showing the snippet captured when
              the step was written.
            </p>
            <CodeViewer
              content={step.snippet_snapshot}
              language={languageFromPath(step.file_path)}
              path={`${step.file_path}#snapshot`}
              height={360}
            />
          </div>
        ) : (
          <CodeViewer
            content={file.data.content}
            language={file.data.language}
            path={file.data.path}
            highlight={highlight}
            height={460}
          />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepCard({
  tour,
  step,
  index,
  total,
  signedIn,
  isCompleted,
  signInNext,
  onCompleted,
  onAdvance,
}: {
  tour: Tour;
  step: Step;
  index: number;
  total: number;
  signedIn: boolean;
  isCompleted: boolean;
  signInNext: string;
  onCompleted: () => void;
  onAdvance: () => void;
}) {
  const answer = useAnswerStep(tour.id);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Move focus to the new step's heading for screen-reader / keyboard users.
  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const markDone = () => {
    answer.mutate(
      { stepId: step.id, body: { selected_index: null } },
      {
        onSuccess: () => {
          onCompleted();
          toast.success(index === total - 1 ? "Tour complete!" : "Step completed");
          onAdvance();
        },
      },
    );
  };

  return (
    <article className="space-y-4 rounded-xl border bg-card p-4" aria-labelledby={`step-${step.id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Step {index + 1} of {total}
        </span>
        <div className="flex items-center gap-1.5">
          {isCompleted && (
            <Badge variant="success">
              <CheckCircle2 aria-hidden /> Completed
            </Badge>
          )}
          {step.drift_status !== "HEALTHY" && <DriftBadge status={step.drift_status} />}
        </div>
      </div>
      <h2
        id={`step-${step.id}-title`}
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold tracking-tight outline-none"
      >
        {step.title}
      </h2>

      {needsAttention(step.drift_status) && (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertTitle>The code may have changed</AlertTitle>
          <AlertDescription>
            {step.drift_status === "BROKEN_FILE_DELETED"
              ? "The pinned file no longer exists in the latest commit. The snippet shown is from when this step was written."
              : "This code changed since the step was written and the author hasn't reviewed it yet. Line numbers may be off."}
          </AlertDescription>
        </Alert>
      )}

      <MarkdownContent emptyText="No explanation for this step.">{step.body_markdown}</MarkdownContent>

      {step.checkpoint ? (
        <CheckpointQuiz
          tourId={tour.id}
          stepId={step.id}
          checkpoint={step.checkpoint}
          signedIn={signedIn}
          alreadyCompleted={isCompleted}
          signInNext={signInNext}
          onCompleted={() => onCompleted()}
        />
      ) : signedIn ? (
        isCompleted ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden /> You&apos;ve completed this step.
          </p>
        ) : (
          <div className="space-y-2">
            <Button onClick={markDone} disabled={answer.isPending} className="w-full">
              {answer.isPending ? <ButtonSpinner /> : <Check aria-hidden />}
              {index === total - 1 ? "Mark as done & finish" : "Mark as done & continue"}
            </Button>
            <ApiErrorAlert error={answer.error} title="Couldn't save your progress" />
          </div>
        )
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------

function CompletionScreen({
  tour,
  steps,
  completed,
  signedIn,
  onRestart,
  onOpenStep,
}: {
  tour: Tour;
  steps: readonly Step[];
  completed: ReadonlySet<string>;
  signedIn: boolean;
  onRestart: () => void;
  onOpenStep: (index: number) => void;
}) {
  const checkpointCount = steps.filter((s) => s.checkpoint !== null).length;
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="mx-auto max-w-2xl space-y-6 rounded-xl border bg-card p-6 text-center sm:p-10" aria-labelledby="tour-complete-title">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Trophy className="size-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 id="tour-complete-title" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
          {signedIn ? "Tour complete!" : "You've reached the end"}
        </h2>
        <p className="text-muted-foreground">
          {signedIn
            ? `You worked through all ${steps.length} steps of “${tour.title}”.`
            : `That's all ${steps.length} steps of “${tour.title}”.`}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Steps</dt>
          <dd className="text-2xl font-semibold tabular-nums">{steps.length}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Checkpoints</dt>
          <dd className="text-2xl font-semibold tabular-nums">{checkpointCount}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Files</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {new Set(steps.map((s) => s.file_path)).size}
          </dd>
        </div>
      </dl>

      <ol className="space-y-1 text-left">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpenStep(i)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {completed.has(s.id) ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Completed" />
              ) : (
                <span className="flex size-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
              )}
              <span className="flex-1 truncate">{s.title}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatLineRange(s.start_line, s.end_line)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {!signedIn && (
        <SignInPrompt
          next={`/tours/${tour.id}`}
          title="Track your progress"
          description="Sign in to answer checkpoints and save your progress through this tour."
        />
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onRestart}>
          <RotateCcw aria-hidden /> Review from step 1
        </Button>
        <Button asChild>
          <Link href={`/repos/${tour.repository.owner}/${tour.repository.name}`}>
            Back to {tour.repository.name}
          </Link>
        </Button>
      </div>
    </section>
  );
}
