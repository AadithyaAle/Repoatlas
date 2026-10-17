"""Resolve raw import specifiers to repo file paths.

JS/TS: relative (`./`, `../`), tsconfig/jsconfig `compilerOptions.baseUrl` + `paths` aliases
(incl. `@/*`), extension probing (.ts .tsx .js .jsx .mjs .cjs .d.ts) and `index.*` files,
and `.js` -> `.ts` rewriting used by ESM TypeScript projects.
Python: relative (`.x`, `..x`) and absolute imports resolved against detected source roots
(repo root, `src/`, and any directory that is a top-level package), `pkg/__init__.py` and
`pkg/mod.py`.
Bare package specifiers (react, numpy) are external and return None.

Monorepos: every directory containing a tsconfig/jsconfig gets its own `TsPathConfig`; an
importing file uses the config of its nearest ancestor directory. `@/` and `~/` without a
matching `paths` entry fall back to `<config dir>/src/` then `<config dir>/`.
"""

import json
import posixpath
from dataclasses import dataclass, field
from typing import Any

from app.engine.types import ImportRef, Language

_PROBE_EXTENSIONS = (".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")
_ESM_REWRITES: dict[str, tuple[str, ...]] = {
    ".js": (".ts", ".tsx"),
    ".jsx": (".tsx",),
    ".mjs": (".mts",),
    ".cjs": (".cts",),
}
_ASSET_EXTENSIONS = frozenset(
    ".css .scss .sass .less .styl .pcss .svg .png .jpg .jpeg .gif .webp .avif .ico .bmp .json"
    " .md .mdx .html .txt .wasm .woff .woff2 .ttf .otf .eot .mp4 .webm .mp3 .wav .yaml .yml"
    " .graphql .gql .vue .svelte .astro .csv .xml".split()
)
_DEFAULT_ALIASES = ("@/", "~/")
_CONFIG_PRIORITY = ("tsconfig.json", "jsconfig.json")


@dataclass(slots=True)
class TsPathConfig:
    directory: str  # repo-relative dir holding the config(s) ("" = repo root)
    base_url: str | None = None  # repo-relative directory
    paths: dict[str, list[str]] = field(default_factory=dict)  # repo-relative targets


@dataclass(slots=True)
class ResolverConfig:
    # alias pattern -> list of target patterns, already made repo-relative, e.g. {"@/*": ["src/*"]}
    ts_paths: dict[str, list[str]] = field(default_factory=dict)
    ts_base_url: str | None = None  # repo-relative directory
    python_roots: list[str] = field(default_factory=list)  # repo-relative dirs ("" = repo root)
    # Per-directory configs (monorepos). `ts_paths`/`ts_base_url` mirror the root config and are
    # used as a fallback when no per-directory config applies.
    ts_configs: dict[str, TsPathConfig] = field(default_factory=dict)
    # First path segment of every module importable from a python root (for `is_external`).
    python_top_level: set[str] = field(default_factory=set)


# --------------------------------------------------------------------------------------------
# Config parsing
# --------------------------------------------------------------------------------------------


def _skip_comment(text: str, i: int) -> int:
    """Index after the comment starting at `i`, or `i` when there is none."""
    if text.startswith("//", i):
        end = text.find("\n", i)
        return len(text) if end == -1 else end
    if text.startswith("/*", i):
        end = text.find("*/", i + 2)
        return len(text) if end == -1 else end + 2
    return i


def strip_jsonc(text: str) -> str:
    """Remove // and /* */ comments and trailing commas, leaving string literals intact."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i : j + 1])
            i = j + 1
        elif (after := _skip_comment(text, i)) != i:
            i = after
        elif ch == ",":
            j = i + 1
            while j < n:
                if text[j] in " \t\r\n":
                    j += 1
                elif (after := _skip_comment(text, j)) != j:
                    j = after
                else:
                    break
            if j < n and text[j] not in "}]":
                out.append(ch)
            i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _load_jsonc(text: str) -> dict[str, Any]:
    try:
        data = json.loads(strip_jsonc(text))
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _norm(path: str) -> str | None:
    """Normalize a repo-relative path; None when it escapes the repository."""
    normalized = posixpath.normpath(path.lstrip("/")) if path else "."
    if normalized == ".":
        return ""
    if normalized == ".." or normalized.startswith("../"):
        return None
    return normalized


def _join(directory: str, relative: str) -> str | None:
    return _norm(posixpath.join(directory, relative))


def _extends_chain(path: str, raw: dict[str, dict[str, Any]]) -> list[str]:
    """Config paths in increasing precedence (furthest ancestor first, `path` last)."""
    order: list[str] = []
    seen: set[str] = set()
    stack: list[tuple[str, bool]] = [(path, False)]
    while stack:
        current, expanded = stack.pop()
        if expanded:
            order.append(current)
            continue
        if current in seen:
            continue
        seen.add(current)
        stack.append((current, True))
        extends = raw[current].get("extends")
        parents = [extends] if isinstance(extends, str) else extends
        resolved: list[str] = []
        for parent in parents if isinstance(parents, list) else []:
            if not isinstance(parent, str) or not parent.startswith("."):
                continue
            target = _join(posixpath.dirname(current), parent)
            if target is None:
                continue
            for candidate in (target, f"{target}.json", f"{target}/tsconfig.json"):
                if candidate in raw:
                    resolved.append(candidate)
                    break
        stack.extend((parent, False) for parent in reversed(resolved))
    return order


def _effective_options(path: str, raw: dict[str, dict[str, Any]]) -> TsPathConfig:
    base_url: str | None = None
    paths: dict[str, Any] = {}
    paths_dir = posixpath.dirname(path)
    for config_path in _extends_chain(path, raw):
        options = raw[config_path].get("compilerOptions")
        if not isinstance(options, dict):
            continue
        config_dir = posixpath.dirname(config_path)
        if isinstance(options.get("baseUrl"), str):
            base_url = _join(config_dir, options["baseUrl"])
        if isinstance(options.get("paths"), dict):
            paths = options["paths"]
            paths_dir = config_dir
    paths_base = base_url if base_url is not None else paths_dir
    repo_paths: dict[str, list[str]] = {}
    for pattern, targets in paths.items():
        if not isinstance(targets, list):
            continue
        resolved = [
            joined
            for target in targets
            if isinstance(target, str) and (joined := _join(paths_base, target)) is not None
        ]
        if resolved:
            repo_paths[pattern] = resolved
    return TsPathConfig(posixpath.dirname(path), base_url, repo_paths)


def _config_rank(path: str) -> tuple[int, str]:
    name = posixpath.basename(path)
    rank = _CONFIG_PRIORITY.index(name) if name in _CONFIG_PRIORITY else len(_CONFIG_PRIORITY)
    return rank, name


def build_resolver_config(all_paths: set[str], config_files: dict[str, str]) -> ResolverConfig:
    """`config_files` maps repo-relative path -> raw content for tsconfig*.json / jsconfig.json
    (JSON with comments and trailing commas must be tolerated)."""
    raw = {path: _load_jsonc(content) for path, content in config_files.items()}
    by_dir: dict[str, list[str]] = {}
    for path in raw:
        by_dir.setdefault(posixpath.dirname(path), []).append(path)

    ts_configs: dict[str, TsPathConfig] = {}
    for directory in sorted(by_dir):
        merged = TsPathConfig(directory)
        for path in sorted(by_dir[directory], key=_config_rank):
            options = _effective_options(path, raw)
            if merged.base_url is None:
                merged.base_url = options.base_url
            for pattern, targets in options.paths.items():
                merged.paths.setdefault(pattern, targets)
        ts_configs[directory] = merged

    root = ts_configs.get("", TsPathConfig(""))
    python_roots, python_top_level = _python_layout(all_paths)
    return ResolverConfig(
        ts_paths=dict(root.paths),
        ts_base_url=root.base_url,
        python_roots=python_roots,
        ts_configs=ts_configs,
        python_top_level=python_top_level,
    )


def _python_layout(all_paths: set[str]) -> tuple[list[str], set[str]]:
    py_files = sorted(p for p in all_paths if p.endswith(".py"))
    roots = {""}
    if any(p.startswith("src/") for p in all_paths):
        roots.add("src")
    for path in py_files:
        if posixpath.basename(path) != "__init__.py":
            continue
        parent = posixpath.dirname(posixpath.dirname(path))
        if posixpath.join(parent, "__init__.py") not in all_paths:
            roots.add(parent)
    ordered = sorted(roots)
    top_level: set[str] = set()
    for root in ordered:
        prefix = f"{root}/" if root else ""
        for path in py_files:
            if path.startswith(prefix):
                head, _, rest = path[len(prefix) :].partition("/")
                top_level.add(head if rest else head.removesuffix(".py"))
    return ordered, top_level


# --------------------------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------------------------


def _is_relative_js(specifier: str) -> bool:
    return specifier.startswith(("./", "../", "/")) or specifier in {".", ".."}


def _all_ts_configs(config: ResolverConfig) -> list[TsPathConfig]:
    configs = list(config.ts_configs.values())
    if "" not in config.ts_configs and (config.ts_paths or config.ts_base_url is not None):
        configs.append(TsPathConfig("", config.ts_base_url, config.ts_paths))
    return configs


def _match_pattern(pattern: str, specifier: str) -> str | None:
    """Return the `*` capture ("" for exact patterns) or None when `pattern` doesn't match."""
    if "*" not in pattern:
        return "" if pattern == specifier else None
    prefix, _, suffix = pattern.partition("*")
    if (
        len(specifier) >= len(prefix) + len(suffix)
        and specifier.startswith(prefix)
        and specifier.endswith(suffix)
    ):
        return specifier[len(prefix) : len(specifier) - len(suffix)]
    return None


def is_asset_import(specifier: str) -> bool:
    """Imports of stylesheets, images, JSON... — never source-file edges, never counted."""
    clean = _strip_query(specifier)
    return posixpath.splitext(clean)[1].lower() in _ASSET_EXTENSIONS


def is_external(specifier: str, language: Language, config: ResolverConfig) -> bool:
    if language is Language.PYTHON:
        if specifier.startswith("."):
            return False
        return specifier.split(".", 1)[0] not in config.python_top_level
    if _is_relative_js(specifier) or specifier.startswith(("#", *_DEFAULT_ALIASES)):
        return False
    if ":" in specifier:  # node:fs, https://...
        return True
    # A catch-all `"*"` pattern doesn't make bare packages internal: TS falls back to node_modules.
    return not any(
        not pattern.startswith("*") and _match_pattern(pattern, specifier) is not None
        for ts_config in _all_ts_configs(config)
        for pattern in ts_config.paths
    )


# --------------------------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------------------------


def _strip_query(specifier: str) -> str:
    for marker in ("?", "#"):
        index = specifier.find(marker, 1)
        if index > 0:
            specifier = specifier[:index]
    return specifier


def _probe_js(candidate: str | None, all_paths: set[str]) -> str | None:
    if candidate is None:
        return None
    options: list[str] = []
    if candidate:
        options.append(candidate)
        stem, ext = posixpath.splitext(candidate)
        options.extend(stem + alt for alt in _ESM_REWRITES.get(ext, ()))
        options.extend(candidate + ext for ext in _PROBE_EXTENSIONS)
    index = f"{candidate}/index" if candidate else "index"
    options.extend(index + ext for ext in _PROBE_EXTENSIONS)
    return next((option for option in options if option in all_paths), None)


def _nearest_ts_config(from_path: str, config: ResolverConfig) -> TsPathConfig | None:
    directory = posixpath.dirname(from_path)
    while True:
        if directory in config.ts_configs:
            return config.ts_configs[directory]
        if not directory:
            break
        directory = posixpath.dirname(directory)
    if config.ts_paths or config.ts_base_url is not None:
        return TsPathConfig("", config.ts_base_url, config.ts_paths)
    return None


def _resolve_js(
    from_path: str, specifier: str, all_paths: set[str], config: ResolverConfig
) -> str | None:
    specifier = _strip_query(specifier)
    if not specifier:
        return None
    if specifier.startswith("/"):
        return _probe_js(_norm(specifier), all_paths)
    if _is_relative_js(specifier):
        return _probe_js(_join(posixpath.dirname(from_path), specifier), all_paths)

    ts_config = _nearest_ts_config(from_path, config)
    if ts_config is not None:
        matches: list[tuple[int, int, str]] = []
        for order, pattern in enumerate(ts_config.paths):
            capture = _match_pattern(pattern, specifier)
            if capture is not None:
                # exact patterns first, then the longest prefix (TypeScript semantics)
                prefix_len = len(pattern) + 1 if "*" not in pattern else pattern.index("*")
                matches.append((-prefix_len, order, pattern))
        for _, _, pattern in sorted(matches):
            capture = _match_pattern(pattern, specifier) or ""
            for target in ts_config.paths[pattern]:
                found = _probe_js(_norm(target.replace("*", capture, 1)), all_paths)
                if found is not None:
                    return found

    if specifier.startswith(_DEFAULT_ALIASES):
        base = ts_config.directory if ts_config is not None else ""
        rest = specifier[2:]
        for root in (posixpath.join(base, "src"), base):
            found = _probe_js(_join(root, rest), all_paths)
            if found is not None:
                return found
        return None

    if ts_config is not None and ts_config.base_url is not None:
        return _probe_js(_join(ts_config.base_url, specifier), all_paths)
    return None


def _python_module(base: str, all_paths: set[str]) -> str | None:
    """`a/b` -> `a/b.py` or `a/b/__init__.py`; `""` (repo root) -> `__init__.py`."""
    base = base.rstrip("/")
    candidates = [f"{base}.py", f"{base}/__init__.py"] if base else ["__init__.py"]
    return next((c for c in candidates if c in all_paths), None)


def _python_from_targets(base: str, names: tuple[str, ...], all_paths: set[str]) -> list[str]:
    """Targets of `from <base> import names`: submodules first, then the package itself."""
    base = base.rstrip("/")
    targets: list[str] = []
    needs_package = not names
    for name in names:
        submodule = None if name == "*" else _python_module(posixpath.join(base, name), all_paths)
        if submodule is None:
            needs_package = True
        elif submodule not in targets:
            targets.append(submodule)
    if needs_package:
        package = _python_module(base, all_paths)
        if package is not None and package not in targets:
            targets.append(package)
    return targets


def _python_search_roots(from_path: str, config: ResolverConfig, all_paths: set[str]) -> list[str]:
    """Importer's non-package ancestor dirs (nearest first, like a script's own directory on
    sys.path), then the remaining detected roots."""
    roots: list[str] = []
    directory = posixpath.dirname(from_path)
    while True:
        if posixpath.join(directory, "__init__.py") not in all_paths:
            roots.append(directory)
        if not directory:
            break
        directory = posixpath.dirname(directory)
    roots.extend(root for root in config.python_roots if root not in roots)
    return roots


def _resolve_python(
    from_path: str, ref: ImportRef, all_paths: set[str], config: ResolverConfig
) -> list[str]:
    specifier = ref.specifier
    level = len(specifier) - len(specifier.lstrip("."))
    module_path = specifier[level:].replace(".", "/")
    if level:
        package = posixpath.dirname(from_path)
        for _ in range(level - 1):
            if not package:
                return []  # beyond the repository root
            package = posixpath.dirname(package)
        return _python_from_targets(posixpath.join(package, module_path), ref.names, all_paths)
    if not module_path:
        return []
    for root in _python_search_roots(from_path, config, all_paths):
        base = posixpath.join(root, module_path)
        if ref.names:
            targets = _python_from_targets(base, ref.names, all_paths)
            if targets:
                return targets
        elif (found := _python_module(base, all_paths)) is not None:
            return [found]
    return []


def resolve_import_targets(
    from_path: str,
    ref: ImportRef,
    language: Language,
    all_paths: set[str],
    config: ResolverConfig,
) -> list[str]:
    """All files an import refers to (`from . import a, b` yields two). Empty when unresolved
    or external."""
    if language is Language.PYTHON:
        return _resolve_python(from_path, ref, all_paths, config)
    found = _resolve_js(from_path, ref.specifier, all_paths, config)
    return [found] if found is not None else []


def resolve_import(
    from_path: str,
    ref: ImportRef,
    language: Language,
    all_paths: set[str],
    config: ResolverConfig,
) -> str | None:
    targets = resolve_import_targets(from_path, ref, language, all_paths, config)
    return targets[0] if targets else None
