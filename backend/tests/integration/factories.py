"""Seed helpers for API integration tests: COMPLETED analyses written straight to the DB (no
GitHub, no pipeline) plus thin wrappers around the tour endpoints."""

import hashlib
import posixpath
import uuid
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.models import Analysis, AnalysisStatus, EdgeRow, FileNode, Repository
from app.engine.graph_algorithms import classify_role
from app.engine.types import ImportKind, Language
from app.services.github_service import RepoRef, Snapshot

SHA_A = "a" * 40
SHA_B = "b" * 40
OWNER_ID = uuid.UUID(int=1)
TRAINEE_ID = uuid.UUID(int=2)

_LANGUAGES = {
    ".py": Language.PYTHON,
    ".js": Language.JAVASCRIPT,
    ".jsx": Language.JAVASCRIPT,
    ".ts": Language.TYPESCRIPT,
    ".tsx": Language.TYPESCRIPT,
}


async def make_repository(db: AsyncSession, owner: str = "octo", name: str = "demo") -> Repository:
    repo = Repository(owner=owner, name=name, default_branch="main")
    db.add(repo)
    await db.commit()
    return repo


async def make_analysis(
    db: AsyncSession,
    repo: Repository,
    files: Mapping[str, str],
    *,
    commit_sha: str = SHA_A,
    edges: Sequence[tuple[str, str]] = (),
    requested_by: uuid.UUID | None = None,
    status: AnalysisStatus = AnalysisStatus.COMPLETED,
) -> Analysis:
    """Analysis + FileNode (with content) + EdgeRow rows; roles derived from degrees."""
    languages = {p: _LANGUAGES[posixpath.splitext(p)[1]] for p in files}
    out_deg = Counter(s for s, _ in edges)
    in_deg = Counter(t for _, t in edges)
    analysis = Analysis(
        repository_id=repo.id,
        branch="main",
        commit_sha=commit_sha,
        status=status,
        requested_by_user_id=requested_by,
        total_source_files=len(files),
        analyzed_files=len(files),
        edge_count=len(edges),
        cycle_count=0,
        parse_warning_count=0,
        unresolved_imports=0,
        external_imports=0,
        language_breakdown=dict(Counter(lang.value for lang in languages.values())),
        cycles=[],
        finished_at=utcnow() if status == AnalysisStatus.COMPLETED else None,
    )
    db.add(analysis)
    await db.flush()
    for path, content in files.items():
        db.add(
            FileNode(
                analysis_id=analysis.id,
                path=path,
                language=languages[path],
                loc=len(content.splitlines()),
                in_degree=in_deg[path],
                out_degree=out_deg[path],
                role=classify_role(in_deg[path], out_deg[path]),
                exports=[],
                functions=[],
                classes=[],
                content_sha256=hashlib.sha256(content.encode()).hexdigest(),
                content=content,
            )
        )
    for source, target in edges:
        db.add(
            EdgeRow(
                analysis_id=analysis.id,
                source_path=source,
                target_path=target,
                kind=ImportKind.STATIC,
                line=1,
            )
        )
    await db.commit()
    return analysis


class FakeGitHub:
    """Stands in for GitHubClient: `resolve_ref` returns `sha`; downloads are forbidden so the
    tests prove that the pre-seeded analysis for `sha` is reused."""

    def __init__(self, sha: str) -> None:
        self.sha = sha
        self.resolved: list[tuple[str, str, str | None]] = []

    async def resolve_ref(self, owner: str, name: str, branch: str | None) -> RepoRef:
        self.resolved.append((owner, name, branch))
        return RepoRef(
            owner=owner,
            name=name,
            default_branch="main",
            branch=branch or "main",
            commit_sha=self.sha,
            description=None,
            stars=None,
        )

    async def download_snapshot(self, *args: Any, **kwargs: Any) -> Snapshot:
        raise AssertionError("sync must reuse the cached analysis instead of downloading")


# ---------- API helpers ----------


async def api_create_tour(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    analysis_id: uuid.UUID,
    *,
    title: str = "Onboarding tour",
    visibility: str = "PUBLIC",
) -> dict[str, Any]:
    res = await client.post(
        "/api/v1/tours",
        json={"analysis_id": str(analysis_id), "title": title, "visibility": visibility},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    data: dict[str, Any] = res.json()["data"]
    return data


async def api_create_step(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    tour_id: str,
    file_path: str,
    start_line: int,
    end_line: int,
    *,
    title: str = "Step",
    checkpoint: dict[str, Any] | None = None,
    position: int | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "title": title,
        "body_markdown": f"About {file_path}",
        "file_path": file_path,
        "start_line": start_line,
        "end_line": end_line,
    }
    if checkpoint is not None:
        body["checkpoint"] = checkpoint
    if position is not None:
        body["position"] = position
    res = await client.post(f"/api/v1/tours/{tour_id}/steps", json=body, headers=headers)
    assert res.status_code == 201, res.text
    data: dict[str, Any] = res.json()["data"]
    return data
