import pytest

from app.engine.ast_parser import count_lines, detect_language, parse_file
from app.engine.types import ImportKind, ImportRef, Language, ParsedFile


def _refs(parsed: ParsedFile) -> list[tuple[str, ImportKind, int, tuple[str, ...]]]:
    return [(r.specifier, r.kind, r.line, r.names) for r in parsed.imports]


def _specs(parsed: ParsedFile) -> dict[str, ImportRef]:
    return {r.specifier: r for r in parsed.imports}


# --------------------------------------------------------------------------------------------
# Language detection / line counting
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("a.py", Language.PYTHON),
        ("src/a.js", Language.JAVASCRIPT),
        ("a.jsx", Language.JAVASCRIPT),
        ("a.mjs", Language.JAVASCRIPT),
        ("a.cjs", Language.JAVASCRIPT),
        ("a.ts", Language.TYPESCRIPT),
        ("a.tsx", Language.TYPESCRIPT),
        ("types/global.d.ts", Language.TYPESCRIPT),
        ("a.mts", Language.TYPESCRIPT),
        ("a.cts", Language.TYPESCRIPT),
        ("A.TSX", Language.TYPESCRIPT),
        ("README.md", None),
        ("Makefile", None),
        ("styles.css", None),
    ],
)
def test_detect_language(path: str, expected: Language | None) -> None:
    assert detect_language(path) == expected


@pytest.mark.parametrize(
    ("source", "expected"), [("", 0), ("a", 1), ("a\n", 1), ("a\nb", 2), ("a\nb\n", 2), ("\n", 1)]
)
def test_count_lines(source: str, expected: int) -> None:
    assert count_lines(source) == expected


def test_unsupported_extension_raises() -> None:
    with pytest.raises(ValueError):
        parse_file("notes.txt", "hello")


def test_empty_files() -> None:
    for path in ("empty.py", "empty.ts", "empty.js"):
        parsed = parse_file(path, "")
        assert parsed.loc == 0
        assert parsed.imports == []
        assert parsed.parse_warning is None


# --------------------------------------------------------------------------------------------
# Python
# --------------------------------------------------------------------------------------------


def test_python_import_forms() -> None:
    source = """import os
import a.b, c as d
from x import y, z as w
from . import m
from .. import n
from ..pkg import q
from .sibling import *
"""
    parsed = parse_file("pkg/sub/mod.py", source)
    assert parsed.language is Language.PYTHON
    assert parsed.loc == 7
    assert parsed.parse_warning is None
    assert _refs(parsed) == [
        ("os", ImportKind.STATIC, 1, ()),
        ("a.b", ImportKind.STATIC, 2, ()),
        ("c", ImportKind.STATIC, 2, ()),
        ("x", ImportKind.STATIC, 3, ("y", "z")),
        (".", ImportKind.STATIC, 4, ("m",)),
        ("..", ImportKind.STATIC, 5, ("n",)),
        ("..pkg", ImportKind.STATIC, 6, ("q",)),
        (".sibling", ImportKind.STATIC, 7, ("*",)),
    ]


def test_python_type_checking_and_nested_imports() -> None:
    source = """from typing import TYPE_CHECKING
import typing

if TYPE_CHECKING:
    from app.models import User
else:
    from app.fallback import User

if typing.TYPE_CHECKING:
    import app.schemas

try:
    import ujson as json
except ImportError:
    import json

def load():
    from app.lazy import thing
    return thing

class K:
    def method(self):
        import app.inner
"""
    kinds = {r.specifier: r.kind for r in parse_file("m.py", source).imports}
    assert kinds["app.models"] is ImportKind.TYPE_ONLY
    assert kinds["app.schemas"] is ImportKind.TYPE_ONLY
    assert kinds["app.fallback"] is ImportKind.STATIC
    assert kinds["ujson"] is ImportKind.STATIC
    assert kinds["json"] is ImportKind.STATIC
    assert kinds["app.lazy"] is ImportKind.STATIC
    assert kinds["app.inner"] is ImportKind.STATIC
    assert kinds["typing"] is ImportKind.STATIC


def test_python_definitions_and_public_exports() -> None:
    source = """import os
from x import imported_name

CONSTANT = 1
_private = 2
a, (b, *rest) = 1, (2, 3)
obj.attr = 4
annotated: int = 5

def public(): ...
async def fetch(): ...
def _helper(): ...

class Model:
    def method(self): ...

class _Hidden: ...

if True:
    def not_top_level(): ...
"""
    parsed = parse_file("m.py", source)
    assert parsed.functions == ["public", "fetch", "_helper"]
    assert parsed.classes == ["Model", "_Hidden"]
    assert parsed.exports == [
        "CONSTANT",
        "a",
        "b",
        "rest",
        "annotated",
        "public",
        "fetch",
        "Model",
    ]


def test_python_dunder_all_overrides_exports() -> None:
    source = """__all__ = ["b", "_a"]
__all__ += ("c",)

def b(): ...
def _a(): ...
def c(): ...
def d(): ...
"""
    assert parse_file("m.py", source).exports == ["b", "_a", "c"]


def test_python_non_literal_all_falls_back_to_public_names() -> None:
    source = "from x import names\n__all__ = names + ['z']\ndef z(): ...\n"
    assert parse_file("m.py", source).exports == ["z"]


def test_python_syntax_error_recovers_imports_with_regex() -> None:
    source = """import os, app.core as core
from app.models import (User,
    Group)
from . import sibling  # comment
from ..pkg.mod import thing as alias, other

def broken(:
    pass
"""
    parsed = parse_file("pkg/a.py", source)
    assert parsed.parse_warning is not None
    assert parsed.parse_warning.startswith("SyntaxError line 7:")
    assert parsed.loc == 8
    assert _refs(parsed) == [
        ("os", ImportKind.STATIC, 1, ()),
        ("app.core", ImportKind.STATIC, 1, ()),
        ("app.models", ImportKind.STATIC, 2, ("User",)),
        (".", ImportKind.STATIC, 4, ("sibling",)),
        ("..pkg.mod", ImportKind.STATIC, 5, ("thing", "other")),
    ]
    assert parsed.functions == []


def test_python_null_bytes_do_not_raise() -> None:
    parsed = parse_file("m.py", "import os\n\x00\n")
    assert parsed.parse_warning is not None
    assert [r.specifier for r in parsed.imports] == ["os"]


# --------------------------------------------------------------------------------------------
# JavaScript / TypeScript
# --------------------------------------------------------------------------------------------


def test_js_import_forms() -> None:
    source = """import React from 'react';
import { useState, useEffect as useFx } from "react";
import * as utils from './utils';
import Def, { named } from './mixed';
import Def2, * as ns from './mixed2';
import './side-effect.css';
import './polyfill';
"""
    parsed = parse_file("src/app.js", source)
    assert parsed.language is Language.JAVASCRIPT
    assert parsed.parse_warning is None
    assert _refs(parsed) == [
        ("react", ImportKind.STATIC, 1, ("default",)),
        ("react", ImportKind.STATIC, 2, ("useState", "useEffect")),
        ("./utils", ImportKind.STATIC, 3, ("*",)),
        ("./mixed", ImportKind.STATIC, 4, ("default", "named")),
        ("./mixed2", ImportKind.STATIC, 5, ("default", "*")),
        ("./side-effect.css", ImportKind.STATIC, 6, ()),
        ("./polyfill", ImportKind.STATIC, 7, ()),
    ]


def test_js_dynamic_and_require() -> None:
    source = """const fs = require('fs');
const local = require("./local");
const { a } = require('./destructured');
async function load() {
  const mod = await import('./lazy');
  const tpl = await import(`./template`);
  const skipped = await import(`./${name}`);
  const computed = require(name);
  return mod;
}
module.exports = { load };
"""
    parsed = parse_file("index.cjs", source)
    assert _refs(parsed) == [
        ("fs", ImportKind.REQUIRE, 1, ()),
        ("./local", ImportKind.REQUIRE, 2, ()),
        ("./destructured", ImportKind.REQUIRE, 3, ()),
        ("./lazy", ImportKind.DYNAMIC, 5, ()),
        ("./template", ImportKind.DYNAMIC, 6, ()),
    ]
    assert parsed.functions == ["load"]


def test_js_reexports() -> None:
    source = """export * from './all';
export * as ns from './namespaced';
export { a, b as c } from './named';
export { default } from './def';
export { default as Button } from './Button';
"""
    parsed = parse_file("src/index.js", source)
    assert _refs(parsed) == [
        ("./all", ImportKind.REEXPORT, 1, ("*",)),
        ("./namespaced", ImportKind.REEXPORT, 2, ("*",)),
        ("./named", ImportKind.REEXPORT, 3, ("a", "b")),
        ("./def", ImportKind.REEXPORT, 4, ("default",)),
        ("./Button", ImportKind.REEXPORT, 5, ("default",)),
    ]
    assert parsed.exports == ["ns", "a", "c", "default", "Button"]


def test_js_exports_and_definitions() -> None:
    source = """export const answer = 42, other = 1;
export let mutable = 0;
export function greet() {}
export async function fetchAll() {}
export function* gen() {}
export class Widget {}
export const handler = () => {};
const helper = function () {};
let arrow = async () => {};
function internal() {}
class Internal {}
const Klass = class {};
const { x, y } = obj;
const a = 1, b = 2;
export { internal, helper as publicHelper };
export default function main() {}
"""
    parsed = parse_file("lib.mjs", source)
    assert parsed.parse_warning is None
    assert parsed.imports == []
    assert parsed.exports == [
        "answer",
        "other",
        "mutable",
        "greet",
        "fetchAll",
        "gen",
        "Widget",
        "handler",
        "internal",
        "publicHelper",
        "default",
    ]
    assert parsed.functions == [
        "greet",
        "fetchAll",
        "gen",
        "handler",
        "helper",
        "arrow",
        "internal",
        "main",
    ]
    assert parsed.classes == ["Widget", "Internal", "Klass"]


def test_js_export_default_expression() -> None:
    parsed = parse_file("a.js", "const App = () => null;\nexport default App;\n")
    assert parsed.exports == ["default"]
    assert parsed.functions == ["App"]


def test_jsx_in_js_file() -> None:
    source = """import Button from './Button';
export default function Page() {
  return <div className="x"><Button onClick={() => import('./modal')} /></div>;
}
"""
    parsed = parse_file("pages/index.jsx", source)
    assert parsed.parse_warning is None
    assert _refs(parsed) == [
        ("./Button", ImportKind.STATIC, 1, ("default",)),
        ("./modal", ImportKind.DYNAMIC, 3, ()),
    ]
    assert parsed.functions == ["Page"]
    assert parsed.exports == ["default"]


def test_ts_type_only_imports_and_exports() -> None:
    source = """import type { User } from './types';
import type Config from './config';
import { type A, type B } from './ab';
import { type C, D } from './cd';
export type { Shape } from './shapes';
export interface Props { a: string }
export type Id = string;
export enum Color { Red, Green }
export abstract class Base {}
export declare function declared(): void;
export namespace NS { export const v = 1; }
import fs = require('fs');
"""
    parsed = parse_file("src/models.ts", source)
    assert parsed.language is Language.TYPESCRIPT
    assert parsed.parse_warning is None
    specs = _specs(parsed)
    assert specs["./types"].kind is ImportKind.TYPE_ONLY
    assert specs["./types"].names == ("User",)
    assert specs["./config"].kind is ImportKind.TYPE_ONLY
    assert specs["./ab"].kind is ImportKind.TYPE_ONLY
    assert specs["./ab"].names == ("A", "B")
    assert specs["./cd"].kind is ImportKind.STATIC
    assert specs["./shapes"].kind is ImportKind.TYPE_ONLY
    assert specs["fs"].kind is ImportKind.REQUIRE
    assert specs["fs"].line == 12
    for name in ("Shape", "Props", "Id", "Color", "Base", "declared"):
        assert name in parsed.exports
    assert "Base" in parsed.classes
    assert "declared" in parsed.functions


def test_ts_generics_and_casts_parse_cleanly() -> None:
    source = """import { z } from 'zod';
export const parse = <T,>(value: unknown): T => value as T;
export function identity<T>(value: T): T { return value; }
const n = <number>(<unknown>'1');
"""
    parsed = parse_file("src/util.ts", source)
    assert parsed.parse_warning is None
    assert parsed.functions == ["parse", "identity"]
    assert parsed.exports == ["parse", "identity"]


def test_tsx_component() -> None:
    source = """'use client';
import { useState } from 'react';
import type { FC } from 'react';
import { cn } from '@/lib/utils';
import styles from './page.module.css';

type Props = { title: string };

export const Header: FC<Props> = ({ title }) => {
  const [open, setOpen] = useState(false);
  return <h1 className={cn(styles.h, open && 'o')}>{title}</h1>;
};

export default function Page() {
  const Chart = dynamic(() => import('@/components/chart'));
  return <Header title="x" />;
}
"""
    parsed = parse_file("src/app/page.tsx", source)
    assert parsed.parse_warning is None
    assert _refs(parsed) == [
        ("react", ImportKind.STATIC, 2, ("useState",)),
        ("react", ImportKind.TYPE_ONLY, 3, ("FC",)),
        ("@/lib/utils", ImportKind.STATIC, 4, ("cn",)),
        ("./page.module.css", ImportKind.STATIC, 5, ("default",)),
        ("@/components/chart", ImportKind.DYNAMIC, 15, ()),
    ]
    assert parsed.exports == ["Header", "default"]
    assert parsed.functions == ["Header", "Page"]


def test_js_syntax_error_sets_warning_but_keeps_imports() -> None:
    source = """import a from './a';
import { b } from './b';

function broken( {
  return 1;

export const ok = 1;
"""
    parsed = parse_file("src/broken.js", source)
    assert parsed.parse_warning is not None
    assert parsed.parse_warning.startswith("Syntax error line ")
    specifiers = [r.specifier for r in parsed.imports]
    assert specifiers[:2] == ["./a", "./b"]


def test_ts_missing_token_warning() -> None:
    parsed = parse_file("a.ts", "import x from './x';\nconst y = (1 + 2;\n")
    assert parsed.parse_warning is not None
    assert "line 2" in parsed.parse_warning
    assert [r.specifier for r in parsed.imports] == ["./x"]


def test_unicode_source_lines_are_correct() -> None:
    source = "// héllo wörld 🌍\nconst s = '日本語';\nimport x from './x';\n"
    parsed = parse_file("a.js", source)
    assert _refs(parsed) == [("./x", ImportKind.STATIC, 3, ("default",))]
