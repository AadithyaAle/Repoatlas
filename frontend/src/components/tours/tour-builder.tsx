"use client";

import {
  Eye,
  FileCode2,
  FolderSearch,
  Lock,
  MousePointerClick,
  Pin,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { useSession } from "@/components/auth/auth-provider";
import { SignInPrompt } from "@/components/auth/login-card";
import { CodeViewer, type LineRange as ViewerLineRange } from "@/components/code/code-viewer";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import { RoleBadge } from "@/components/graph/role-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateStep,
  useDeleteStep,
  useFile,
  useGraph,
  useMeta,
  useReorderSteps,
  useSyncTour,
  useTour,
  useUpdateStep,
} from "@/lib/api/hooks";
import type { CheckpointInput, GraphNode, Step, SyncReport, Tour } from "@/lib/api/types";
import { isOwnerCheckpoint } from "@/lib/api/types";
import { needsAttention } from "@/lib/tours/drift";
import {
  formatLineRange,
  languageFromPath,
  type LineRange,
  sameRange,
  validateLineRange,
} from "@/lib/tours/lines";
import { shortSha } from "@/lib/utils";

import { DriftReviewSheet } from "./drift-review-sheet";
import { HealthBar } from "./health-bar";
import { ButtonSpinner, ConfirmDialog } from "./shared";
import { StepForm, type StepFormValues } from "./step-form";
import { StepList } from "./step-list";
import { SyncReportDialog } from "./sync-report-dialog";
import { TourSettingsDialog } from "./tour-settings-dialog";

/** `/tours/[id]/edit` — tour builder (owner only). */
export function TourBuilder({ tourId }: { tourId: string }) {
  const { status, isSignedIn } = useSession();
  const tour = useTour(tourId);

  if (status === "loading" || (isSignedIn && tour.isPending)) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-8 sm:px-6" aria-busy="true">
        <span className="sr-only">Loading tour builder…</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-80" />
        <div className="grid gap-4 lg:grid-cols-[280px_1fr_1fr]">
          <Skeleton className="h-[60vh] rounded-xl" />
          <Skeleton className="h-[60vh] rounded-xl" />
          <Skeleton className="h-[60vh] rounded-xl" />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <SignInPrompt
          next={`/tours/${tourId}/edit`}
          title="Sign in to edit this tour"
          description="Only the tour's owner can edit it."
        />
      </div>
    );
  }

  if (tour.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <ErrorState error={tour.error} onRetry={() => void tour.refetch()} />
      </div>
    );
  }

  if (!tour.data) return null;

  if (!tour.data.is_owner) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Lock}
          title="This tour is read-only for you"
          description={
            <>
              Only the owner{tour.data.owner_login ? ` (@${tour.data.owner_login})` : ""} can edit
              “{tour.data.title}”. You can still take the tour.
            </>
          }
          action={
            <Button asChild>
              <Link href={`/tours/${tourId}`}>
                <Eye aria-hidden /> Open tour player
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <BuilderWorkspace tour={tour.data} />;
}

// ---------------------------------------------------------------------------

type Mode =
  | { kind: "idle" }
  | { kind: "create"; path: string; range: LineRange }
  | { kind: "edit"; stepId: string }
  | { kind: "relocate"; stepId: string };

function ownerCheckpointInput(step: Step): CheckpointInput | null {
  const cp = step.checkpoint;
  if (!cp || !isOwnerCheckpoint(cp)) return null;
  return {
    question: cp.question,
    options: cp.options,
    correct_index: cp.correct_index,
    explanation: cp.explanation,
  };
}

function countLines(content: string): number {
  if (content === "") return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

function BuilderWorkspace({ tour }: { tour: Tour }) {
  const steps = React.useMemo(
    () => [...tour.steps].sort((a, b) => a.position - b.position),
    [tour.steps],
  );

  const [selectedPath, setSelectedPath] = React.useState<string | null>(
    () => steps[0]?.file_path ?? null,
  );
  const [selection, setSelection] = React.useState<LineRange | null>(null);
  const [mode, setMode] = React.useState<Mode>({ kind: "idle" });
  const [deleteTarget, setDeleteTarget] = React.useState<Step | null>(null);
  const [reviewStepId, setReviewStepId] = React.useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [report, setReport] = React.useState<SyncReport | null>(null);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [fileQuery, setFileQuery] = React.useState("");

  const graph = useGraph(tour.analysis_id);
  const file = useFile(tour.analysis_id, selectedPath);
  const meta = useMeta();
  const createStep = useCreateStep(tour.id);
  const updateStep = useUpdateStep(tour.id);
  const deleteStep = useDeleteStep(tour.id);
  const reorder = useReorderSteps(tour.id);
  const sync = useSyncTour(tour.id);

  const nodesByPath = React.useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph.data?.nodes ?? []) map.set(node.path, node);
    return map;
  }, [graph.data]);

  const highlightPaths = React.useMemo(
    () => Array.from(new Set(steps.map((s) => s.file_path))),
    [steps],
  );

  const fileLineCount = React.useMemo(
    () => (file.data ? countLines(file.data.content) : undefined),
    [file.data],
  );

  const editingStep =
    mode.kind === "edit" || mode.kind === "relocate"
      ? steps.find((s) => s.id === mode.stepId)
      : undefined;
  const reviewStep = reviewStepId ? (steps.find((s) => s.id === reviewStepId) ?? null) : null;
  const selectedNode = selectedPath ? nodesByPath.get(selectedPath) : undefined;
  const aiEnabled = meta.data?.ai_enabled ?? false;
  const attentionCount = steps.filter((s) => needsAttention(s.drift_status)).length;

  const codeHighlight: LineRange | null =
    mode.kind === "edit" && editingStep && editingStep.file_path === selectedPath
      ? { start: editingStep.start_line, end: editingStep.end_line }
      : mode.kind === "create" && mode.path === selectedPath
        ? mode.range
        : null;

  // ---- handlers -----------------------------------------------------------

  const selectPath = (path: string) => {
    if (path === selectedPath) return;
    setSelectedPath(path);
    setSelection(null);
    if (mode.kind === "create" || mode.kind === "edit") setMode({ kind: "idle" });
  };

  const handleSelection = React.useCallback((range: ViewerLineRange | null) => {
    setSelection(range);
  }, []);

  const selectStep = (step: Step) => {
    setMode({ kind: "edit", stepId: step.id });
    setSelectedPath(step.file_path);
    setSelection(null);
  };

  const openReview = (stepId: string) => {
    setReviewStepId(stepId);
    setReviewOpen(true);
    setReportOpen(false);
  };

  const handleReorder = (ids: string[]) => {
    reorder.mutate(ids, { onSuccess: () => toast.success("Step order saved") });
  };

  const handleCreate = (values: StepFormValues) => {
    if (mode.kind !== "create") return;
    createStep.mutate(
      {
        title: values.title,
        body_markdown: values.body,
        file_path: mode.path,
        start_line: mode.range.start,
        end_line: mode.range.end,
        checkpoint: values.checkpoint,
        position: values.position,
      },
      {
        onSuccess: (step) => {
          toast.success(`Pinned “${step.title}”`);
          setMode({ kind: "idle" });
          setSelection(null);
        },
      },
    );
  };

  const handleUpdate = (values: StepFormValues) => {
    if (!editingStep) return;
    const hadCheckpoint = editingStep.checkpoint !== null;
    updateStep.mutate(
      {
        stepId: editingStep.id,
        body: {
          title: values.title,
          body_markdown: values.body,
          ...(values.checkpoint
            ? { checkpoint: values.checkpoint }
            : hadCheckpoint
              ? { remove_checkpoint: true }
              : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success("Step saved");
          setMode({ kind: "idle" });
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteStep.mutate(target.id, {
      onSuccess: () => {
        toast.success(`Deleted “${target.title}”`);
        setDeleteTarget(null);
        if ((mode.kind === "edit" || mode.kind === "relocate") && mode.stepId === target.id) {
          setMode({ kind: "idle" });
        }
        if (reviewStepId === target.id) setReviewOpen(false);
      },
    });
  };

  const handleSync = () => {
    sync.mutate(undefined, {
      onSuccess: (result) => {
        setReport(result);
        setReportOpen(true);
        toast.success(result.up_to_date ? "Tour verified — already up to date" : "Tour synced");
      },
    });
  };

  const startRelocate = (step: Step) => {
    setReviewOpen(false);
    setMode({ kind: "relocate", stepId: step.id });
    setSelectedPath(null);
    setSelection(null);
    toast.info("Pick a file in the graph, then select the lines to pin.");
  };

  const relocatePending = createStep.isPending || deleteStep.isPending;
  const relocate = () => {
    if (mode.kind !== "relocate" || !editingStep || !selectedPath || !selection) return;
    const old = editingStep;
    createStep.mutate(
      {
        title: old.title,
        body_markdown: old.body_markdown,
        file_path: selectedPath,
        start_line: selection.start,
        end_line: selection.end,
        checkpoint: ownerCheckpointInput(old),
        position: old.position,
      },
      {
        onSuccess: () => {
          deleteStep.mutate(old.id, {
            onSuccess: () => {
              toast.success(`Re-pinned “${old.title}” to ${selectedPath}`);
              setMode({ kind: "idle" });
              setSelection(null);
            },
          });
        },
      },
    );
  };

  const jumpToFile = (event: React.FormEvent) => {
    event.preventDefault();
    const query = fileQuery.trim();
    if (!query) return;
    const exact = nodesByPath.get(query);
    const match =
      exact ?? graph.data?.nodes.find((n) => n.path.toLowerCase().includes(query.toLowerCase()));
    if (match) {
      selectPath(match.path);
      setFileQuery("");
    } else {
      toast.error(`No file matching “${query}” in this snapshot`);
    }
  };

  // ---- render -------------------------------------------------------------

  const selectionError = selection ? validateLineRange(selection, fileLineCount) : null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        className="pb-4"
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            Tour builder ·
            <Link
              href={`/repos/${tour.repository.owner}/${tour.repository.name}`}
              className="font-mono normal-case hover:text-foreground"
            >
              {tour.repository.owner}/{tour.repository.name}
            </Link>
            <span className="font-mono normal-case">@ {shortSha(tour.base_commit_sha)}</span>
          </span>
        }
        title={tour.title}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{tour.visibility === "PUBLIC" ? "Public" : "Private"}</Badge>
            <span>
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
            {attentionCount > 0 && (
              <Badge variant="warning">{attentionCount} need attention</Badge>
            )}
          </span>
        }
        actions={
          <>
            <HealthBar statuses={steps.map((s) => s.drift_status)} />
            <Button size="sm" onClick={handleSync} disabled={sync.isPending || steps.length === 0}>
              {sync.isPending ? <ButtonSpinner /> : <RefreshCw aria-hidden />}
              Sync &amp; verify
            </Button>
            {report && !reportOpen && (
              <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)}>
                Last report
              </Button>
            )}
            <TourSettingsDialog tour={tour} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tours/${tour.id}`}>
                <Eye aria-hidden /> Preview
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:h-[calc(100vh-12rem)] lg:min-h-[640px] lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ---- Left: steps ---- */}
        <aside aria-label="Steps" className="flex min-h-0 flex-col rounded-xl border bg-card/50">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Steps</h2>
            {reorder.isPending && (
              <span className="text-xs text-muted-foreground" aria-live="polite">Saving order…</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {steps.length === 0 ? (
              <EmptyState
                icon={Pin}
                className="border-0 px-2 py-8"
                title="No steps yet"
                description="Pick a file in the graph, select a few lines of code, then click “Pin lines” to create your first step."
              />
            ) : (
              <StepList
                steps={steps}
                selectedStepId={editingStep?.id ?? null}
                onSelect={selectStep}
                onReorder={handleReorder}
                onDelete={setDeleteTarget}
                onReview={(step) => openReview(step.id)}
                reordering={reorder.isPending}
              />
            )}
          </div>
        </aside>

        {/* ---- Center: graph ---- */}
        <section aria-label="Dependency graph" className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border">
          <form onSubmit={jumpToFile} className="flex items-center gap-2 border-b p-2" role="search">
            <label htmlFor="builder-file-search" className="sr-only">
              Jump to file
            </label>
            <Input
              id="builder-file-search"
              list="builder-file-options"
              value={fileQuery}
              onChange={(e) => setFileQuery(e.target.value)}
              placeholder="Jump to file… (or click a node)"
              className="h-8"
              disabled={!graph.data}
            />
            <datalist id="builder-file-options">
              {graph.data?.nodes.map((node) => <option key={node.path} value={node.path} />)}
            </datalist>
            <Button type="submit" size="sm" variant="outline" disabled={!graph.data}>
              <FolderSearch aria-hidden /> Open
            </Button>
          </form>
          <div className="relative min-h-0 flex-1">
            {graph.isPending ? (
              <Skeleton className="absolute inset-0 rounded-none" />
            ) : graph.isError ? (
              <ErrorState
                className="m-4"
                error={graph.error}
                onRetry={() => void graph.refetch()}
              />
            ) : (
              <GraphCanvas
                graph={graph.data}
                highlightPaths={highlightPaths}
                selectedPath={selectedPath}
                focusPath={selectedPath}
                onSelectPath={(path) => {
                  if (path) selectPath(path);
                }}
                className="h-full w-full"
              />
            )}
          </div>
        </section>

        {/* ---- Right: code + forms ---- */}
        <section aria-label="Code and step editor" className="flex min-h-0 flex-col overflow-hidden rounded-xl border">
          <div className="flex min-h-11 items-center gap-2 border-b px-3 py-2">
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={selectedPath ?? undefined}>
              {selectedPath ?? "No file selected"}
            </span>
            {selectedNode && <RoleBadge role={selectedNode.role} />}
            {fileLineCount !== undefined && (
              <span className="shrink-0 text-xs text-muted-foreground">{fileLineCount} lines</span>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {mode.kind === "relocate" && editingStep && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
                <div className="flex items-start justify-between gap-2">
                  <p>
                    Re-pinning <strong>“{editingStep.title}”</strong> (was{" "}
                    <code className="font-mono text-xs">{editingStep.file_path}</code>). Choose a
                    file and select lines.
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setMode({ kind: "idle" })}
                    aria-label="Cancel re-pin"
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <Button
                  size="sm"
                  onClick={relocate}
                  disabled={!selectedPath || !selection || Boolean(selectionError) || relocatePending}
                >
                  {relocatePending ? <ButtonSpinner /> : <Pin aria-hidden />}
                  {selection
                    ? `Move step to ${formatLineRange(selection.start, selection.end)}`
                    : "Select lines to continue"}
                </Button>
                {selectionError && <p className="text-xs text-destructive">{selectionError}</p>}
              </div>
            )}

            {!selectedPath ? (
              <EmptyState
                icon={MousePointerClick}
                title="Pick a file"
                description="Click a node in the graph (or use “Jump to file”) to open its code, then select lines to pin."
              />
            ) : file.isPending ? (
              <Skeleton className="h-[420px] rounded-lg" />
            ) : file.isError ? (
              <ErrorState error={file.error} onRetry={() => void file.refetch()} compact />
            ) : (
              <CodeViewer
                content={file.data.content}
                language={file.data.language}
                path={file.data.path}
                highlight={codeHighlight}
                selectable
                onSelectionChange={handleSelection}
                height={mode.kind === "idle" ? 520 : 360}
                className="overflow-hidden rounded-lg border"
              />
            )}

            {mode.kind === "idle" && selectedPath && file.data && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
                {selection ? (
                  <>
                    <div className="text-sm">
                      <span className="font-medium">Selected {formatLineRange(selection.start, selection.end)}</span>
                      {selectionError && (
                        <p className="text-xs text-destructive" role="alert">{selectionError}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setMode({ kind: "create", path: selectedPath, range: selection })}
                      disabled={Boolean(selectionError)}
                    >
                      <Pin aria-hidden /> Pin lines {formatLineRange(selection.start, selection.end)}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select lines in the code above to pin a new step
                    {steps.length > 0 ? ", or pick a step on the left to edit it." : "."}
                  </p>
                )}
              </div>
            )}

            {mode.kind === "create" && (
              <StepForm
                key="create"
                mode="create"
                analysisId={tour.analysis_id}
                filePath={mode.path}
                range={mode.range}
                maxLine={mode.path === selectedPath ? fileLineCount : undefined}
                steps={steps}
                aiEnabled={aiEnabled}
                pending={createStep.isPending}
                error={createStep.error}
                rangeAction={
                  selection && mode.path === selectedPath && !sameRange(selection, mode.range) ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs"
                      onClick={() => setMode({ ...mode, range: selection })}
                    >
                      Use current selection {formatLineRange(selection.start, selection.end)}
                    </Button>
                  ) : null
                }
                onSubmit={handleCreate}
                onCancel={() => {
                  createStep.reset();
                  setMode({ kind: "idle" });
                }}
              />
            )}

            {mode.kind === "edit" && editingStep && (
              <StepForm
                key={`edit-${editingStep.id}`}
                mode="edit"
                analysisId={tour.analysis_id}
                filePath={editingStep.file_path}
                range={{ start: editingStep.start_line, end: editingStep.end_line }}
                initial={{
                  title: editingStep.title,
                  body: editingStep.body_markdown,
                  checkpoint: editingStep.checkpoint,
                }}
                steps={steps}
                aiEnabled={aiEnabled}
                pending={updateStep.isPending}
                error={updateStep.error}
                rangeAction={
                  needsAttention(editingStep.drift_status) ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs"
                      onClick={() => openReview(editingStep.id)}
                    >
                      This step has drifted — review it
                    </Button>
                  ) : null
                }
                onSubmit={handleUpdate}
                onCancel={() => {
                  updateStep.reset();
                  setMode({ kind: "idle" });
                }}
              />
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Delete “${deleteTarget.title}”?` : "Delete step?"}
        description="The step, its checkpoint and trainee progress for it will be removed."
        confirmLabel="Delete step"
        destructive
        pending={deleteStep.isPending}
        onConfirm={handleDelete}
      />

      <SyncReportDialog
        report={report}
        open={reportOpen}
        onOpenChange={setReportOpen}
        onReview={openReview}
      />

      <DriftReviewSheet
        tourId={tour.id}
        analysisId={tour.analysis_id}
        step={reviewStep}
        language={
          reviewStep
            ? (nodesByPath.get(reviewStep.file_path)?.language ?? languageFromPath(reviewStep.file_path))
            : "typescript"
        }
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onRelocate={startRelocate}
        onDelete={(step) => {
          setReviewOpen(false);
          setDeleteTarget(step);
        }}
      />
    </div>
  );
}
