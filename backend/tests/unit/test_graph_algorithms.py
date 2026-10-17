import random
from collections import deque

import pytest

from app.engine.graph_algorithms import (
    MAX_REPORTED_CYCLES,
    blast_radius,
    build_graph,
    classify_role,
    compute_metrics,
    detect_cycles,
    pagerank,
    risk_level,
    risk_score,
    top_risky_files,
)
from app.engine.types import DependencyGraph, Edge, FileRole, ImportKind


def edge(source: str, target: str, line: int = 1) -> Edge:
    return Edge(source=source, target=target, kind=ImportKind.STATIC, line=line)


def graph_of(pairs: list[tuple[str, str]], extra_nodes: tuple[str, ...] = ()) -> DependencyGraph:
    nodes = {n for pair in pairs for n in pair} | set(extra_nodes)
    return build_graph(nodes, [edge(s, t) for s, t in pairs])


DIAMOND = [("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")]


def chain(n: int) -> list[tuple[str, str]]:
    return [(f"n{i:05d}", f"n{i + 1:05d}") for i in range(n - 1)]


# --- build_graph -----------------------------------------------------------------------------


def test_build_graph_dedupes_keeping_first_and_drops_unknown() -> None:
    g = build_graph(
        ["b", "a", "c", "a"],
        [edge("a", "b", 1), edge("a", "b", 7), edge("a", "zzz"), edge("x", "a"), edge("c", "c")],
    )
    assert g.nodes == ["a", "b", "c"]
    assert g.edges == [edge("a", "b", 1), edge("c", "c")]
    assert g.adjacency == {"a": ["b"], "b": [], "c": ["c"]}
    assert g.reverse_adjacency == {"a": [], "b": ["a"], "c": ["c"]}


def test_build_graph_sorts_neighbours() -> None:
    g = graph_of([("a", "z"), ("a", "m"), ("a", "b"), ("q", "b"), ("c", "b")])
    assert g.adjacency["a"] == ["b", "m", "z"]
    assert g.reverse_adjacency["b"] == ["a", "c", "q"]


def test_build_graph_empty() -> None:
    g = build_graph([], [])
    assert g.nodes == [] and g.edges == [] and g.adjacency == {} and g.reverse_adjacency == {}


# --- blast_radius / risk --------------------------------------------------------------------


def test_blast_radius_diamond() -> None:
    r = blast_radius(graph_of(DIAMOND), "d")
    assert r.direct_dependents == ["b", "c"]
    assert r.transitive_dependents == ["a"]
    assert r.depth_by_path == {"a": 2, "b": 1, "c": 1}
    assert r.max_depth == 2
    assert r.impact_percentage == 100.0
    assert r.risk_score == round((1 + 1 + 0.5) / 3 * 100, 2) == 83.33


def test_blast_radius_leaf_importer_has_no_dependents() -> None:
    r = blast_radius(graph_of(DIAMOND), "a")
    assert r.direct_dependents == [] and r.transitive_dependents == []
    assert r.depth_by_path == {} and r.max_depth == 0
    assert r.impact_percentage == 0.0 and r.risk_score == 0.0


def test_blast_radius_disconnected_components() -> None:
    g = graph_of([("a", "b"), ("x", "y"), ("w", "x")], extra_nodes=("lonely",))
    r = blast_radius(g, "y")
    assert r.direct_dependents == ["x"] and r.transitive_dependents == ["w"]
    assert r.impact_percentage == round(2 / 5 * 100, 2)
    assert r.risk_score == round(1.5 / 5 * 100, 2)


def test_blast_radius_self_loop_never_counts_target() -> None:
    g = graph_of([("a", "a"), ("b", "a")])
    r = blast_radius(g, "a")
    assert "a" not in r.depth_by_path
    assert r.direct_dependents == ["b"]
    assert r.impact_percentage == 100.0


def test_blast_radius_cycle_terminates_and_excludes_target() -> None:
    g = graph_of([("a", "b"), ("b", "c"), ("c", "a")])
    r = blast_radius(g, "a")
    assert r.depth_by_path == {"c": 1, "b": 2}


def test_blast_radius_shortest_depth_wins() -> None:
    g = graph_of([("a", "t"), ("a", "b"), ("b", "c"), ("c", "t")])
    assert blast_radius(g, "t").depth_by_path == {"a": 1, "b": 2, "c": 1}


def test_blast_radius_long_chain_depths() -> None:
    g = graph_of(chain(10_000))
    r = blast_radius(g, "n09999")
    assert r.max_depth == 9999
    assert r.depth_by_path["n00000"] == 9999
    assert r.impact_percentage == 100.0


def test_blast_radius_unknown_target_raises() -> None:
    with pytest.raises(KeyError):
        blast_radius(graph_of(DIAMOND), "nope")


def test_blast_radius_single_node() -> None:
    r = blast_radius(build_graph(["solo"], []), "solo")
    assert r.impact_percentage == 0.0 and r.risk_score == 0.0


@pytest.mark.parametrize(
    ("depths", "total", "expected"),
    [
        ({}, 10, 0.0),
        ({"a": 1}, 1, 0.0),
        ({"a": 1}, 0, 0.0),
        ({"a": 1, "b": 1}, 3, 100.0),
        ({"a": 1, "b": 2, "c": 4}, 11, round(1.75 / 10 * 100, 2)),
        ({"a": 3}, 4, 11.11),
    ],
)
def test_risk_score(depths: dict[str, int], total: int, expected: float) -> None:
    assert risk_score(depths, total) == expected


@pytest.mark.parametrize(
    ("score", "level"),
    [
        (0.0, "LOW"),
        (4.99, "LOW"),
        (5.0, "MEDIUM"),
        (14.99, "MEDIUM"),
        (15.0, "HIGH"),
        (34.99, "HIGH"),
        (35.0, "CRITICAL"),
        (100.0, "CRITICAL"),
    ],
)
def test_risk_level(score: float, level: str) -> None:
    assert risk_level(score) == level


def test_top_risky_files_order_and_k() -> None:
    g = graph_of(DIAMOND)
    top = top_risky_files(g, k=3)
    assert [r.target for r in top] == ["d", "b", "c"]  # b/c tie on risk -> path asc
    assert top[0].risk_score == 83.33
    assert [r.target for r in top_risky_files(g)] == ["d", "b", "c", "a"]
    assert top_risky_files(g, k=0) == []


# --- detect_cycles --------------------------------------------------------------------------


def is_valid_cycle(g: DependencyGraph, cycle: list[str]) -> bool:
    return all(cycle[(i + 1) % len(cycle)] in g.adjacency[n] for i, n in enumerate(cycle))


def test_detect_cycles_acyclic() -> None:
    report = detect_cycles(graph_of(DIAMOND))
    assert report.cycles == []
    assert report.circular_nodes == set() and report.circular_edges == set()
    assert report.scc_id_by_node == {}


def test_detect_cycles_empty_graph() -> None:
    report = detect_cycles(build_graph([], []))
    assert report.cycles == [] and report.scc_id_by_node == {}


def test_detect_cycles_simple_cycle_canonical() -> None:
    g = graph_of([("c", "a"), ("a", "b"), ("b", "c"), ("c", "d")])
    report = detect_cycles(g)
    assert report.cycles == [["a", "b", "c"]]
    assert report.circular_nodes == {"a", "b", "c"}
    assert report.circular_edges == {("a", "b"), ("b", "c"), ("c", "a")}
    assert report.scc_id_by_node == {"a": 0, "b": 0, "c": 0}


def test_detect_cycles_canonical_rotation_preserves_direction() -> None:
    report = detect_cycles(graph_of([("z", "m"), ("m", "b"), ("b", "z")]))
    assert report.cycles == [["b", "z", "m"]]


def test_detect_cycles_self_loop() -> None:
    g = graph_of([("a", "a"), ("a", "b")])
    report = detect_cycles(g)
    assert report.cycles == [["a"]]
    assert report.circular_nodes == {"a"}
    assert report.circular_edges == {("a", "a")}
    assert report.scc_id_by_node == {"a": 0}


def test_detect_cycles_overlapping_cycles() -> None:
    g = graph_of([("a", "b"), ("b", "a"), ("b", "c"), ("c", "b"), ("c", "a"), ("c", "x")])
    report = detect_cycles(g)
    assert report.cycles == [["a", "b"], ["a", "b", "c"], ["b", "c"]]
    assert all(is_valid_cycle(g, c) for c in report.cycles)
    assert report.circular_nodes == {"a", "b", "c"}
    assert ("c", "x") not in report.circular_edges
    assert len(report.circular_edges) == 5


def test_detect_cycles_multiple_sccs_have_deterministic_ids() -> None:
    g = graph_of([("q", "r"), ("r", "q"), ("b", "c"), ("c", "b"), ("r", "b"), ("m", "m")])
    report = detect_cycles(g)
    assert report.scc_id_by_node == {"b": 0, "c": 0, "m": 1, "q": 2, "r": 2}
    assert ("r", "b") not in report.circular_edges  # bridges two SCCs, not on a cycle
    assert report.cycles == [["b", "c"], ["m"], ["q", "r"]]


def test_detect_cycles_deterministic_under_input_order() -> None:
    pairs = [("a", "b"), ("b", "c"), ("c", "a"), ("c", "d"), ("d", "b"), ("e", "e")]
    expected = detect_cycles(graph_of(pairs))
    rng = random.Random(7)
    for _ in range(10):
        shuffled = pairs[:]
        rng.shuffle(shuffled)
        assert detect_cycles(graph_of(shuffled)) == expected


def test_detect_cycles_long_chain_no_recursion_error() -> None:
    pairs = chain(10_000)
    assert detect_cycles(graph_of(pairs)).cycles == []
    closed = detect_cycles(graph_of([*pairs, ("n09999", "n00000")]))
    assert len(closed.cycles) == 1 and len(closed.cycles[0]) == 10_000
    assert closed.cycles[0][0] == "n00000"
    assert len(closed.circular_nodes) == 10_000
    assert len(closed.circular_edges) == 10_000
    assert set(closed.scc_id_by_node.values()) == {0}


def test_detect_cycles_caps_reported_cycles() -> None:
    pairs = [(f"h{i:03d}", f"t{i:03d}") for i in range(150)]
    pairs += [(f"t{i:03d}", f"h{i:03d}") for i in range(150)]
    report = detect_cycles(graph_of(pairs))
    assert len(report.cycles) == MAX_REPORTED_CYCLES
    assert report.cycles == sorted(report.cycles)
    assert len(report.circular_nodes) == 300  # SCC data stays complete
    assert len(set(report.scc_id_by_node.values())) == 150


def reachable(g: DependencyGraph, start: str) -> set[str]:
    seen: set[str] = set()
    queue = deque(g.adjacency[start])
    while queue:
        node = queue.popleft()
        if node not in seen:
            seen.add(node)
            queue.extend(g.adjacency[node])
    return seen


@pytest.mark.parametrize("seed", range(60))
def test_tarjan_matches_brute_force(seed: int) -> None:
    rng = random.Random(seed)
    nodes = [f"f{i}" for i in range(rng.randint(1, 9))]
    pairs = [(s, t) for s in nodes for t in nodes if rng.random() < 0.22]
    g = build_graph(nodes, [edge(s, t) for s, t in pairs])
    report = detect_cycles(g)
    reach = {n: reachable(g, n) for n in nodes}

    def same_scc(u: str, v: str) -> bool:
        return v in reach[u] and u in reach[v]

    expected_nodes = {u for u in nodes if any(same_scc(u, v) for v in nodes)}
    assert report.circular_nodes == expected_nodes
    assert set(report.scc_id_by_node) == expected_nodes
    for u in expected_nodes:
        for v in expected_nodes:
            same_id = report.scc_id_by_node[u] == report.scc_id_by_node[v]
            assert same_id == (u == v or same_scc(u, v))
    assert report.circular_edges == {(s, t) for s, t in pairs if same_scc(s, t)}
    ids = sorted(set(report.scc_id_by_node.values()))
    assert ids == list(range(len(ids)))
    for cycle in report.cycles:
        assert is_valid_cycle(g, cycle)
        assert len(set(cycle)) == len(cycle)
        assert cycle[0] == min(cycle)
        assert set(cycle) <= expected_nodes
    assert report.cycles == sorted(report.cycles)
    # every non-trivial SCC contributes at least one concrete cycle (a back edge exists)
    assert {report.scc_id_by_node[c[0]] for c in report.cycles} == set(ids)


# --- roles / pagerank / metrics -------------------------------------------------------------


@pytest.mark.parametrize(
    ("in_degree", "out_degree", "role"),
    [
        (0, 0, FileRole.ISOLATED),
        (0, 1, FileRole.ENTRY_POINT),
        (0, 12, FileRole.ENTRY_POINT),
        (5, 5, FileRole.GOD_MODULE),
        (9, 7, FileRole.GOD_MODULE),
        (5, 2, FileRole.CORE_UTILITY),
        (5, 0, FileRole.CORE_UTILITY),
        (20, 1, FileRole.CORE_UTILITY),
        (5, 3, FileRole.STANDARD),
        (5, 4, FileRole.STANDARD),
        (1, 0, FileRole.LEAF),
        (4, 0, FileRole.LEAF),
        (2, 2, FileRole.STANDARD),
        (4, 5, FileRole.STANDARD),
    ],
)
def test_classify_role(in_degree: int, out_degree: int, role: FileRole) -> None:
    assert classify_role(in_degree, out_degree) is role


def test_pagerank_empty() -> None:
    assert pagerank(build_graph([], [])) == {}


def test_pagerank_diamond() -> None:
    ranks = pagerank(graph_of(DIAMOND))
    assert sum(ranks.values()) == pytest.approx(1.0, abs=1e-5)
    assert ranks["d"] > ranks["b"] == ranks["c"] > ranks["a"]
    assert all(round(v, 6) == v for v in ranks.values())


def test_pagerank_isolated_nodes_uniform() -> None:
    ranks = pagerank(build_graph(["a", "b", "c", "d"], []))
    assert ranks == dict.fromkeys(["a", "b", "c", "d"], 0.25)


@pytest.mark.parametrize("seed", range(10))
def test_pagerank_sums_to_one_and_is_deterministic(seed: int) -> None:
    rng = random.Random(seed)
    nodes = [f"f{i}" for i in range(30)]
    pairs = [(s, t) for s in nodes for t in nodes if rng.random() < 0.1]
    g = build_graph(nodes, [edge(s, t) for s, t in pairs])
    ranks = pagerank(g)
    assert sum(ranks.values()) == pytest.approx(1.0, abs=1e-4)
    assert ranks == pagerank(build_graph(reversed(nodes), [edge(s, t) for s, t in pairs[::-1]]))


def test_compute_metrics() -> None:
    hub_pairs = [(f"u{i}", "hub") for i in range(6)]
    pairs = [*hub_pairs, ("hub", "x"), ("a", "a"), ("a", "u0"), ("p", "q"), ("q", "p")]
    g = graph_of(pairs, ("iso",))
    metrics = compute_metrics(g, detect_cycles(g))
    assert list(metrics) == g.nodes
    hub = metrics["hub"]
    assert (hub.in_degree, hub.out_degree, hub.role) == (6, 1, FileRole.CORE_UTILITY)
    assert not hub.is_circular and hub.scc_id is None
    a = metrics["a"]  # self-loop counts in neither degree
    assert (a.in_degree, a.out_degree, a.role) == (0, 1, FileRole.ENTRY_POINT)
    assert a.is_circular and a.scc_id == 0
    assert metrics["p"].scc_id == metrics["q"].scc_id == 1
    assert metrics["iso"].role is FileRole.ISOLATED
    assert metrics["x"].role is FileRole.LEAF
    assert sum(m.pagerank for m in metrics.values()) == pytest.approx(1.0, abs=1e-5)
