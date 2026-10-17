"""Pure orchestration: source files in memory -> AnalysisResult."""

from app.engine.ast_parser import count_lines, detect_language, parse_file
from app.engine.graph_algorithms import build_graph, compute_metrics, detect_cycles
from app.engine.resolver import (
    build_resolver_config,
    is_asset_import,
    is_external,
    resolve_import_targets,
)
from app.engine.types import AnalysisResult, Edge, Language, ParsedFile


def analyze_sources(sources: dict[str, str], config_files: dict[str, str]) -> AnalysisResult:
    """`sources`: repo-relative path -> content of supported source files.
    `config_files`: tsconfig*/jsconfig content for alias resolution.
    Parse every file, resolve imports into edges (skipping externals, counting unresolved),
    build the graph, detect cycles, compute metrics.

    Files with unsupported extensions are ignored. Asset imports (`./styles.css`, `./logo.svg`)
    are neither edges nor counted. An import that resolves to its own file becomes a self-loop
    edge (left to `build_graph`, which keeps self-loops)."""
    languages = {path: lang for path in sources if (lang := detect_language(path)) is not None}
    all_paths = set(languages)
    config = build_resolver_config(all_paths, config_files)

    files: dict[str, ParsedFile] = {}
    edges: list[Edge] = []
    unresolved = external = 0
    for path in sorted(all_paths):
        source = sources[path]
        try:
            parsed = parse_file(path, source)
        except Exception as exc:  # one pathological file must never abort the analysis
            parsed = ParsedFile(
                path=path,
                language=languages[path],
                loc=count_lines(source),
                parse_warning=f"Parser failure: {type(exc).__name__}",
            )
        files[path] = parsed
        for ref in parsed.imports:
            targets = resolve_import_targets(path, ref, parsed.language, all_paths, config)
            if targets:
                edges.extend(Edge(path, target, ref.kind, ref.line) for target in targets)
            elif parsed.language is not Language.PYTHON and is_asset_import(ref.specifier):
                continue
            elif is_external(ref.specifier, parsed.language, config):
                external += 1
            else:
                unresolved += 1

    graph = build_graph(sorted(files), edges)
    cycles = detect_cycles(graph)
    return AnalysisResult(
        files=files,
        graph=graph,
        cycles=cycles,
        metrics=compute_metrics(graph, cycles),
        unresolved_imports=unresolved,
        external_imports=external,
    )
