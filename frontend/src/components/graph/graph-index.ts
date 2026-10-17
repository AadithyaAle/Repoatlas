import type { FileRole, Graph, GraphEdge, GraphNode, Language } from "@/lib/api/types";

/** Lookup tables derived once per graph for the workspace / inspector. */
export type GraphIndex = {
  byPath: Map<string, GraphNode>;
  /** Edges whose source is the key (what the file imports). */
  outgoing: Map<string, GraphEdge[]>;
  /** Edges whose target is the key (who imports the file). */
  incoming: Map<string, GraphEdge[]>;
  /** 1-based PageRank position (1 = most central). */
  pagerankRank: Map<string, number>;
  /** Nodes sorted by PageRank, descending. */
  byPagerank: GraphNode[];
  roleCounts: Record<FileRole, number>;
  languageCounts: Partial<Record<Language, number>>;
  circularCount: number;
};

export function buildGraphIndex(graph: Graph): GraphIndex {
  const byPath = new Map<string, GraphNode>();
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const roleCounts: Record<FileRole, number> = {
    ENTRY_POINT: 0,
    CORE_UTILITY: 0,
    GOD_MODULE: 0,
    LEAF: 0,
    ISOLATED: 0,
    STANDARD: 0,
  };
  const languageCounts: Partial<Record<Language, number>> = {};
  let circularCount = 0;

  for (const node of graph.nodes) {
    byPath.set(node.path, node);
    roleCounts[node.role] += 1;
    languageCounts[node.language] = (languageCounts[node.language] ?? 0) + 1;
    if (node.is_circular) circularCount += 1;
  }

  for (const edge of graph.edges) {
    const out = outgoing.get(edge.source);
    if (out) out.push(edge);
    else outgoing.set(edge.source, [edge]);
    const inc = incoming.get(edge.target);
    if (inc) inc.push(edge);
    else incoming.set(edge.target, [edge]);
  }
  const byLine = (a: GraphEdge, b: GraphEdge) => a.line - b.line;
  for (const list of outgoing.values()) list.sort(byLine);
  for (const list of incoming.values()) list.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

  const byPagerank = [...graph.nodes].sort(
    (a, b) => b.pagerank - a.pagerank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  const pagerankRank = new Map<string, number>();
  byPagerank.forEach((node, i) => pagerankRank.set(node.path, i + 1));

  return { byPath, outgoing, incoming, pagerankRank, byPagerank, roleCounts, languageCounts, circularCount };
}

/** Group a blast radius' `depth_by_path` into ascending depth buckets (paths sorted). */
export function groupByDepth(depthByPath: Record<string, number>): [number, string[]][] {
  const groups = new Map<number, string[]>();
  for (const [path, depth] of Object.entries(depthByPath)) {
    const list = groups.get(depth);
    if (list) list.push(path);
    else groups.set(depth, [path]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([depth, paths]) => [depth, paths.sort()]);
}
