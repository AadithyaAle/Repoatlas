"use client";

import { Network } from "lucide-react";

import { cn } from "@/lib/utils";

export type GraphWorkspaceProps = {
  analysisId: string;
  className?: string;
};

/**
 * Interactive dependency-graph workspace (React Flow + dagre, file viewer, blast radius).
 *
 * PLACEHOLDER — implemented by the graph feature. Contract: rendered by `/analyses/[id]` only
 * once the analysis is COMPLETED; fetch data with `useGraph(analysisId)`, `useFile(...)` and
 * `useBlastRadius(...)` from `@/lib/api/hooks`. It should fill its container
 * (the page gives it `min-h-[70vh]`).
 */
export function GraphWorkspace({ analysisId, className }: GraphWorkspaceProps) {
  return (
    <div
      data-analysis-id={analysisId}
      className={cn(
        "bg-grid flex min-h-[70vh] flex-col items-center justify-center gap-3 rounded-xl border text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Network className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="font-semibold">Graph workspace</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          The interactive dependency graph for this analysis will render here.
        </p>
      </div>
    </div>
  );
}
