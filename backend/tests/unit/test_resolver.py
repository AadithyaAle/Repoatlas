import json

import pytest

from app.engine.resolver import (
    ResolverConfig,
    build_resolver_config,
    is_asset_import,
    is_external,
    resolve_import,
    resolve_import_targets,
    strip_jsonc,
)
from app.engine.types import ImportKind, ImportRef, Language

JS = Language.JAVASCRIPT
TS = Language.TYPESCRIPT
PY = Language.PYTHON


def _ref(specifier: str, *names: str) -> ImportRef:
    return ImportRef(specifier, ImportKind.STATIC, 1, names)


def _resolve(
    from_path: str,
    specifier: str,
    paths: set[str],
    config_files: dict[str, str] | None = None,
    language: Language = TS,
) -> str | None:
    config = build_resolver_config(paths, config_files or {})
    return resolve_import(from_path, _ref(specifier), language, paths, config)


def _py_targets(
    from_path: str, specifier: str, names: tuple[str, ...], paths: set[str]
) -> list[str]:
    config = build_resolver_config(paths, {})
    return resolve_import_targets(from_path, _ref(specifier, *names), PY, paths, config)


# --------------------------------------------------------------------------------------------
# JSONC
# --------------------------------------------------------------------------------------------


def test_strip_jsonc_handles_comments_trailing_commas_and_strings() -> None:
    text = """{
  // line comment
  "compilerOptions": {
    /* block
       comment */
    "baseUrl": ".", // trailing
    "paths": {
      "@/*": ["./src/*",],  /* after */
      "url": ["http://example.com/*"],
      "quote": ["a\\"//not-comment,]"],
    },
  },
}"""
    data = json.loads(strip_jsonc(text))
    assert data == {
        "compilerOptions": {
            "baseUrl": ".",
            "paths": {
                "@/*": ["./src/*"],
                "url": ["http://example.com/*"],
                "quote": ['a"//not-comment,]'],
            },
        }
    }


def test_invalid_config_is_ignored() -> None:
    config = build_resolver_config({"src/a.ts"}, {"tsconfig.json": "{ not json"})
    assert config.ts_paths == {}
    assert config.ts_base_url is None


# --------------------------------------------------------------------------------------------
# JS / TS: relative + probing
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("specifier", "paths", "expected"),
    [
        ("./b", {"src/b.ts"}, "src/b.ts"),
        ("./b", {"src/b.tsx"}, "src/b.tsx"),
        ("./b", {"src/b.d.ts"}, "src/b.d.ts"),
        ("./b", {"src/b.js"}, "src/b.js"),
        ("./b", {"src/b.jsx"}, "src/b.jsx"),
        ("./b", {"src/b.mjs"}, "src/b.mjs"),
        ("./b", {"src/b.cjs"}, "src/b.cjs"),
        ("./b", {"src/b.ts", "src/b.js"}, "src/b.ts"),
        ("./b.js", {"src/b.js", "src/b.ts"}, "src/b.js"),
        ("./b.js", {"src/b.ts"}, "src/b.ts"),
        ("./b.js", {"src/b.tsx"}, "src/b.tsx"),
        ("./b.mjs", {"src/b.mts"}, "src/b.mts"),
        ("./b.cjs", {"src/b.cts"}, "src/b.cts"),
        ("./b.jsx", {"src/b.tsx"}, "src/b.tsx"),
        ("./dir", {"src/dir/index.ts"}, "src/dir/index.ts"),
        ("./dir/", {"src/dir/index.js"}, "src/dir/index.js"),
        ("./dir", {"src/dir.ts", "src/dir/index.ts"}, "src/dir.ts"),
        ("../lib/x", {"lib/x.ts"}, "lib/x.ts"),
        ("..", {"index.ts"}, "index.ts"),
        (".", {"src/index.tsx"}, "src/index.tsx"),
        ("./b?raw", {"src/b.ts"}, "src/b.ts"),
        ("./b#hash", {"src/b.ts"}, "src/b.ts"),
        ("./missing", {"src/b.ts"}, None),
        ("../../outside", {"src/b.ts"}, None),
        ("/src/b", {"src/b.ts"}, "src/b.ts"),
    ],
)
def test_relative_resolution(specifier: str, paths: set[str], expected: str | None) -> None:
    all_paths = {"src/a.ts", *paths}
    assert _resolve("src/a.ts", specifier, all_paths) == expected


def test_bare_packages_are_external_and_unresolved() -> None:
    paths = {"src/a.ts", "src/react.ts"}
    config = build_resolver_config(paths, {})
    for specifier in ("react", "@scope/pkg", "node:fs", "lodash/fp", "next/navigation"):
        assert resolve_import("src/a.ts", _ref(specifier), TS, paths, config) is None
        assert is_external(specifier, TS, config)
    for specifier in ("./x", "../x", "@/x", "~/x", "/x", "#internal"):
        assert not is_external(specifier, TS, config)


def test_asset_imports() -> None:
    assert is_asset_import("./styles.css")
    assert is_asset_import("./logo.svg?url")
    assert is_asset_import("@/data/x.json")
    assert not is_asset_import("./foo.service")
    assert not is_asset_import("./b.js")
    assert not is_asset_import("react")


# --------------------------------------------------------------------------------------------
# JS / TS: tsconfig paths
# --------------------------------------------------------------------------------------------

TSCONFIG_WITH_COMMENTS = """{
  // Next.js style config
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"], // app alias
      "@components/*": ["src/components/*", "src/legacy/*",],
      "@ui": ["packages/ui/index.ts"],
      "*": ["types/*"],
    },
  },
}"""


def test_tsconfig_paths_with_comments_and_trailing_commas() -> None:
    paths = {
        "src/app/page.tsx",
        "src/lib/utils.ts",
        "src/legacy/Old.tsx",
        "src/components/Button/index.tsx",
        "packages/ui/index.ts",
        "types/env.d.ts",
        "src/config.ts",
    }
    files = {"tsconfig.json": TSCONFIG_WITH_COMMENTS}
    config = build_resolver_config(paths, files)
    assert config.ts_base_url == ""
    assert config.ts_paths["@/*"] == ["src/*"]
    assert config.ts_paths["@components/*"] == ["src/components/*", "src/legacy/*"]

    def r(spec: str) -> str | None:
        return resolve_import("src/app/page.tsx", _ref(spec), TS, paths, config)

    assert r("@/lib/utils") == "src/lib/utils.ts"
    assert r("@components/Button") == "src/components/Button/index.tsx"
    assert r("@components/Old") == "src/legacy/Old.tsx"  # second target
    assert r("@ui") == "packages/ui/index.ts"  # exact pattern
    assert r("env") == "types/env.d.ts"  # catch-all "*"
    assert r("src/config") == "src/config.ts"  # baseUrl
    assert r("@/missing") is None
    assert r("react") is None
    assert not is_external("@components/x", TS, config)
    assert not is_external("@ui", TS, config)
    assert is_external("react", TS, config)  # "*" catch-all doesn't make packages internal


def test_longest_prefix_pattern_wins() -> None:
    paths = {"a.ts", "generic/special/x.ts", "special/x.ts"}
    tsconfig = json.dumps(
        {"compilerOptions": {"paths": {"@/*": ["generic/*"], "@/special/*": ["special/*"]}}}
    )
    assert _resolve("a.ts", "@/special/x", paths, {"tsconfig.json": tsconfig}) == "special/x.ts"


def test_paths_relative_to_tsconfig_dir_without_base_url() -> None:
    paths = {"apps/web/src/lib/a.ts", "apps/web/src/page.tsx"}
    tsconfig = '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}'
    config = build_resolver_config(paths, {"apps/web/tsconfig.json": tsconfig})
    assert config.ts_configs["apps/web"].paths == {"@/*": ["apps/web/src/*"]}
    found = resolve_import("apps/web/src/page.tsx", _ref("@/lib/a"), TS, paths, config)
    assert found == "apps/web/src/lib/a.ts"


def test_paths_relative_to_base_url() -> None:
    paths = {"web/src/lib/a.ts", "web/src/page.tsx"}
    tsconfig = '{"compilerOptions": {"baseUrl": "./src", "paths": {"#lib/*": ["lib/*"]}}}'
    config = build_resolver_config(paths, {"web/jsconfig.json": tsconfig})
    assert config.ts_configs["web"].base_url == "web/src"
    for specifier in ("#lib/a", "lib/a"):
        found = resolve_import("web/src/page.tsx", _ref(specifier), JS, paths, config)
        assert found == "web/src/lib/a.ts"


def test_extends_inherits_paths_relative_to_parent() -> None:
    paths = {"packages/app/src/main.ts", "shared/util.ts", "packages/app/src/local.ts"}
    files = {
        "tsconfig.base.json": """{
            "compilerOptions": { "baseUrl": ".", "paths": { "@shared/*": ["shared/*"] } }
        }""",
        "packages/app/tsconfig.json": """{
            // inherits paths from the base
            "extends": "../../tsconfig.base",
            "compilerOptions": { "strict": true, },
        }""",
    }
    config = build_resolver_config(paths, files)
    assert config.ts_configs["packages/app"].paths == {"@shared/*": ["shared/*"]}
    main = "packages/app/src/main.ts"
    assert resolve_import(main, _ref("@shared/util"), TS, paths, config) == "shared/util.ts"


def test_extends_child_overrides_parent_and_ignores_packages() -> None:
    paths = {"pkg/src/a.ts", "pkg/lib/a.ts", "pkg/main.ts"}
    files = {
        "pkg/tsconfig.base.json": '{"compilerOptions": {"paths": {"@/*": ["lib/*"]}}}',
        "pkg/tsconfig.json": json.dumps(
            {
                "extends": ["@tsconfig/node20/tsconfig.json", "./tsconfig.base.json"],
                "compilerOptions": {"paths": {"@/*": ["src/*"]}},
            }
        ),
    }
    assert _resolve("pkg/main.ts", "@/a", paths, files) == "pkg/src/a.ts"


def test_extends_cycle_does_not_hang() -> None:
    files = {
        "a/tsconfig.json": '{"extends": "../b/tsconfig.json", "compilerOptions": {}}',
        "b/tsconfig.json": '{"extends": "../a/tsconfig.json"}',
    }
    config = build_resolver_config({"a/x.ts"}, files)
    assert set(config.ts_configs) == {"a", "b"}


def test_monorepo_nearest_tsconfig_wins() -> None:
    paths = {
        "apps/web/src/page.tsx",
        "apps/web/src/lib/db.ts",
        "apps/admin/app/page.tsx",
        "apps/admin/app/lib/db.ts",
        "src/lib/db.ts",
        "src/root.ts",
    }
    files = {
        "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}',
        "apps/web/tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}',
        "apps/admin/tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./app/*"]}}}',
    }
    config = build_resolver_config(paths, files)

    def r(src: str) -> str | None:
        return resolve_import(src, _ref("@/lib/db"), TS, paths, config)

    assert r("apps/web/src/page.tsx") == "apps/web/src/lib/db.ts"
    assert r("apps/admin/app/page.tsx") == "apps/admin/app/lib/db.ts"
    assert r("src/root.ts") == "src/lib/db.ts"


def test_vite_style_tsconfig_with_references_uses_sibling_config() -> None:
    paths = {"src/main.ts", "src/lib/x.ts"}
    files = {
        "tsconfig.json": '{"files": [], "references": [{"path": "./tsconfig.app.json"}]}',
        "tsconfig.app.json": '{"compilerOptions": {"paths": {"$lib/*": ["./src/lib/*"]}}}',
    }
    assert _resolve("src/main.ts", "$lib/x", paths, files) == "src/lib/x.ts"


@pytest.mark.parametrize(
    ("paths", "expected"),
    [
        ({"src/app/page.tsx", "src/lib/utils.ts", "lib/utils.ts"}, "src/lib/utils.ts"),
        ({"app/page.tsx", "lib/utils.ts"}, "lib/utils.ts"),
    ],
)
def test_default_at_alias_without_tsconfig(paths: set[str], expected: str) -> None:
    importer = next(p for p in sorted(paths) if p.endswith("page.tsx"))
    assert _resolve(importer, "@/lib/utils", paths) == expected
    assert _resolve(importer, "~/lib/utils", paths) == expected


def test_default_alias_relative_to_nearest_config_dir() -> None:
    paths = {"apps/web/app/page.tsx", "apps/web/src/lib/x.ts"}
    files = {"apps/web/tsconfig.json": '{"compilerOptions": {"strict": true}}'}
    assert _resolve("apps/web/app/page.tsx", "@/lib/x", paths, files) == "apps/web/src/lib/x.ts"


def test_manually_built_config_is_honoured() -> None:
    paths = {"src/a.ts", "src/lib/b.ts"}
    config = ResolverConfig(ts_paths={"@lib/*": ["src/lib/*"]})
    assert resolve_import("src/a.ts", _ref("@lib/b"), TS, paths, config) == "src/lib/b.ts"
    assert not is_external("@lib/b", TS, config)


# --------------------------------------------------------------------------------------------
# Python
# --------------------------------------------------------------------------------------------

PY_FLAT = {
    "app/__init__.py",
    "app/main.py",
    "app/core/__init__.py",
    "app/core/config.py",
    "app/core/db.py",
    "app/models/__init__.py",
    "app/models/user.py",
    "app/utils.py",
    "scripts/seed.py",
}


def test_python_roots_detection() -> None:
    paths = {
        *PY_FLAT,
        "src/mylib/__init__.py",
        "src/mylib/core.py",
        "backend/api/__init__.py",
        "backend/api/routes.py",
    }
    config = build_resolver_config(paths, {})
    assert config.python_roots == ["", "backend", "src"]
    assert {"app", "scripts", "mylib", "api"} <= config.python_top_level


@pytest.mark.parametrize(
    ("specifier", "names", "expected"),
    [
        ("app.core.config", (), ["app/core/config.py"]),
        ("app.core", (), ["app/core/__init__.py"]),
        ("app", (), ["app/__init__.py"]),
        ("app.core", ("config",), ["app/core/config.py"]),
        ("app.core", ("config", "db"), ["app/core/config.py", "app/core/db.py"]),
        ("app.core", ("settings",), ["app/core/__init__.py"]),
        ("app.core", ("config", "settings"), ["app/core/config.py", "app/core/__init__.py"]),
        ("app.utils", ("helper",), ["app/utils.py"]),
        ("app.models", ("*",), ["app/models/__init__.py"]),
        ("os", (), []),
        ("os.path", ("join",), []),
        ("app.missing", (), []),
    ],
)
def test_python_absolute(specifier: str, names: tuple[str, ...], expected: list[str]) -> None:
    assert _py_targets("app/main.py", specifier, names, PY_FLAT) == expected


@pytest.mark.parametrize(
    ("from_path", "specifier", "names", "expected"),
    [
        ("app/core/db.py", ".", ("config",), ["app/core/config.py"]),
        ("app/core/db.py", ".config", ("Settings",), ["app/core/config.py"]),
        ("app/core/db.py", "..", ("utils",), ["app/utils.py"]),
        ("app/core/db.py", "..models", ("user",), ["app/models/user.py"]),
        ("app/core/db.py", "..models.user", ("User",), ["app/models/user.py"]),
        ("app/core/db.py", "..", ("main", "utils"), ["app/main.py", "app/utils.py"]),
        ("app/core/__init__.py", ".", ("db",), ["app/core/db.py"]),
        ("app/core/__init__.py", ".config", ("x",), ["app/core/config.py"]),
        ("app/models/user.py", "..core.db", ("x",), ["app/core/db.py"]),
        ("app/core/db.py", "...", ("x",), []),
        ("app/core/db.py", "....", ("x",), []),
        ("app/core/db.py", ".nope", ("x",), []),
    ],
)
def test_python_relative(
    from_path: str, specifier: str, names: tuple[str, ...], expected: list[str]
) -> None:
    assert _py_targets(from_path, specifier, names, PY_FLAT) == expected


def test_python_from_import_mixes_submodules_and_package() -> None:
    targets = _py_targets("app/core/db.py", ".", ("config", "missing"), PY_FLAT)
    assert targets == ["app/core/config.py", "app/core/__init__.py"]


def test_resolve_import_returns_first_target() -> None:
    config = build_resolver_config(PY_FLAT, {})
    ref = _ref(".", "db", "config")
    assert resolve_import("app/core/__init__.py", ref, PY, PY_FLAT, config) == "app/core/db.py"
    assert resolve_import("app/core/db.py", _ref(".nope", "x"), PY, PY_FLAT, config) is None


@pytest.mark.parametrize(
    ("from_path", "specifier", "names", "expected"),
    [
        ("tests/test_core.py", "mylib.core", ("run",), "src/mylib/core.py"),
        ("tests/test_core.py", "mylib.sub", ("helpers",), "src/mylib/sub/helpers.py"),
        ("tests/test_core.py", "conftest", (), "tests/conftest.py"),
        ("src/mylib/core.py", "mylib.sub.helpers", (), "src/mylib/sub/helpers.py"),
    ],
)
def test_python_src_layout_and_tests_dir(
    from_path: str, specifier: str, names: tuple[str, ...], expected: str
) -> None:
    paths = {
        "src/mylib/__init__.py",
        "src/mylib/core.py",
        "src/mylib/sub/__init__.py",
        "src/mylib/sub/helpers.py",
        "tests/test_core.py",
        "tests/conftest.py",
    }
    assert _py_targets(from_path, specifier, names, paths) == [expected]


def test_python_nested_project_root() -> None:
    paths = {"backend/app/__init__.py", "backend/app/main.py", "backend/app/db.py"}
    assert _py_targets("backend/app/main.py", "app.db", (), paths) == ["backend/app/db.py"]
    assert _py_targets("backend/app/main.py", "app", ("db",), paths) == ["backend/app/db.py"]


def test_python_monorepo_prefers_nearest_root() -> None:
    paths = {
        "services/a/app/__init__.py",
        "services/a/app/main.py",
        "services/a/app/db.py",
        "services/b/app/__init__.py",
        "services/b/app/main.py",
        "services/b/app/db.py",
    }
    for service in ("a", "b"):
        targets = _py_targets(f"services/{service}/app/main.py", "app.db", (), paths)
        assert targets == [f"services/{service}/app/db.py"]


def test_python_external_detection() -> None:
    config = build_resolver_config(PY_FLAT, {})
    assert is_external("os", PY, config)
    assert is_external("numpy.linalg", PY, config)
    assert not is_external("app.missing", PY, config)
    assert not is_external(".missing", PY, config)
    assert not is_external("..", PY, config)
