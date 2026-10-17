"use client";

import { RefreshCcw } from "lucide-react";
import * as React from "react";

import { CYCLE_COLOR } from "@/components/graph/graph-style";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fileName } from "@/lib/graph/layout";
import { cn } from "@/lib/utils";

/** Mirrors backend `MAX_REPORTED_CYCLES`. */
const MAX_REPORTED_CYCLES = 100;

export type CyclesDialogProps = {
  cycles: string[][];
  /** Number of files that sit on any cycle (complete, unlike `cycles`). */
  circularFileCount: number;
  onNavigate: (path: string) => void;
  isolated: boolean;
  onIsolateChange: (isolated: boolean) => void;
  className?: string;
};

/** Toolbar button + dialog listing every reported import cycle as a clickable chain. */
export function CyclesDialog({
  cycles,
  circularFileCount,
  onNavigate,
  isolated,
  onIsolateChange,
  className,
}: CyclesDialogProps) {
  const [open, setOpen] = React.useState(false);
  const truncated = cycles.length >= MAX_REPORTED_CYCLES;

  const go = (path: string) => {
    setOpen(false);
    onNavigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", className)}
          aria-label={`List ${cycles.length} circular dependencies`}
          disabled={cycles.length === 0}
        >
          <RefreshCcw aria-hidden />
          <span className="hidden xl:inline">List cycles</span>
          <span className="tabular-nums">{cycles.length}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Circular dependencies</DialogTitle>
          <DialogDescription>
            {cycles.length} cycle{cycles.length === 1 ? "" : "s"}
            {truncated ? ` (first ${MAX_REPORTED_CYCLES} reported)` : ""} across{" "}
            {circularFileCount} file{circularFileCount === 1 ? "" : "s"}. Each arrow means
            &ldquo;imports&rdquo;. Cycles make modules impossible to load or test in isolation —
            break one edge to untangle the loop.
          </DialogDescription>
        </DialogHeader>
        <ol className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {cycles.map((cycle, i) => {
            const first = cycle[0];
            return (
              <li key={cycle.join("|")} className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">#{i + 1}</span>
                  <span>
                    {cycle.length} file{cycle.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="flex flex-wrap items-center gap-x-1 gap-y-1 font-mono text-xs">
                  {cycle.map((path, j) => (
                    <React.Fragment key={`${path}-${j}`}>
                      <button
                        type="button"
                        onClick={() => go(path)}
                        title={path}
                        className="rounded px-1 py-0.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {fileName(path)}
                      </button>
                      <span aria-hidden style={{ color: CYCLE_COLOR }}>
                        →
                      </span>
                    </React.Fragment>
                  ))}
                  {first !== undefined && (
                    <span className="px-1 text-muted-foreground" title={first}>
                      {fileName(first)}
                    </span>
                  )}
                  <span className="sr-only">(back to the start)</span>
                </p>
              </li>
            );
          })}
        </ol>
        <div className="flex justify-end">
          <Button
            variant={isolated ? "secondary" : "default"}
            size="sm"
            aria-pressed={isolated}
            onClick={() => {
              onIsolateChange(!isolated);
              setOpen(false);
            }}
          >
            {isolated ? "Show the whole graph" : "Isolate cycles on graph"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
