"use client";

import { FileCode2, Info, MousePointerClick, Network, SearchX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { FileInspector, type InspectorTab } from "@/components/graph/file-inspector";
import { GraphCanvas } from "@/components/graph/graph-canvas";
import { buildGraphIndex, type GraphIndex } from "@/components/graph/graph-index";
import { GraphLegend } from "@/components/graph/graph-legend";
import { GraphToolbar } from "@/components/graph/graph-toolbar";
import { ROLE_META, RoleBadge } from "@/components/graph/role-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlastRadius, useGraph } from "@/lib/api/hooks";
import type { Graph } from "@/lib/api/types";
import {
  DEFAULT_FILTERS,
  dirName,
  fileName,
  filterGraph,
  hasActiveFilters,
  type GraphFilters,
  type LayoutDirection,
} from "@/lib/graph/layout";
import { cn, formatNumber } from "@/lib/utils";

export type GraphWorkspaceProps = {
  analysisId: string;
  className?: string;
};

const FILE_PARAM = "file";
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
  };
}

const subscribeDesktop = subscribeMedia(DESKTOP_QUERY);

/** `true` on lg+ screens. Assumes desktop during SSR to avoid flashing the mobile sheet. */
function useIsDesktop(): boolean {
  return React.useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/** Shallow URL update: integrates with `useSearchParams` without a server round trip. */
function writeFileParam(path: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (path) params.set(FILE_PARAM, path);
  else params.delete(FILE_PARAM);
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function WorkspaceSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border", className)} aria-busy="true">
      <span className="sr-only">Loading dependency graph…</span>
      <div className="space-y-2 border-b px-3 py-2.5">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="ml-auto h-8 w-20" />
        </div>
        <div className="flex gap-1.5">
          {[90, 110, 100, 80, 60, 70].map((w, i) => (
            <Skeleton key={i} className="h-7" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="flex min-h-[520px] flex-1">
        <div className="bg-grid relative flex-1">
          <Skeleton className="absolute top-[20%] left-[15%] h-[76px] w-[240px] opacity-60" />
          <Skeleton className="absolute top-[45%] left-[40%] h-[76px] w-[240px] opacity-60" />
          <Skeleton className="absolute top-[25%] left-[62%] h-[76px] w-[240px] opacity-60" />
          <Skeleton className="absolute top-[65%] left-[20%] h-[76px] w-[240px] opacity-60" />
        </div>
        <div className="hidden w-[420px] space-y-3 border-l p-4 lg:block">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}

function Overview({
  graph,
  index,
  onNavigate,
}: {
  graph: Graph;
  index: GraphIndex;
  onNavigate: (path: string) => void;
}) {
  const central = index.byPagerank.slice(0, 8);
  const entryPoints = graph.nodes.filter((n) => n.role === "ENTRY_POINT").slice(0, 6);

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <div className="flex items-start gap-3 rounded-lg border border-dashed p-3">
        <MousePointerClick className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Select a file to see its blast radius</p>
          <p className="text-xs text-muted-foreground">
            Click any node (or press <kbd className="rounded border px-1 font-mono">Enter</kbd> on a
            focused one) to see which files break if it changes, read its source and inspect its
            imports. Press <kbd className="rounded border px-1 font-mono">/</kbd> to search,{" "}
            <kbd className="rounded border px-1 font-mono">Esc</kbd> to clear.
          </p>
        </div>
      </div>

      <section className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Most central files (PageRank)
        </h3>
        <ol className="space-y-0.5">
          {central.map((node, i) => (
            <li key={node.path}>
              <button
                type="button"
                onClick={() => onNavigate(node.path)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                title={node.path}
              >
                <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  <span className="font-semibold">{fileName(node.path)}</span>
                  <span className="ml-1.5 text-muted-foreground">{dirName(node.path)}</span>
                </span>
                <RoleBadge role={node.role} withTitle={false} />
              </button>
            </li>
          ))}
        </ol>
      </section>

      {entryPoints.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Entry points
          </h3>
          <ul className="space-y-0.5">
            {entryPoints.map((node) => (
              <li key={node.path}>
                <button
                  type="button"
                  onClick={() => onNavigate(node.path)}
                  className="w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  title={node.path}
                >
                  {node.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Roles</h3>
        <dl className="grid grid-cols-2 gap-1.5 text-xs">
          {(Object.keys(index.roleCounts) as (keyof typeof index.roleCounts)[]).map((role) => (
            <div key={role} className="flex items-center justify-between rounded-md border px-2 py-1">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: ROLE_META[role].color }}
                />
                {ROLE_META[role].label}
              </dt>
              <dd className="font-medium tabular-nums">{formatNumber(index.roleCounts[role])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loaded workspace
// ---------------------------------------------------------------------------

function LoadedWorkspace({
  analysisId,
  graph,
  className,
}: {
  analysisId: string;
  graph: Graph;
  className?: string;
}) {
  const index = React.useMemo(() => buildGraphIndex(graph), [graph]);
  const isDesktop = useIsDesktop();

  // ---- URL-backed selection (?file=) ----
  const searchParams = useSearchParams();
  const fileParam = searchParams.get(FILE_PARAM);
  const selectedPath = fileParam && index.byPath.has(fileParam) ? fileParam : null;
  const selectedNode = selectedPath ? (index.byPath.get(selectedPath) ?? null) : null;

  // Focus the deep-linked file on first load; afterwards only explicit navigation focuses.
  const [focusPath, setFocusPath] = React.useState<string | null>(() => fileParam);

  const [filters, setFilters] = React.useState<GraphFilters>(DEFAULT_FILTERS);
  const [direction, setDirection] = React.useState<LayoutDirection>("LR");
  const [showImpact, setShowImpact] = React.useState(true);
  const [inspectorOpen, setInspectorOpen] = React.useState(true);
  const [tab, setTab] = React.useState<InspectorTab>("impact");

  const selectFromCanvas = React.useCallback((path: string | null) => {
    writeFileParam(path);
    setFocusPath(null);
  }, []);

  /** Centre the canvas on `path`, re-triggering even if it was the last focused file. */
  const focusOn = React.useCallback((path: string) => {
    setFocusPath(null);
    requestAnimationFrame(() => setFocusPath(path));
  }, []);

  const navigateTo = React.useCallback(
    (path: string) => {
      writeFileParam(path);
      focusOn(path);
      setInspectorOpen(true);
    },
    [focusOn],
  );

  const clearSelection = React.useCallback(() => writeFileParam(null), []);
  const clearFilters = React.useCallback(() => setFilters(DEFAULT_FILTERS), []);

  // Escape clears the selection from anywhere in the page (the canvas handles its own Escape and
  // marks the event as handled; inputs, dialogs and the code editor keep their own Escape).
  const hasSelection = selectedPath !== null;
  React.useEffect(() => {
    if (!hasSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=dialog], [role=listbox], .monaco-editor")) return;
      writeFileParam(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasSelection]);

  // ---- Filtering ----
  const filtered = hasActiveFilters(filters);
  const visiblePaths = React.useMemo(
    () => (filtered ? filterGraph(graph, filters) : null),
    [graph, filters, filtered],
  );
  const visibleEdges = React.useMemo(() => {
    if (!visiblePaths) return graph.edges.length;
    let count = 0;
    for (const edge of graph.edges) {
      if (visiblePaths.has(edge.source) && visiblePaths.has(edge.target)) count += 1;
    }
    return count;
  }, [graph, visiblePaths]);
  const visibleFiles = visiblePaths ? visiblePaths.size : graph.nodes.length;
  const hiddenByFilters = selectedPath !== null && visiblePaths !== null && !visiblePaths.has(selectedPath);

  // ---- Blast radius ----
  const blast = useBlastRadius(analysisId, selectedPath);
  const impact =
    showImpact && blast.data && blast.data.target === selectedPath ? blast.data.depth_by_path : null;

  // The sheet renders its own close button (top-right), so it gets no X and extra header padding.
  const renderInspector = (variant: "panel" | "sheet") =>
    selectedNode ? (
      <FileInspector
        analysisId={analysisId}
        node={selectedNode}
        index={index}
        blast={blast}
        showImpact={showImpact}
        onShowImpactChange={setShowImpact}
        tab={tab}
        onTabChange={setTab}
        onNavigate={navigateTo}
        onFocus={() => focusOn(selectedNode.path)}
        onClose={variant === "panel" ? clearSelection : undefined}
        headerClassName={variant === "sheet" ? "pr-12" : undefined}
        hiddenByFilters={hiddenByFilters}
        onClearFilters={clearFilters}
      />
    ) : null;

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={FileCode2}
        className={cn("min-h-[50vh]", className)}
        title="No source files were analyzed"
        description="RepoAtlas parses Python, JavaScript and TypeScript files. This repository has none at this commit, or they were all skipped (vendored, generated or too large)."
      />
    );
  }

  return (
    <div
      className={cn("flex flex-col overflow-hidden rounded-xl border bg-background", className)}
      data-analysis-id={analysisId}
    >
      <GraphToolbar
        graph={graph}
        index={index}
        filters={filters}
        onFiltersChange={setFilters}
        onClearFilters={clearFilters}
        onNavigate={navigateTo}
        direction={direction}
        onDirectionChange={setDirection}
        visibleFiles={visibleFiles}
        visibleEdges={visibleEdges}
        inspectorOpen={inspectorOpen}
        onInspectorOpenChange={setInspectorOpen}
        showInspectorToggle={isDesktop}
      />

      <div className="flex h-[calc(100dvh-14rem)] min-h-[520px]">
        <div className="relative min-w-0 flex-1">
          <GraphCanvas
            graph={graph}
            visiblePaths={visiblePaths}
            selectedPath={selectedPath}
            onSelectPath={selectFromCanvas}
            focusPath={focusPath}
            impact={impact}
            showCycles={filters.cyclesOnly}
            direction={direction}
          />

          <GraphLegend
            showImpact={impact !== null}
            showCycles={filters.cyclesOnly}
            className="absolute top-3 left-3 z-10"
          />

          {graph.edges.length === 0 && (
            <div
              role="status"
              className="absolute top-3 left-1/2 z-10 flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-2 rounded-lg border bg-card/95 px-3 py-2 text-xs shadow-sm"
            >
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div className="space-y-0.5">
                <p className="font-medium">No internal imports found</p>
                <p className="text-muted-foreground">
                  These files don&apos;t import each other — imports either point to external
                  packages or couldn&apos;t be resolved to files in the repo. Every file is isolated,
                  so blast radius will always be empty.
                </p>
              </div>
            </div>
          )}

          {visiblePaths !== null && visiblePaths.size === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 p-4 backdrop-blur-[1px]">
              <EmptyState
                icon={SearchX}
                className="bg-card"
                title="No files match the current filters"
                description="Try removing a role or language filter, or clear the path filter."
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          )}

          {isDesktop && !inspectorOpen && selectedNode && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-3 right-3 z-10 max-w-64 shadow"
              onClick={() => setInspectorOpen(true)}
              aria-label={`Open inspector for ${selectedNode.path}`}
            >
              <Network aria-hidden />
              <span className="truncate font-mono text-xs">{fileName(selectedNode.path)}</span>
            </Button>
          )}
        </div>

        {isDesktop && inspectorOpen && (
          <aside
            aria-label={selectedNode ? `Inspector for ${selectedNode.path}` : "Graph overview"}
            className="w-[420px] shrink-0 border-l bg-card/40"
          >
            {renderInspector("panel") ?? <Overview graph={graph} index={index} onNavigate={navigateTo} />}
          </aside>
        )}
      </div>

      {!isDesktop && (
        <Sheet
          open={selectedNode !== null}
          onOpenChange={(open) => {
            if (!open) clearSelection();
          }}
        >
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
            <SheetTitle className="sr-only">{selectedNode ? selectedNode.path : "File"}</SheetTitle>
            <SheetDescription className="sr-only">
              Blast radius, source code and dependency details for the selected file.
            </SheetDescription>
            {renderInspector("sheet")}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function WorkspaceData({ analysisId, className }: GraphWorkspaceProps) {
  const graph = useGraph(analysisId);

  if (graph.isPending) return <WorkspaceSkeleton className={className} />;
  if (graph.isError) {
    return (
      <ErrorState
        error={graph.error}
        title="Couldn't load the dependency graph"
        onRetry={() => void graph.refetch()}
        className={cn("min-h-[50vh]", className)}
      />
    );
  }
  return <LoadedWorkspace analysisId={analysisId} graph={graph.data} className={className} />;
}

/**
 * Interactive dependency-graph workspace: filter toolbar, React Flow canvas (dagre layout),
 * blast-radius overlay and a file inspector (impact / code / details). The selected file is
 * stored in `?file=` so links are shareable.
 */
export function GraphWorkspace({ analysisId, className }: GraphWorkspaceProps) {
  return (
    <React.Suspense fallback={<WorkspaceSkeleton className={className} />}>
      <WorkspaceData analysisId={analysisId} className={className} />
    </React.Suspense>
  );
}
