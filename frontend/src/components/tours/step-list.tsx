"use client";

import { ArrowDown, ArrowUp, GripVertical, ListChecks, Trash2, Wrench } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import type { Step } from "@/lib/api/types";
import { needsAttention } from "@/lib/tours/drift";
import { basename, formatLineRange } from "@/lib/tours/lines";
import { moveItem } from "@/lib/tours/navigation";
import { cn } from "@/lib/utils";

import { DriftBadge } from "./drift-badge";

export type StepListProps = {
  steps: readonly Step[];
  selectedStepId: string | null;
  onSelect: (step: Step) => void;
  /** Called with the full new order of step ids. */
  onReorder: (stepIds: string[]) => void;
  onDelete: (step: Step) => void;
  onReview: (step: Step) => void;
  reordering?: boolean;
};

/**
 * Ordered step list with native HTML5 drag & drop plus keyboard reordering
 * (Alt+↑/↓ on a focused step, or the up/down buttons).
 */
export function StepList({
  steps,
  selectedStepId,
  onSelect,
  onReorder,
  onDelete,
  onReview,
  reordering = false,
}: StepListProps) {
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());

  const move = (from: number, to: number, focus = false) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const ids = moveItem(
      steps.map((s) => s.id),
      from,
      to,
    );
    const moved = steps[from];
    onReorder(ids);
    if (moved) {
      setAnnouncement(`Moved “${moved.title}” to position ${to + 1} of ${steps.length}.`);
      if (focus) {
        // Keep focus on the moved item after React re-renders the list.
        requestAnimationFrame(() => itemRefs.current.get(moved.id)?.focus());
      }
    }
  };

  const endDrag = () => {
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p id="step-list-help" className="sr-only">
        Press Enter to edit a step. Use Alt plus Arrow Up or Arrow Down to reorder.
      </p>
      <ol className="space-y-1.5" aria-label="Tour steps" aria-describedby="step-list-help">
        {steps.map((step, index) => {
          const selected = step.id === selectedStepId;
          const isDragging = dragId === step.id;
          const showDropLine = dragId !== null && overIndex === index && !isDragging;
          return (
            <li
              key={step.id}
              draggable={!reordering}
              onDragStart={(e) => {
                setDragId(step.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", step.id);
              }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== index) setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = steps.findIndex((s) => s.id === dragId);
                if (from !== -1) move(from, index);
                endDrag();
              }}
              onDragEnd={endDrag}
              className={cn(
                "group relative rounded-lg border bg-card transition-colors",
                selected ? "border-primary ring-1 ring-primary/40" : "hover:border-foreground/20",
                isDragging && "opacity-50",
                showDropLine && "before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:rounded before:bg-primary",
              )}
            >
              <div className="flex items-start gap-1 p-2">
                <span
                  className="mt-1 cursor-grab text-muted-foreground active:cursor-grabbing"
                  aria-hidden
                  title="Drag to reorder"
                >
                  <GripVertical className="size-4" />
                </span>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) itemRefs.current.set(step.id, el);
                    else itemRefs.current.delete(step.id);
                  }}
                  onClick={() => onSelect(step)}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === "ArrowUp") {
                      e.preventDefault();
                      move(index, index - 1, true);
                    } else if (e.altKey && e.key === "ArrowDown") {
                      e.preventDefault();
                      move(index, index + 1, true);
                    }
                  }}
                  aria-current={selected ? "true" : undefined}
                  className="min-w-0 flex-1 rounded-md px-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
                      {index + 1}
                    </span>
                    <span className="truncate text-sm font-medium">{step.title}</span>
                  </span>
                  <span
                    className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground"
                    title={step.file_path}
                  >
                    {basename(step.file_path)} · {formatLineRange(step.start_line, step.end_line)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <DriftBadge status={step.drift_status} noTooltip />
                    {step.checkpoint && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <ListChecks className="size-3" aria-hidden /> Checkpoint
                      </span>
                    )}
                  </span>
                </button>
                <div className="flex shrink-0 flex-col gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0 || reordering}
                    aria-label={`Move “${step.title}” up`}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => move(index, index + 1)}
                    disabled={index === steps.length - 1 || reordering}
                    aria-label={`Move “${step.title}” down`}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(step)}
                    aria-label={`Delete “${step.title}”`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              {needsAttention(step.drift_status) && (
                <div className="border-t px-2 py-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-full text-xs"
                    onClick={() => onReview(step)}
                  >
                    <Wrench aria-hidden />
                    {step.drift_status === "BROKEN_FILE_DELETED" ? "Fix broken step" : "Review drift"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
