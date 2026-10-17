/**
 * Pure graph helpers for the dependency-graph workspace: dagre layout, folder colouring and
 * client-side filtering. No React / DOM here so everything is unit-testable.
 */
import { Graph as DagreGraph, layout as dagreLayout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";

import type { FileRole, Graph, GraphNode, Language } from "@/lib/api/types";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type LayoutDirection = "LR" | "TB";

/** Rendered size of a file node (kept in sync with `file-node.tsx`). */
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 76;

/** Graphs above this size use the cheaper `longest-path` ranker (network-simplex is O(n²)-ish). */
const LARGE_GRAPH_THRESHOLD = 800;

const SPACING: Record<LayoutDirection, { nodesep: number; ranksep: number }> = {
  LR: { nodesep: 28, ranksep: 110 },
  TB: { nodesep: 40, ranksep: 90 },
};

/** Gap between disconnected (grid-placed) nodes and the main graph. */
const GRID_GAP_X = 24;
const GRID_GAP_Y = 24;
const GRID_OFFSET = 120;

export type XYPosition = { x: number; y: number };

export type LayoutResult = {
  /** Top-left corner of each node (React Flow coordinates). */
  positions: Record<string, XYPosition>;
  width: number;
  height: number;
};

export type LayoutOptions = { direction: LayoutDirection };

type LayoutNode = Pick<GraphNode, "path">;
type LayoutEdge = { source: string; target: string };

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic layered layout. Nodes are inserted in path order and edges in (source, target)
 * order so identical input always yields identical positions. Nodes without any edge to another
 * laid-out node are packed into a grid below the layered graph instead of forming one huge rank.
 * Edges that reference unknown nodes and self-loops are ignored.
 */
export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): LayoutResult {
  const paths = Array.from(new Set(nodes.map((n) => n.path))).sort(compareStrings);
  const known = new Set(paths);

  const edgeKeys = new Set<string>();
  const uniqueEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    const key = `${edge.source}\u0000${edge.target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    uniqueEdges.push({ source: edge.source, target: edge.target });
  }
  uniqueEdges.sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target));

  const connected = new Set<string>();
  for (const edge of uniqueEdges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  const positions: Record<string, XYPosition> = {};
  let width = 0;
  let height = 0;

  const connectedPaths = paths.filter((p) => connected.has(p));
  if (connectedPaths.length > 0) {
    const g = new DagreGraph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: false, compound: false });
    const spacing = SPACING[options.direction];
    g.setGraph({
      rankdir: options.direction,
      nodesep: spacing.nodesep,
      ranksep: spacing.ranksep,
      marginx: 0,
      marginy: 0,
      ranker: connectedPaths.length > LARGE_GRAPH_THRESHOLD ? "longest-path" : "network-simplex",
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const path of connectedPaths) {
      g.setNode(path, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const edge of uniqueEdges) {
      g.setEdge(edge.source, edge.target, {});
    }
    dagreLayout(g);

    for (const path of connectedPaths) {
      const label = g.node(path);
      // dagre reports node centres; React Flow positions are top-left corners.
      const x = Math.round((label.x ?? 0) - NODE_WIDTH / 2);
      const y = Math.round((label.y ?? 0) - NODE_HEIGHT / 2);
      positions[path] = { x, y };
      width = Math.max(width, x + NODE_WIDTH);
      height = Math.max(height, y + NODE_HEIGHT);
    }
  }

  const loose = paths.filter((p) => !connected.has(p));
  if (loose.length > 0) {
    const cellW = NODE_WIDTH + GRID_GAP_X;
    const cellH = NODE_HEIGHT + GRID_GAP_Y;
    const columns =
      connectedPaths.length > 0
        ? clamp(Math.floor(width / cellW), 4, 40)
        : clamp(Math.ceil(Math.sqrt(loose.length * 2)), 1, 40);
    const originY = connectedPaths.length > 0 ? height + GRID_OFFSET : 0;
    loose.forEach((path, index) => {
      const x = (index % columns) * cellW;
      const y = originY + Math.floor(index / columns) * cellH;
      positions[path] = { x, y };
      width = Math.max(width, x + NODE_WIDTH);
      height = Math.max(height, y + NODE_HEIGHT);
    });
  }

  return { positions, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Folder grouping / colours
// ---------------------------------------------------------------------------

/** Generic container directories whose child is the meaningful "module" folder. */
const CONTAINER_DIRS = new Set(["src", "lib", "libs", "packages", "apps", "app", "pkg"]);

export const ROOT_FOLDER = "(root)";

/**
 * The folder a file is grouped under: its top-level directory, or `container/child` for generic
 * containers like `src/` or `packages/` (so `src/api/x.ts` → `src/api`). Root files → `(root)`.
 */
export function topLevelFolder(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return ROOT_FOLDER;
  const first = segments[0] ?? ROOT_FOLDER;
  if (CONTAINER_DIRS.has(first) && segments.length > 2) {
    return `${first}/${segments[1] ?? ""}`;
  }
  return first;
}

/** 32-bit FNV-1a — tiny, fast, deterministic across runs/platforms. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable hue (0–359) for a folder name. */
export function folderHue(folder: string): number {
  return hashString(folder) % 360;
}

/** CSS colour for a folder (reads well on both themes). */
export function folderColor(folder: string): string {
  if (folder === ROOT_FOLDER) return "oklch(0.7 0.02 286)";
  return `oklch(0.72 0.15 ${folderHue(folder)})`;
}

export type FolderGroup = {
  folder: string;
  hue: number;
  color: string;
  paths: string[];
};

/** Group paths by `topLevelFolder`, sorted by folder name; paths inside a group are sorted too. */
export function groupByFolder(paths: Iterable<string>): FolderGroup[] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const folder = topLevelFolder(path);
    const list = groups.get(folder);
    if (list) list.push(path);
    else groups.set(folder, [path]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([folder, list]) => ({
      folder,
      hue: folderHue(folder),
      color: folderColor(folder),
      paths: list.sort(compareStrings),
    }));
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export type GraphFilters = {
  /** Case-insensitive; every whitespace-separated term must appear in the path. */
  query: string;
  /** Empty set = all roles. */
  roles: ReadonlySet<FileRole>;
  /** Empty set = all languages. */
  languages: ReadonlySet<Language>;
  cyclesOnly: boolean;
  hideIsolated: boolean;
  hideTests: boolean;
};

export const DEFAULT_FILTERS: GraphFilters = {
  query: "",
  roles: new Set(),
  languages: new Set(),
  cyclesOnly: false,
  hideIsolated: false,
  hideTests: false,
};

const TEST_DIR_RE = /(^|\/)(tests?|__tests__|__mocks__|spec|specs|e2e|testing)\//i;
const TEST_FILE_RE =
  /(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py|[^/]*\.(test|spec)\.[cm]?[jt]sx?)$/i;

/** Heuristic: is this a test / fixture file? */
export function isTestPath(path: string): boolean {
  return TEST_DIR_RE.test(path) || TEST_FILE_RE.test(path);
}

export function hasActiveFilters(filters: GraphFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.roles.size > 0 ||
    filters.languages.size > 0 ||
    filters.cyclesOnly ||
    filters.hideIsolated ||
    filters.hideTests
  );
}

/** Paths of nodes passing every active filter (in graph order). */
export function filterGraph(graph: Pick<Graph, "nodes">, filters: GraphFilters): Set<string> {
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    if (filters.roles.size > 0 && !filters.roles.has(node.role)) continue;
    if (filters.languages.size > 0 && !filters.languages.has(node.language)) continue;
    if (filters.cyclesOnly && !node.is_circular) continue;
    if (filters.hideIsolated && node.role === "ISOLATED") continue;
    if (filters.hideTests && isTestPath(node.path)) continue;
    if (terms.length > 0) {
      const lower = node.path.toLowerCase();
      if (!terms.every((t) => lower.includes(t))) continue;
    }
    visible.add(node.path);
  }
  return visible;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function fileName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function dirName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}
