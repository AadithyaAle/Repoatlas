import pytest

from app.engine import pipeline
from app.engine.pipeline import analyze_sources
from app.engine.types import AnalysisResult, FileRole, ImportKind, ParsedFile

S = ImportKind.STATIC

NEXT_TSCONFIG = """{
  "compilerOptions": {
    "target": "ES2017",
    "strict": true,
    // Next.js default alias
    "paths": { "@/*": ["./src/*"], },
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
}"""

NEXT_APP = {
    "next.config.mjs": "/** @type {import('next').NextConfig} */\nexport default {};\n",
    "src/app/layout.tsx": """import './globals.css';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';

export const metadata: Metadata = { title: 'Blog' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body><Header />{children}</body></html>;
}
""",
    "src/app/page.tsx": """import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getPosts } from '@/lib/posts';

const Chart = dynamic(() => import('@/components/Chart'));

export default async function Page() {
  const posts = await getPosts();
  return <main>{posts.map((p) => <Link key={p.id} href={p.id}>{p.title}</Link>)}<Chart /></main>;
}
""",
    "src/components/Header.tsx": """import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Header() {
  return <header className={cn('h')}><Link href="/">Home</Link></header>;
}
""",
    "src/components/ui/button.tsx": """import * as React from 'react';
import { cn } from '../../lib/utils';

export const Button = (props: React.ComponentProps<'button'>) => (
  <button className={cn('btn')} {...props} />
);
""",
    "src/components/Chart.tsx": "export default function Chart() { return null; }\n",
    "src/lib/utils.ts": """import { clsx, type ClassValue } from 'clsx';
export function cn(...inputs: ClassValue[]) { return clsx(inputs); }
""",
    "src/lib/posts.ts": """import { db } from './db';
import type { Post } from '@/types';
export async function getPosts(): Promise<Post[]> { return db.posts(); }
""",
    "src/lib/db.ts": """import { getPosts } from './posts';
export const db = { posts: async () => [], warm: () => getPosts() };
""",
    "src/types/index.ts": "export interface Post { id: string; title: string }\n",
    "src/lib/legacy.ts": "import x from './does-not-exist';\nexport default x;\n",
    "README.md": "# not source\n",
}


def _edges(result: AnalysisResult) -> set[tuple[str, str, ImportKind]]:
    return {(e.source, e.target, e.kind) for e in result.graph.edges}


def test_next_js_project() -> None:
    result = analyze_sources(NEXT_APP, {"tsconfig.json": NEXT_TSCONFIG})

    assert result.graph.nodes == sorted(p for p in NEXT_APP if p != "README.md")
    assert set(result.files) == set(result.graph.nodes)
    assert _edges(result) == {
        ("src/app/layout.tsx", "src/components/Header.tsx", S),
        ("src/app/page.tsx", "src/components/ui/button.tsx", S),
        ("src/app/page.tsx", "src/lib/posts.ts", S),
        ("src/app/page.tsx", "src/components/Chart.tsx", ImportKind.DYNAMIC),
        ("src/components/Header.tsx", "src/lib/utils.ts", S),
        ("src/components/ui/button.tsx", "src/lib/utils.ts", S),
        ("src/lib/posts.ts", "src/lib/db.ts", S),
        ("src/lib/posts.ts", "src/types/index.ts", ImportKind.TYPE_ONLY),
        ("src/lib/db.ts", "src/lib/posts.ts", S),
    }
    # next (type), next/dynamic, next/link x2, react, clsx; globals.css is an asset (not counted)
    assert result.external_imports == 6
    assert result.unresolved_imports == 1  # ./does-not-exist

    assert result.cycles.circular_nodes == {"src/lib/posts.ts", "src/lib/db.ts"}
    assert ("src/lib/posts.ts", "src/lib/db.ts") in result.cycles.circular_edges
    assert result.metrics["src/app/layout.tsx"].role is FileRole.ENTRY_POINT
    assert result.metrics["src/components/Chart.tsx"].role is FileRole.LEAF
    assert result.metrics["next.config.mjs"].role is FileRole.ISOLATED
    assert result.metrics["src/lib/utils.ts"].in_degree == 2
    assert result.files["src/app/page.tsx"].exports == ["default"]
    assert all(f.parse_warning is None for f in result.files.values())


PY_PACKAGE = {
    "src/shop/__init__.py": 'from .api import create_app\n\n__all__ = ["create_app"]\n',
    "src/shop/api.py": """from fastapi import FastAPI

from . import models, services
from .config import settings


def create_app() -> FastAPI:
    return FastAPI(title=settings.name)
""",
    "src/shop/config.py": """import os


class Settings:
    name = os.getenv("NAME", "shop")


settings = Settings()
""",
    "src/shop/models.py": """from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from shop.services import OrderService


class Order:
    service: OrderService | None = None
""",
    "src/shop/services/__init__.py": "from .orders import OrderService\n",
    "src/shop/services/orders.py": """from ..models import Order
from shop.config import settings
import shop.missing_mod


class OrderService:
    def place(self) -> Order:
        return Order()
""",
    "src/shop/broken.py": "from .config import settings\ndef oops(:\n    pass\n",
    "tests/test_api.py": """import pytest

from shop.api import create_app


def test_app() -> None:
    assert create_app()
""",
}


def test_python_package() -> None:
    result = analyze_sources(PY_PACKAGE, {})

    init, api, config = "src/shop/__init__.py", "src/shop/api.py", "src/shop/config.py"
    models, services = "src/shop/models.py", "src/shop/services/__init__.py"
    orders = "src/shop/services/orders.py"
    assert _edges(result) == {
        (init, api, S),
        (api, models, S),
        (api, services, S),
        (api, config, S),
        (models, services, ImportKind.TYPE_ONLY),
        (services, orders, S),
        (orders, models, S),
        (orders, config, S),
        ("src/shop/broken.py", config, S),
        ("tests/test_api.py", api, S),
    }
    assert result.external_imports == 5  # fastapi, os, __future__, typing, pytest
    assert result.unresolved_imports == 1  # shop.missing_mod
    assert result.cycles.circular_nodes == {models, services, orders}

    broken = result.files["src/shop/broken.py"]
    assert broken.parse_warning is not None
    assert broken.parse_warning.startswith("SyntaxError line 2")
    assert result.files[init].exports == ["create_app"]
    assert result.files[api].functions == ["create_app"]
    assert result.metrics["tests/test_api.py"].role is FileRole.ENTRY_POINT


def test_parser_crash_is_contained(monkeypatch: pytest.MonkeyPatch) -> None:
    real_parse = pipeline.parse_file

    def flaky(path: str, source: str) -> ParsedFile:
        if path == "b.ts":
            raise RuntimeError("boom")
        return real_parse(path, source)

    monkeypatch.setattr(pipeline, "parse_file", flaky)
    result = analyze_sources({"a.ts": "import './b';\n", "b.ts": "import './a';\nx\n"}, {})
    assert result.files["b.ts"].parse_warning == "Parser failure: RuntimeError"
    assert result.files["b.ts"].loc == 2
    assert result.files["b.ts"].imports == []
    assert _edges(result) == {("a.ts", "b.ts", S)}


def test_self_import_is_kept_as_self_loop() -> None:
    result = analyze_sources({"a.ts": "import { x } from './a';\nexport const x = 1;\n"}, {})
    assert _edges(result) == {("a.ts", "a.ts", S)}


def test_unsupported_files_are_ignored_and_empty_input_works() -> None:
    result = analyze_sources({"notes.txt": "hi", "styles.css": "a{}"}, {})
    assert result.files == {}
    assert result.graph.nodes == []
    assert result.graph.edges == []
    assert result.external_imports == 0
    assert result.unresolved_imports == 0


def test_output_is_deterministic_regardless_of_input_order() -> None:
    forward = analyze_sources(NEXT_APP, {"tsconfig.json": NEXT_TSCONFIG})
    backward = analyze_sources(
        dict(reversed(list(NEXT_APP.items()))), {"tsconfig.json": NEXT_TSCONFIG}
    )
    assert forward.graph.nodes == backward.graph.nodes
    assert forward.graph.edges == backward.graph.edges
    assert list(forward.files) == list(backward.files)
