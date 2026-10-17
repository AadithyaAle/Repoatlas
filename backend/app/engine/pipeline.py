"""Pure orchestration: source files in memory -> AnalysisResult."""

from app.engine.types import AnalysisResult


def analyze_sources(sources: dict[str, str], config_files: dict[str, str]) -> AnalysisResult:
    """`sources`: repo-relative path -> content of supported source files.
    `config_files`: tsconfig*/jsconfig content for alias resolution.
    Parse every file, resolve imports into edges (skipping externals, counting unresolved),
    build the graph, detect cycles, compute metrics."""
    raise NotImplementedError
