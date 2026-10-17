"use client";

import {
  ArrowRight,
  CodeXml,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  ListTree,
  Radar,
  TriangleAlert,
  X,
} from "lucide-react";
import * as React from "react";

import { CodeViewer } from "@/components/code/code-viewer";
import { ErrorState } from "@/components/common/error-state";
import { DEPTH_COLORS, LANGUAGE_META, RISK_META, depthColor, depthLabel } from "@/components/graph/graph-style";
import { groupByDepth, type GraphIndex } from "@/components/graph/graph-index";
import { RiskMeter } from "@/components/graph/risk-meter";
import { ROLE_META, RoleBadge } from "@/components/graph/role-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFile, type useBlastRadius } from "@/lib/api/hooks";
import type { GraphEdge, GraphNode } from "@/lib/api/types";
import { dirName, fileName } from "@/lib/graph/layout";
import { cn, formatNumber } from "@/lib/utils";

export type InspectorTab = "impact" | "code" | "details";

type BlastQuery = ReturnType<typeof useBlastRadius>;

export type FileInspectorProps = {
  analysisId: string;
  node: GraphNode;
  index: GraphIndex;
  blast: BlastQuery;
  showImpact: boolean;
  onShowImpactChange: (show: boolean) => void;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  /** Select + focus another file. */
  onNavigate: (path: string) => void;
  /** Centre the graph on the current file. */
  onFocus: () => void;
  onClose?: () => void;
  /** The file is currently hidden by the toolbar filters. */
  hiddenByFilters?: boolean;
  onClearFilters?: () => void;
  className?: string;
  headerClassName?: string;
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function PathButton({
  path,
  onNavigate,
  disabled = false,
  prefix,
  suffix,
}: {
  path: string;
  onNavigate: (path: string) => void;
  disabled?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}) {
  const dir = dirName(path);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onNavigate(path)}
      title={disabled ? `${path} (not in the analyzed graph)` : `Go to ${path}`}
      className="group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    >
      {prefix}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-foreground">{fileName(path)}</span>
        {dir && <span className="ml-1.5 text-muted-foreground">{dir}</span>}
      </span>
      {suffix}
      {!disabled && (
        <ArrowRight
          className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      )}
    </button>
  );
}

const LIST_PREVIEW = 25;

function ExpandableList<T>({
  items,
  render,
  empty,
  getKey,
}: {
  items: readonly T[];
  render: (item: T) => React.ReactNode;
  empty: React.ReactNode;
  getKey: (item: T, index: number) => string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (items.length === 0) return <p className="px-2 py-1 text-xs text-muted-foreground">{empty}</p>;
  const shown = expanded ? items : items.slice(0, LIST_PREVIEW);
  return (
    <div>
      <ul className="space-y-0.5">
        {shown.map((item, i) => (
          <li key={getKey(item, i)}>{render(item)}</li>
        ))}
      </ul>
      {items.length > LIST_PREVIEW && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 text-xs"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "Show fewer" : `Show all ${formatNumber(items.length)}`}
        </Button>
      )}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
      {count !== undefined && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground tabular-nums">
          {formatNumber(count)}
        </span>
      )}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Impact tab
// ---------------------------------------------------------------------------

function ImpactTab({
  node,
  index,
  blast,
  showImpact,
  onShowImpactChange,
  onNavigate,
}: Pick<FileInspectorProps, "node" | "index" | "blast" | "showImpact" | "onShowImpactChange" | "onNavigate">) {
  const groups = React.useMemo(
    () => (blast.data ? groupByDepth(blast.data.depth_by_path) : []),
    [blast.data],
  );

  if (blast.isPending) {
    return (
      <div className="space-y-4 p-4" aria-busy="true">
        <span className="sr-only">Computing blast radius…</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (blast.isError) {
    return (
      <div className="p-4">
        <ErrorState error={blast.error} compact onRetry={() => void blast.refetch()} />
      </div>
    );
  }

  const data = blast.data;
  const impacted = data.direct_dependents.length + data.transitive_dependents.length;
  const others = Math.max(data.total_files - 1, 0);

  return (
    <div className="space-y-5 p-4">
      <RiskMeter score={data.risk_score} level={data.risk_level} />

      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Impacted", value: formatNumber(impacted), hint: `${data.impact_percentage.toFixed(1)}% of ${formatNumber(others)}` },
          { label: "Direct", value: formatNumber(data.direct_dependents.length), hint: "import it" },
          { label: "Max depth", value: formatNumber(data.max_depth), hint: "hops away" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-md border bg-muted/30 px-2 py-2">
            <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{stat.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
            <dd className="text-[10px] text-muted-foreground">{stat.hint}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{RISK_META[data.risk_level].description}</p>
        <Button
          variant={showImpact ? "secondary" : "outline"}
          size="sm"
          aria-pressed={showImpact}
          onClick={() => onShowImpactChange(!showImpact)}
        >
          {showImpact ? <EyeOff /> : <Eye />}
          {showImpact ? "Hide on graph" : "Show on graph"}
        </Button>
      </div>

      <details className="group rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground select-none">
          How is the risk score computed?
        </summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <p>
            RepoAtlas walks the import graph <em>backwards</em> from this file (reverse BFS) to find
            every file that imports it directly (depth 1) or through a chain of imports (depth 2, 3,
            …). Those files may break if this file&apos;s behaviour or exports change.
          </p>
          <p>
            Score = Σ (1 / depth) over impacted files ÷ (total files − 1) × 100. Direct dependents
            weigh 1, depth-2 files ½, depth-3 ⅓ and so on.
          </p>
          <p>Levels: Low &lt; 5 · Medium &lt; 15 · High &lt; 35 · Critical ≥ 35.</p>
        </div>
      </details>

      <section className="space-y-3">
        <SectionTitle count={impacted}>Dependents by depth</SectionTitle>
        {groups.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            Nothing in the repository imports <span className="font-mono">{fileName(node.path)}</span>,
            so changing it can&apos;t break other files through static imports.
          </p>
        ) : (
          groups.map(([depth, paths]) => (
            <div key={depth} className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span
                  className="rounded px-1.5 font-mono text-[10px] font-bold text-zinc-950"
                  style={{ backgroundColor: depthColor(depth) }}
                >
                  d{depth}
                </span>
                {depthLabel(depth)}
                <span className="text-muted-foreground tabular-nums">({paths.length})</span>
              </div>
              <ExpandableList
                items={paths}
                getKey={(p) => p}
                empty={null}
                render={(path) => (
                  <PathButton
                    path={path}
                    onNavigate={onNavigate}
                    disabled={!index.byPath.has(path)}
                    prefix={
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: depth >= 3 ? DEPTH_COLORS[3] : depthColor(depth) }}
                      />
                    }
                  />
                )}
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code tab
// ---------------------------------------------------------------------------

function CodeTab({ analysisId, path }: { analysisId: string; path: string }) {
  const file = useFile(analysisId, path);

  if (file.isPending) {
    return (
      <div className="space-y-2 p-4" aria-busy="true">
        <span className="sr-only">Loading file…</span>
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-[50vh]" />
      </div>
    );
  }
  if (file.isError) {
    return (
      <div className="p-4">
        <ErrorState error={file.error} compact onRetry={() => void file.refetch()} />
      </div>
    );
  }

  const data = file.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: LANGUAGE_META[data.language].color }}
          />
          {LANGUAGE_META[data.language].label} · {formatNumber(data.loc)} lines
        </span>
        <Button variant="ghost" size="sm" className="h-7" asChild>
          <a href={data.html_url} target="_blank" rel="noreferrer">
            Open on GitHub <ExternalLink />
          </a>
        </Button>
      </div>
      <CodeViewer
        content={data.content}
        language={data.language}
        path={data.path}
        className="min-h-[320px] flex-1"
        height="100%"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details tab
// ---------------------------------------------------------------------------

function SymbolList({ label, items }: { label: string; items: readonly string[] }) {
  const [expanded, setExpanded] = React.useState(false);
  if (items.length === 0) return null;
  const limit = 30;
  const shown = expanded ? items : items.slice(0, limit);
  return (
    <div className="space-y-1.5">
      <SectionTitle count={items.length}>{label}</SectionTitle>
      <ul className="flex flex-wrap gap-1">
        {shown.map((item, i) => (
          <li key={`${item}-${i}`} className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
            {item}
          </li>
        ))}
        {items.length > limit && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="rounded px-1.5 py-0.5 text-[11px] text-primary hover:underline"
            >
              {expanded ? "Show fewer" : `+${items.length - limit} more`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function EdgeMeta({ edge }: { edge: GraphEdge }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
      {edge.is_circular && (
        <span className="rounded border border-red-500/40 px-1 text-red-600 dark:text-red-400">cycle</span>
      )}
      {edge.kind !== "static" && <span className="rounded border px-1">{edge.kind.replace("_", "-")}</span>}
      <span className="tabular-nums">L{edge.line}</span>
    </span>
  );
}

function DetailsTab({
  node,
  index,
  onNavigate,
}: Pick<FileInspectorProps, "node" | "index" | "onNavigate">) {
  const meta = ROLE_META[node.role];
  const outgoing = index.outgoing.get(node.path) ?? [];
  const incoming = index.incoming.get(node.path) ?? [];
  const rank = index.pagerankRank.get(node.path);

  const stats: { label: string; value: React.ReactNode }[] = [
    { label: "Imported by (in)", value: formatNumber(node.in_degree) },
    { label: "Imports (out)", value: formatNumber(node.out_degree) },
    {
      label: "PageRank",
      value: (
        <>
          {node.pagerank.toFixed(4)}
          {rank !== undefined && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              #{rank} of {formatNumber(index.byPath.size)}
            </span>
          )}
        </>
      ),
    },
    { label: "Lines of code", value: formatNumber(node.loc) },
    { label: "Language", value: LANGUAGE_META[node.language].label },
    {
      label: "Circular",
      value: node.is_circular ? (
        <span className="text-red-600 dark:text-red-400">
          Yes{node.scc_id !== null ? ` · group ${node.scc_id}` : ""}
        </span>
      ) : (
        "No"
      ),
    },
  ];

  return (
    <div className="space-y-5 p-4">
      {node.parse_warning && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Parse warning</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs break-words">{node.parse_warning}</p>
            <p className="text-xs">Imports from this file may be incomplete.</p>
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-2 rounded-md border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <RoleBadge role={node.role} />
          <span className="font-mono text-[11px] text-muted-foreground">{meta.rule}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
        <p className="text-[11px] text-muted-foreground">
          This file: in-degree <span className="font-mono text-foreground">{node.in_degree}</span>,
          out-degree <span className="font-mono text-foreground">{node.out_degree}</span>. Roles are
          checked in order: Isolated, Entry point, God module, Core utility, Leaf, Standard.
        </p>
      </section>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{s.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <SymbolList label="Exports" items={node.exports} />
      <SymbolList label="Functions" items={node.functions} />
      <SymbolList label="Classes" items={node.classes} />

      <section className="space-y-1.5">
        <SectionTitle count={outgoing.length}>Imports</SectionTitle>
        <ExpandableList
          items={outgoing}
          getKey={(e, i) => `${e.target}-${e.line}-${i}`}
          empty="Imports no other project files."
          render={(edge) => (
            <PathButton
              path={edge.target}
              onNavigate={onNavigate}
              disabled={!index.byPath.has(edge.target)}
              suffix={<EdgeMeta edge={edge} />}
            />
          )}
        />
      </section>

      <section className="space-y-1.5">
        <SectionTitle count={incoming.length}>Imported by</SectionTitle>
        <ExpandableList
          items={incoming}
          getKey={(e, i) => `${e.source}-${e.line}-${i}`}
          empty="No project file imports this one."
          render={(edge) => (
            <PathButton
              path={edge.source}
              onNavigate={onNavigate}
              disabled={!index.byPath.has(edge.source)}
              suffix={<EdgeMeta edge={edge} />}
            />
          )}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

/** Right-hand panel for the selected file: blast radius, source and structural details. */
export function FileInspector({
  analysisId,
  node,
  index,
  blast,
  showImpact,
  onShowImpactChange,
  tab,
  onTabChange,
  onNavigate,
  onFocus,
  onClose,
  hiddenByFilters = false,
  onClearFilters,
  className,
  headerClassName,
}: FileInspectorProps) {
  const dir = dirName(node.path);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className={cn("flex items-start gap-2 border-b px-4 py-3", headerClassName)}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="flex min-w-0 items-center gap-2">
            <FileCode className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-mono text-sm font-semibold" title={node.path}>
              {fileName(node.path)}
            </span>
          </h2>
          {dir && (
            <p className="truncate font-mono text-xs text-muted-foreground" title={node.path}>
              {dir}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <RoleBadge role={node.role} />
            {node.is_circular && (
              <span className="rounded-md border border-red-500/40 px-1.5 py-0.5 text-[11px] leading-none text-red-600 dark:text-red-400">
                Circular
              </span>
            )}
            {node.parse_warning && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-1.5 py-0.5 text-[11px] leading-none text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-3" aria-hidden /> Warning
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={onFocus} aria-label="Center graph on this file" title="Center on graph">
            <Crosshair />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close file inspector" title="Close (Esc)">
              <X />
            </Button>
          )}
        </div>
      </header>

      {hiddenByFilters && (
        <div className="flex items-center justify-between gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
          <span>This file is hidden by the current filters.</span>
          {onClearFilters && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as InspectorTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="mx-4 mt-3 mb-1 w-[calc(100%-2rem)]">
          <TabsTrigger value="impact">
            <Radar aria-hidden /> Impact
          </TabsTrigger>
          <TabsTrigger value="code">
            <CodeXml aria-hidden /> Code
          </TabsTrigger>
          <TabsTrigger value="details">
            <ListTree aria-hidden /> Details
          </TabsTrigger>
        </TabsList>
        <TabsContent value="impact" className="min-h-0 overflow-y-auto">
          <ImpactTab
            node={node}
            index={index}
            blast={blast}
            showImpact={showImpact}
            onShowImpactChange={onShowImpactChange}
            onNavigate={onNavigate}
          />
        </TabsContent>
        <TabsContent value="code" className="flex min-h-0 flex-col">
          <CodeTab analysisId={analysisId} path={node.path} />
        </TabsContent>
        <TabsContent value="details" className="min-h-0 overflow-y-auto">
          <DetailsTab node={node} index={index} onNavigate={onNavigate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
