"""Pure, framework-free data types shared by the analysis engine.

Nothing in `app.engine` may import FastAPI, SQLAlchemy or httpx: the engine is a deterministic
library operating on in-memory data so it can be unit-tested exhaustively.
"""

from dataclasses import dataclass, field
from enum import IntEnum, StrEnum


class Language(StrEnum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"


class ImportKind(StrEnum):
    STATIC = "static"  # import x from './a' / from a import b / import a
    REEXPORT = "reexport"  # export * from './a' / export { x } from './a'
    DYNAMIC = "dynamic"  # import('./a')
    REQUIRE = "require"  # require('./a')
    TYPE_ONLY = "type_only"  # import type { X } from './a'


class FileRole(StrEnum):
    ENTRY_POINT = "ENTRY_POINT"  # in == 0, out > 0
    CORE_UTILITY = "CORE_UTILITY"  # in >= 5, out <= 2
    GOD_MODULE = "GOD_MODULE"  # in >= 5, out >= 5
    LEAF = "LEAF"  # in > 0, out == 0 (and not CORE_UTILITY)
    ISOLATED = "ISOLATED"  # in == 0, out == 0
    STANDARD = "STANDARD"  # everything else


class DriftStatus(StrEnum):
    UNVERIFIED = "UNVERIFIED"
    HEALTHY = "HEALTHY"
    DRIFTED_AUTO_FIXED = "DRIFTED_AUTO_FIXED"
    OUTDATED_NEEDS_REVIEW = "OUTDATED_NEEDS_REVIEW"
    BROKEN_FILE_DELETED = "BROKEN_FILE_DELETED"


class VisitState(IntEnum):
    UNVISITED = 0
    VISITING = 1
    VISITED = 2


@dataclass(frozen=True, slots=True)
class ImportRef:
    specifier: str  # raw module string, e.g. "./utils", "@/lib/x", "app.core.config", ".models"
    kind: ImportKind
    line: int  # 1-based
    names: tuple[str, ...] = ()  # imported symbol names ("default", "*", "foo")


@dataclass(slots=True)
class ParsedFile:
    path: str  # repo-relative POSIX path
    language: Language
    loc: int  # number of lines
    imports: list[ImportRef] = field(default_factory=list)
    exports: list[str] = field(default_factory=list)
    functions: list[str] = field(default_factory=list)  # top-level only
    classes: list[str] = field(default_factory=list)  # top-level only
    parse_warning: str | None = None  # set when the parser recovered from syntax errors


@dataclass(frozen=True, slots=True)
class Edge:
    source: str  # importer path
    target: str  # imported path
    kind: ImportKind
    line: int


@dataclass(slots=True)
class DependencyGraph:
    nodes: list[str]  # sorted file paths
    edges: list[Edge]
    adjacency: dict[str, list[str]]  # source -> sorted unique targets
    reverse_adjacency: dict[str, list[str]]  # target -> sorted unique sources


@dataclass(frozen=True, slots=True)
class BlastRadiusResult:
    target: str
    direct_dependents: list[str]  # depth == 1
    transitive_dependents: list[str]  # depth >= 2
    depth_by_path: dict[str, int]  # every impacted path -> BFS depth (target excluded)
    max_depth: int
    impact_percentage: float  # (direct + transitive) / (total_files - 1) * 100, 0..100
    risk_score: float  # depth-weighted, 0..100 (see graph_algorithms.risk_score)


@dataclass(frozen=True, slots=True)
class CycleReport:
    cycles: list[list[str]]  # each cycle as a path list [a, b, c] meaning a->b->c->a, canonical
    circular_edges: set[tuple[str, str]]  # (source, target) edges that lie on any cycle
    circular_nodes: set[str]
    scc_id_by_node: dict[str, int]  # only nodes in non-trivial SCCs (size>1 or self-loop)


@dataclass(frozen=True, slots=True)
class NodeMetrics:
    path: str
    in_degree: int
    out_degree: int
    role: FileRole
    is_circular: bool
    scc_id: int | None
    pagerank: float


@dataclass(slots=True)
class AnalysisResult:
    """Output of `pipeline.analyze_sources` — everything the worker persists."""

    files: dict[str, ParsedFile]
    graph: DependencyGraph
    cycles: CycleReport
    metrics: dict[str, NodeMetrics]
    unresolved_imports: int  # relative/alias imports that pointed to no file in the snapshot
    external_imports: int  # bare package imports (react, numpy...) — intentionally not edges


@dataclass(frozen=True, slots=True)
class StepAnchor:
    """What a tour step pinned when it was created."""

    file_path: str
    start_line: int  # 1-based inclusive
    end_line: int  # 1-based inclusive
    snippet_hash: str  # sha256 hex of normalized snippet
    snippet_snapshot: str  # raw lines as pinned (joined with "\n")


@dataclass(frozen=True, slots=True)
class DriftResult:
    status: DriftStatus
    start_line: int | None  # new location when HEALTHY / DRIFTED_AUTO_FIXED / best guess
    end_line: int | None
    similarity: float  # 1.0 exact, 0.0 when file deleted
    current_snippet: str | None  # code currently at the (new or best-guess) location
    unified_diff: str | None  # snapshot -> current, only for OUTDATED_NEEDS_REVIEW
