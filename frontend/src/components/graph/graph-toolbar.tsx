"use client";

import {
  ArrowDownUp,
  ArrowRightLeft,
  FlaskConical,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  X,
} from "lucide-react";
import * as React from "react";

import { CyclesDialog } from "@/components/graph/cycles-dialog";
import { ExportReportButton } from "@/components/graph/export-report-button";
import { FileSearch } from "@/components/graph/file-search";
import type { GraphIndex } from "@/components/graph/graph-index";
import { LANGUAGE_META } from "@/components/graph/graph-style";
import { ROLE_META, ROLE_ORDER } from "@/components/graph/role-badge";
import { Button } from "@/components/ui/button";
import type { FileRole, Graph, Language } from "@/lib/api/types";
import { hasActiveFilters, type GraphFilters, type LayoutDirection } from "@/lib/graph/layout";
import { cn, formatNumber } from "@/lib/utils";

export function ToggleChip({
  pressed,
  onPressedChange,
  children,
  className,
  title,
  ...props
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
} & Omit<React.ComponentProps<"button">, "onClick" | "children" | "className" | "title">) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        pressed
          ? "border-primary/50 bg-primary/15 text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export type GraphToolbarProps = {
  graph: Graph;
  index: GraphIndex;
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  onClearFilters: () => void;
  onNavigate: (path: string) => void;
  direction: LayoutDirection;
  onDirectionChange: (direction: LayoutDirection) => void;
  visibleFiles: number;
  visibleEdges: number;
  inspectorOpen: boolean;
  onInspectorOpenChange: (open: boolean) => void;
  /** Desktop only — the inspector is a sheet on small screens. */
  showInspectorToggle: boolean;
};

export function GraphToolbar({
  graph,
  index,
  filters,
  onFiltersChange,
  onClearFilters,
  onNavigate,
  direction,
  onDirectionChange,
  visibleFiles,
  visibleEdges,
  inspectorOpen,
  onInspectorOpenChange,
  showInspectorToggle,
}: GraphToolbarProps) {
  const update = (patch: Partial<GraphFilters>) => onFiltersChange({ ...filters, ...patch });
  const languages = (Object.keys(LANGUAGE_META) as Language[]).filter(
    (l) => (index.languageCounts[l] ?? 0) > 0,
  );
  const roles = ROLE_ORDER.filter((r: FileRole) => index.roleCounts[r] > 0);
  const filtered = hasActiveFilters(filters);
  const totalFiles = graph.nodes.length;
  const totalEdges = graph.edges.length;

  return (
    <div className="space-y-2 border-b px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch
          nodes={graph.nodes}
          onPick={onNavigate}
          onApplyFilter={(query) => update({ query })}
          className="w-full sm:w-72"
        />
        {filters.query && (
          <span className="inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-md border border-primary/40 bg-primary/10 pr-1 pl-2 text-xs">
            <span className="truncate">
              Path contains <span className="font-mono">&ldquo;{filters.query}&rdquo;</span>
            </span>
            <button
              type="button"
              onClick={() => update({ query: "" })}
              aria-label={`Remove path filter "${filters.query}"`}
              className="rounded p-0.5 hover:bg-accent"
            >
              <X className="size-3" />
            </button>
          </span>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleChip
            pressed={filters.cyclesOnly}
            onPressedChange={(cyclesOnly) => update({ cyclesOnly })}
            title="Show only files and imports that are part of a circular dependency"
            disabled={index.circularCount === 0}
            className={cn(filters.cyclesOnly && "border-red-500/50 bg-red-500/15")}
          >
            <RefreshCcw aria-hidden />
            Cycles
            <span className="tabular-nums">{formatNumber(index.circularCount)}</span>
            <span className="sr-only">circular files</span>
          </ToggleChip>
          <ToggleChip
            pressed={filters.hideTests}
            onPressedChange={(hideTests) => update({ hideTests })}
            title="Hide test files and fixtures"
          >
            <FlaskConical aria-hidden />
            Hide tests
          </ToggleChip>
          <ToggleChip
            pressed={filters.hideIsolated}
            onPressedChange={(hideIsolated) => update({ hideIsolated })}
            title="Hide files with no project imports in either direction"
            disabled={index.roleCounts.ISOLATED === 0}
          >
            Hide isolated
            <span className="tabular-nums">{formatNumber(index.roleCounts.ISOLATED)}</span>
          </ToggleChip>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <ExportReportButton graph={graph} />
          <CyclesDialog
            cycles={graph.cycles}
            circularFileCount={index.circularCount}
            onNavigate={onNavigate}
            isolated={filters.cyclesOnly}
            onIsolateChange={(cyclesOnly) => update({ cyclesOnly })}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDirectionChange(direction === "LR" ? "TB" : "LR")}
            aria-label={`Switch layout to ${direction === "LR" ? "top-to-bottom" : "left-to-right"}`}
            title="Toggle layout direction"
          >
            {direction === "LR" ? <ArrowRightLeft aria-hidden /> : <ArrowDownUp aria-hidden />}
            <span className="font-mono text-xs">{direction}</span>
          </Button>
          {showInspectorToggle && (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => onInspectorOpenChange(!inspectorOpen)}
              aria-label={inspectorOpen ? "Collapse inspector panel" : "Expand inspector panel"}
              aria-pressed={inspectorOpen}
              title={inspectorOpen ? "Collapse inspector" : "Expand inspector"}
            >
              {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Roles
        </span>
        {roles.map((role) => (
          <ToggleChip
            key={role}
            pressed={filters.roles.has(role)}
            onPressedChange={() => update({ roles: toggleInSet(filters.roles, role) })}
            title={`${ROLE_META[role].label}: ${ROLE_META[role].rule}`}
          >
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: ROLE_META[role].color }} />
            {ROLE_META[role].label}
            <span className="text-muted-foreground tabular-nums">{formatNumber(index.roleCounts[role])}</span>
          </ToggleChip>
        ))}
        {languages.length > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            {languages.map((language) => (
              <ToggleChip
                key={language}
                pressed={filters.languages.has(language)}
                onPressedChange={() => update({ languages: toggleInSet(filters.languages, language) })}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: LANGUAGE_META[language].color }}
                />
                {LANGUAGE_META[language].label}
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(index.languageCounts[language] ?? 0)}
                </span>
              </ToggleChip>
            ))}
          </>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearFilters}>
            <X aria-hidden /> Clear filters
          </Button>
        )}

        <dl
          className="ml-auto flex items-center gap-3 text-xs text-muted-foreground"
          aria-label="Graph statistics"
          aria-live="polite"
        >
          <div className="flex gap-1">
            <dt>Files</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {filtered ? `${formatNumber(visibleFiles)} / ${formatNumber(totalFiles)}` : formatNumber(totalFiles)}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Imports</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {filtered ? `${formatNumber(visibleEdges)} / ${formatNumber(totalEdges)}` : formatNumber(totalEdges)}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Cycles</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {formatNumber(graph.cycles.length)}
              {graph.cycles.length >= 100 ? "+" : ""}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
