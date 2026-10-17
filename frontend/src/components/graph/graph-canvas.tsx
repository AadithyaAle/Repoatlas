"use client";

import "@xyflow/react/dist/style.css";
import "./graph-canvas.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { useTheme } from "next-themes";
import * as React from "react";

import { FileNode, fileNodeAriaLabel, type FileFlowNode } from "@/components/graph/file-node";
import { CYCLE_COLOR, depthColor } from "@/components/graph/graph-style";
import { ROLE_META } from "@/components/graph/role-badge";
import type { Graph, GraphNode, ImportKind } from "@/lib/api/types";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  folderColor,
  layoutGraph,
  topLevelFolder,
  type LayoutDirection,
  type XYPosition,
} from "@/lib/graph/layout";
import { cn } from "@/lib/utils";

export type GraphCanvasProps = {
  graph: Graph;
  /** `null`/`undefined` = all nodes. */
  visiblePaths?: Set<string> | null;
  selectedPath?: string | null;
  /** Click on a node → its path; click on the empty pane → `null`. */
  onSelectPath?: (path: string | null) => void;
  /** Smoothly centre the viewport on this node (instant with prefers-reduced-motion). */
  focusPath?: string | null;
  /** path → BFS depth. When set, non-impacted nodes are dimmed and impacted ones coloured. */
  impact?: Record<string, number> | null;
  /** Extra emphasis ring (tour steps). */
  highlightPaths?: string[];
  /** Colour circular edges/nodes red. */
  showCycles?: boolean;
  direction?: LayoutDirection;
  className?: string;
};

type MergedEdge = {
  id: string;
  source: string;
  target: string;
  /** Every import between the pair is dynamic / type-only. */
  dashed: boolean;
  circular: boolean;
  kinds: ImportKind[];
};

type BaseLayout = {
  nodes: GraphNode[];
  edges: MergedEdge[];
  positions: Record<string, XYPosition>;
  folderColors: Map<string, string>;
};

const NODE_TYPES: NodeTypes = { file: FileNode };
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 } as const;
const FOCUS_DURATION_MS = 600;
const EDGE_COLOR = "var(--muted-foreground)";
const SELECTED_EDGE_COLOR = "var(--primary)";
const LOOSE_KINDS: ReadonlySet<ImportKind> = new Set<ImportKind>(["dynamic", "type_only"]);

function computeBaseLayout(
  graph: Graph,
  visiblePaths: Set<string> | null | undefined,
  direction: LayoutDirection,
): BaseLayout {
  const nodes = visiblePaths ? graph.nodes.filter((n) => visiblePaths.has(n.path)) : graph.nodes;
  const present = new Set(nodes.map((n) => n.path));

  const merged = new Map<string, MergedEdge>();
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    const id = `${edge.source}->${edge.target}`;
    const existing = merged.get(id);
    if (existing) {
      existing.dashed = existing.dashed && LOOSE_KINDS.has(edge.kind);
      existing.circular = existing.circular || edge.is_circular;
      if (!existing.kinds.includes(edge.kind)) existing.kinds.push(edge.kind);
    } else {
      merged.set(id, {
        id,
        source: edge.source,
        target: edge.target,
        dashed: LOOSE_KINDS.has(edge.kind),
        circular: edge.is_circular,
        kinds: [edge.kind],
      });
    }
  }
  const edges = Array.from(merged.values());

  const folderColors = new Map<string, string>();
  const byFolder = new Map<string, string>();
  for (const node of nodes) {
    const folder = topLevelFolder(node.path);
    let color = byFolder.get(folder);
    if (color === undefined) {
      color = folderColor(folder);
      byFolder.set(folder, color);
    }
    folderColors.set(node.path, color);
  }

  const { positions } = layoutGraph(nodes, edges, { direction });
  return { nodes, edges, positions, folderColors };
}

const subscribeNoop = () => () => {};

/** `false` during SSR / hydration, `true` afterwards (avoids theme class mismatches). */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function GraphCanvasInner({
  graph,
  visiblePaths = null,
  selectedPath = null,
  onSelectPath,
  focusPath = null,
  impact = null,
  highlightPaths,
  showCycles = false,
  direction = "LR",
  className,
}: GraphCanvasProps) {
  const rf = useReactFlow<FileFlowNode, Edge>();
  const { resolvedTheme } = useTheme();
  const hydrated = useHydrated();
  const colorMode = hydrated && resolvedTheme === "light" ? "light" : "dark";
  const [ready, setReady] = React.useState(false);

  // Layout only depends on the graph, the visible subset and the direction.
  const base = React.useMemo(
    () => computeBaseLayout(graph, visiblePaths, direction),
    [graph, visiblePaths, direction],
  );

  // `highlightPaths` is often an inline array — key it by content so memos stay stable.
  const highlightKey = (highlightPaths ?? []).join("\n");
  const highlightSet = React.useMemo(
    () => new Set(highlightKey ? highlightKey.split("\n") : []),
    [highlightKey],
  );

  const nodes = React.useMemo<FileFlowNode[]>(() => {
    const impactActive = impact !== null;
    return base.nodes.map((file): FileFlowNode => {
      const position = base.positions[file.path] ?? { x: 0, y: 0 };
      const impactDepth = impact?.[file.path];
      const depth =
        impactDepth !== undefined ? impactDepth : impactActive && file.path === selectedPath ? 0 : null;
      return {
        id: file.path,
        type: "file",
        position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        connectable: false,
        selectable: false,
        ariaLabel: fileNodeAriaLabel(file, depth),
        zIndex: file.path === selectedPath || depth !== null ? 1 : 0,
        data: {
          file,
          folderColor: base.folderColors.get(file.path) ?? ROLE_META[file.role].color,
          direction,
          isSelected: file.path === selectedPath,
          isDimmed: impactActive && depth === null,
          depth,
          isHighlighted: highlightSet.has(file.path),
          showCycle: showCycles,
        },
      };
    });
  }, [base, direction, impact, selectedPath, highlightSet, showCycles]);

  const edges = React.useMemo<Edge[]>(() => {
    const impactActive = impact !== null;
    const depthOf = (path: string): number | null => {
      const d = impact?.[path];
      if (d !== undefined) return d;
      return impactActive && path === selectedPath ? 0 : null;
    };
    return base.edges.map((edge): Edge => {
      const sourceDepth = depthOf(edge.source);
      const targetDepth = depthOf(edge.target);
      const onImpactPath =
        sourceDepth !== null && targetDepth !== null && sourceDepth === targetDepth + 1;
      const cycle = showCycles && edge.circular;
      const incident =
        !impactActive &&
        selectedPath !== null &&
        (edge.source === selectedPath || edge.target === selectedPath);

      let color = EDGE_COLOR;
      if (onImpactPath && sourceDepth !== null) color = depthColor(sourceDepth);
      else if (cycle) color = CYCLE_COLOR;
      else if (incident) color = SELECTED_EDGE_COLOR;

      const emphasized = onImpactPath || cycle || incident;
      const dimmed = (impactActive && !onImpactPath) || (showCycles && !impactActive && !edge.circular);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: onImpactPath,
        focusable: false,
        selectable: false,
        zIndex: emphasized ? 1 : 0,
        ariaLabel: `${edge.source} imports ${edge.target}${edge.circular ? " (circular)" : ""}`,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: {
          stroke: color,
          strokeWidth: emphasized ? 2 : 1.2,
          strokeDasharray: edge.dashed && !onImpactPath ? "5 4" : undefined,
          opacity: dimmed ? 0.07 : emphasized ? 1 : 0.45,
        },
      };
    });
  }, [base, impact, selectedPath, showCycles]);

  // Centre on `focusPath` whenever it (or the layout) changes.
  React.useEffect(() => {
    if (!ready || !focusPath) return;
    const position = base.positions[focusPath];
    if (!position) return;
    void rf.setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, {
      zoom: Math.max(rf.getZoom(), 0.9),
      duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS,
    });
  }, [ready, focusPath, base, rf]);

  // Re-fit when the layout changes after the initial render (filters / direction), unless the
  // focus effect above is about to centre on a node instead.
  const focusRef = React.useRef(focusPath);
  const fittedBaseRef = React.useRef<BaseLayout | null>(null);
  React.useEffect(() => {
    focusRef.current = focusPath;
  }, [focusPath]);
  React.useEffect(() => {
    if (!ready) return;
    if (fittedBaseRef.current === null) {
      fittedBaseRef.current = base; // initial fit is handled by the `fitView` prop
      return;
    }
    if (fittedBaseRef.current === base) return;
    fittedBaseRef.current = base;
    const focus = focusRef.current;
    if (focus && base.positions[focus]) return;
    void rf.fitView({ ...FIT_VIEW_OPTIONS, duration: prefersReducedMotion() ? 0 : FOCUS_DURATION_MS });
  }, [ready, base, rf]);

  const handleInit = React.useCallback(() => setReady(true), []);

  const handleNodeClick = React.useCallback<NodeMouseHandler<FileFlowNode>>(
    (_event, node) => onSelectPath?.(node.id),
    [onSelectPath],
  );

  const handlePaneClick = React.useCallback(() => onSelectPath?.(null), [onSelectPath]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && selectedPath) {
        event.preventDefault();
        onSelectPath?.(null);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        const target = event.target as HTMLElement;
        if (target.classList.contains("react-flow__node")) {
          const id = target.getAttribute("data-id");
          if (id) {
            event.preventDefault();
            onSelectPath?.(id);
          }
        }
      }
    },
    [onSelectPath, selectedPath],
  );

  const minimapNodeColor = React.useCallback(
    (node: FileFlowNode) => {
      const { depth, file, showCycle } = node.data;
      if (depth !== null) return depthColor(depth);
      if (showCycle && file.is_circular) return CYCLE_COLOR;
      if (impact !== null) return "var(--muted)";
      return ROLE_META[file.role].color;
    },
    [impact],
  );

  return (
    <div className={cn("relative h-full min-h-[320px] w-full", className)} onKeyDown={handleKeyDown}>
      <ReactFlow<FileFlowNode, Edge>
        className="atlas-graph"
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        colorMode={colorMode}
        aria-label="Dependency graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" aria-label="Graph zoom controls" />
        <MiniMap<FileFlowNode>
          pannable
          zoomable
          position="bottom-right"
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={0}
          nodeBorderRadius={6}
          ariaLabel="Graph minimap"
          className="hidden sm:block"
        />
      </ReactFlow>
    </div>
  );
}

/**
 * Reusable, read-only dependency-graph canvas (React Flow + dagre). Wraps its own
 * `ReactFlowProvider`, so it can be dropped anywhere that has a sized container.
 */
export function GraphCanvas(props: GraphCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
