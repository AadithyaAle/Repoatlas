"""Deterministic graph algorithms over the file dependency graph.

All functions are pure and iterative (no recursion — real repos exceed Python's stack depth).
Output ordering must be deterministic (sorted) so results are reproducible and cacheable.

Complexity (N nodes, E unique edges):
- build_graph: O(E log E + N log N)
- blast_radius: O(N + E) per target; top_risky_files: O(N * (N + E))
- detect_cycles: O(N + E) for DFS + Tarjan, plus O(C * L) to canonicalize C recorded cycles
- pagerank: O(iterations * (N + E))
"""

from collections import deque
from collections.abc import Iterable, Iterator
from typing import Literal

from app.engine.types import (
    BlastRadiusResult,
    CycleReport,
    DependencyGraph,
    Edge,
    FileRole,
    NodeMetrics,
    VisitState,
)

# Role classification thresholds (see FileRole).
HIGH_IN_DEGREE = 5
HIGH_OUT_DEGREE = 5
LOW_OUT_DEGREE = 2

# The DFS stops recording concrete cycles after this many (found in deterministic DFS order).
# circular_nodes / circular_edges / scc_id_by_node are always complete (computed via Tarjan).
MAX_REPORTED_CYCLES = 100

RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
_RISK_THRESHOLDS: tuple[tuple[float, RiskLevel], ...] = (
    (5.0, "LOW"),
    (15.0, "MEDIUM"),
    (35.0, "HIGH"),
)


def build_graph(nodes: Iterable[str], edges: Iterable[Edge]) -> DependencyGraph:
    """Deduplicate edges (keep first occurrence per (source, target)), drop edges to unknown
    nodes, keep self-loops."""
    node_list = sorted(set(nodes))
    known = set(node_list)
    seen: set[tuple[str, str]] = set()
    kept: list[Edge] = []
    for edge in edges:
        key = (edge.source, edge.target)
        if key in seen or edge.source not in known or edge.target not in known:
            continue
        seen.add(key)
        kept.append(edge)
    adjacency: dict[str, list[str]] = {n: [] for n in node_list}
    reverse: dict[str, list[str]] = {n: [] for n in node_list}
    for source, target in sorted(seen):
        adjacency[source].append(target)
        reverse[target].append(source)
    for sources in reverse.values():
        sources.sort()
    return DependencyGraph(
        nodes=node_list, edges=kept, adjacency=adjacency, reverse_adjacency=reverse
    )


def blast_radius(graph: DependencyGraph, target: str) -> BlastRadiusResult:
    """Reverse BFS from `target` over `reverse_adjacency`. Raises KeyError if unknown."""
    if target not in graph.reverse_adjacency:
        raise KeyError(target)
    depth: dict[str, int] = {}
    visited = {target}
    queue: deque[tuple[str, int]] = deque([(target, 0)])
    while queue:
        node, d = queue.popleft()
        for dependent in graph.reverse_adjacency[node]:
            if dependent not in visited:
                visited.add(dependent)
                depth[dependent] = d + 1
                queue.append((dependent, d + 1))
    total = len(graph.nodes)
    impact = round(len(depth) / (total - 1) * 100, 2) if total > 1 else 0.0
    return BlastRadiusResult(
        target=target,
        direct_dependents=sorted(p for p, d in depth.items() if d == 1),
        transitive_dependents=sorted(p for p, d in depth.items() if d >= 2),
        depth_by_path=dict(sorted(depth.items())),
        max_depth=max(depth.values(), default=0),
        impact_percentage=impact,
        risk_score=risk_score(depth, total),
    )


def risk_score(depth_by_path: dict[str, int], total_files: int) -> float:
    """Depth-weighted impact: sum(1 / depth) over impacted files / (total_files - 1) * 100,
    rounded to 2 decimals, 0 when total_files <= 1."""
    if total_files <= 1:
        return 0.0
    weighted = sum(1 / d for d in depth_by_path.values() if d > 0)
    return round(weighted / (total_files - 1) * 100, 2)


def risk_level(score: float) -> RiskLevel:
    """Bucket a risk score: <5 LOW, <15 MEDIUM, <35 HIGH, otherwise CRITICAL."""
    for bound, level in _RISK_THRESHOLDS:
        if score < bound:
            return level
    return "CRITICAL"


def top_risky_files(graph: DependencyGraph, k: int = 5) -> list[BlastRadiusResult]:
    """The `k` files with the highest blast-radius risk (risk desc, path asc)."""
    results = [blast_radius(graph, node) for node in graph.nodes]
    results.sort(key=lambda r: (-r.risk_score, r.target))
    return results[: max(k, 0)]


def _canonical_cycle(path: list[str]) -> tuple[str, ...]:
    """Rotate so the lexicographically smallest node comes first (direction preserved)."""
    pivot = path.index(min(path))
    return tuple(path[pivot:] + path[:pivot])


def _find_cycles(graph: DependencyGraph) -> list[list[str]]:
    """Iterative 3-color DFS; every back edge u->v yields the cycle path[v:] + [u]."""
    state = dict.fromkeys(graph.nodes, VisitState.UNVISITED)
    found: set[tuple[str, ...]] = set()
    for root in graph.nodes:
        if state[root] is not VisitState.UNVISITED:
            continue
        state[root] = VisitState.VISITING
        path = [root]
        position = {root: 0}
        stack: list[tuple[str, Iterator[str]]] = [(root, iter(graph.adjacency[root]))]
        while stack:
            node, neighbors = stack[-1]
            for nxt in neighbors:
                if state[nxt] is VisitState.UNVISITED:
                    state[nxt] = VisitState.VISITING
                    position[nxt] = len(path)
                    path.append(nxt)
                    stack.append((nxt, iter(graph.adjacency[nxt])))
                    break
                if state[nxt] is VisitState.VISITING and len(found) < MAX_REPORTED_CYCLES:
                    found.add(_canonical_cycle(path[position[nxt] :]))
            else:
                stack.pop()
                path.pop()
                del position[node]
                state[node] = VisitState.VISITED
    return [list(cycle) for cycle in sorted(found)]


def _tarjan_scc(graph: DependencyGraph) -> list[list[str]]:
    """Iterative Tarjan's algorithm. Returns every SCC as a sorted member list."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    scc_stack: list[str] = []
    components: list[list[str]] = []

    def visit(node: str) -> None:
        index[node] = low[node] = len(index)
        scc_stack.append(node)
        on_stack.add(node)

    for root in graph.nodes:
        if root in index:
            continue
        visit(root)
        work: list[tuple[str, Iterator[str]]] = [(root, iter(graph.adjacency[root]))]
        while work:
            node, neighbors = work[-1]
            for nxt in neighbors:
                if nxt not in index:
                    visit(nxt)
                    work.append((nxt, iter(graph.adjacency[nxt])))
                    break
                if nxt in on_stack:
                    low[node] = min(low[node], index[nxt])
            else:
                work.pop()
                if work:
                    parent = work[-1][0]
                    low[parent] = min(low[parent], low[node])
                if low[node] == index[node]:
                    component: list[str] = []
                    while True:
                        member = scc_stack.pop()
                        on_stack.discard(member)
                        component.append(member)
                        if member == node:
                            break
                    components.append(sorted(component))
    return components


def detect_cycles(graph: DependencyGraph) -> CycleReport:
    """Iterative 3-color DFS (UNVISITED/VISITING/VISITED) records back edges and the concrete
    cycle from the explicit stack; Tarjan SCC marks every node/edge that lies on any cycle.

    `cycles` holds at most MAX_REPORTED_CYCLES canonical cycles (smallest node first, sorted).
    SCC ids are 0..k-1 ordered by each component's smallest member path.
    """
    self_loops = {n for n in graph.nodes if n in graph.adjacency[n]}
    nontrivial = sorted(
        (c for c in _tarjan_scc(graph) if len(c) > 1 or c[0] in self_loops),
        key=lambda c: c[0],
    )
    scc_id = {node: i for i, comp in enumerate(nontrivial) for node in comp}
    circular_edges = {
        (source, target)
        for source, targets in graph.adjacency.items()
        if source in scc_id
        for target in targets
        if scc_id.get(target) == scc_id[source]
    }
    return CycleReport(
        cycles=_find_cycles(graph),
        circular_edges=circular_edges,
        circular_nodes=set(scc_id),
        scc_id_by_node=dict(sorted(scc_id.items())),
    )


def classify_role(in_degree: int, out_degree: int) -> FileRole:
    """Precedence: ISOLATED, ENTRY_POINT, GOD_MODULE, CORE_UTILITY, LEAF, STANDARD."""
    if in_degree == 0:
        return FileRole.ISOLATED if out_degree == 0 else FileRole.ENTRY_POINT
    if in_degree >= HIGH_IN_DEGREE and out_degree >= HIGH_OUT_DEGREE:
        return FileRole.GOD_MODULE
    if in_degree >= HIGH_IN_DEGREE and out_degree <= LOW_OUT_DEGREE:
        return FileRole.CORE_UTILITY
    if out_degree == 0:
        return FileRole.LEAF
    return FileRole.STANDARD


def pagerank(
    graph: DependencyGraph, damping: float = 0.85, iterations: int = 50
) -> dict[str, float]:
    """Importance flows from importer to imported file (edge direction). Sums to ~1.

    Dangling nodes (no imports) redistribute their rank uniformly across all nodes.
    """
    n = len(graph.nodes)
    if n == 0:
        return {}
    rank = dict.fromkeys(graph.nodes, 1.0 / n)
    dangling = [node for node in graph.nodes if not graph.adjacency[node]]
    for _ in range(iterations):
        dangling_share = damping * sum(rank[d] for d in dangling) / n
        base = (1.0 - damping) / n + dangling_share
        new_rank = dict.fromkeys(graph.nodes, base)
        for source in graph.nodes:
            targets = graph.adjacency[source]
            if targets:
                share = damping * rank[source] / len(targets)
                for target in targets:
                    new_rank[target] += share
        rank = new_rank
    return {node: round(value, 6) for node, value in rank.items()}


def compute_metrics(graph: DependencyGraph, cycles: CycleReport) -> dict[str, NodeMetrics]:
    """Per-node metrics. Degrees count unique neighbours; self-loops count in neither degree
    (they are surfaced via `is_circular` instead)."""
    ranks = pagerank(graph)
    metrics: dict[str, NodeMetrics] = {}
    for node in graph.nodes:
        in_degree = sum(1 for s in graph.reverse_adjacency[node] if s != node)
        out_degree = sum(1 for t in graph.adjacency[node] if t != node)
        metrics[node] = NodeMetrics(
            path=node,
            in_degree=in_degree,
            out_degree=out_degree,
            role=classify_role(in_degree, out_degree),
            is_circular=node in cycles.circular_nodes,
            scc_id=cycles.scc_id_by_node.get(node),
            pagerank=ranks[node],
        )
    return metrics
