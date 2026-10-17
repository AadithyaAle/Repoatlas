"""Resolve raw import specifiers to repo file paths.

JS/TS: relative (`./`, `../`), tsconfig/jsconfig `compilerOptions.baseUrl` + `paths` aliases
(incl. `@/*`), extension probing (.ts .tsx .js .jsx .mjs .cjs .d.ts) and `index.*` files,
and `.js` -> `.ts` rewriting used by ESM TypeScript projects.
Python: relative (`.x`, `..x`) and absolute imports resolved against detected source roots
(repo root, `src/`, and any directory that is a top-level package), `pkg/__init__.py` and
`pkg/mod.py`.
Bare package specifiers (react, numpy) are external and return None.
"""

from dataclasses import dataclass, field

from app.engine.types import ImportRef, Language


@dataclass(slots=True)
class ResolverConfig:
    # alias pattern -> list of target patterns, already made repo-relative, e.g. {"@/*": ["src/*"]}
    ts_paths: dict[str, list[str]] = field(default_factory=dict)
    ts_base_url: str | None = None  # repo-relative directory
    python_roots: list[str] = field(default_factory=list)  # repo-relative dirs ("" = repo root)


def build_resolver_config(all_paths: set[str], config_files: dict[str, str]) -> ResolverConfig:
    """`config_files` maps repo-relative path -> raw content for tsconfig*.json / jsconfig.json
    (JSON with comments and trailing commas must be tolerated)."""
    raise NotImplementedError


def is_external(specifier: str, language: Language, config: ResolverConfig) -> bool:
    raise NotImplementedError


def resolve_import(
    from_path: str,
    ref: ImportRef,
    language: Language,
    all_paths: set[str],
    config: ResolverConfig,
) -> str | None:
    raise NotImplementedError
