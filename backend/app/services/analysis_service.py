"""Analysis orchestration: enqueue (dedupe per commit), run the pipeline, persist results.

The `analyses` row is both the result summary and the durable job (see app.workers).
Every status transition is committed so clients can poll progress.
"""

import asyncio
import hashlib
import logging
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.db.base import utcnow
from app.db.models import Analysis, AnalysisStatus, EdgeRow, FileNode, Repository
from app.engine.pipeline import analyze_sources
from app.engine.types import AnalysisResult, FileRole
from app.schemas.atlas import parse_repo_url
from app.services.github_service import GitHubClient, RepoRef, Snapshot

logger = logging.getLogger(__name__)

RUNNING_STATUSES = (
    AnalysisStatus.FETCHING_TREE,
    AnalysisStatus.PARSING_AST,
    AnalysisStatus.COMPUTING_GRAPH,
)
ACTIVE_STATUSES = (AnalysisStatus.PENDING, *RUNNING_STATUSES)
INSERT_CHUNK = 1000
MAX_STORED_CYCLES = 100
INLINE_WAIT_SECONDS = 120.0
_INTERNAL_MESSAGE = "Analysis failed due to an internal error"


# ---------- helpers ----------


def stale_cutoff() -> datetime:
    """Locks older than this belong to a dead worker and may be reclaimed."""
    return utcnow() - timedelta(seconds=get_settings().worker_stale_lock_seconds)


async def _load(db: AsyncSession, analysis_id: uuid.UUID) -> Analysis | None:
    stmt = (
        select(Analysis)
        .options(selectinload(Analysis.repository))
        .where(Analysis.id == analysis_id)
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _upsert_repository(db: AsyncSession, ref: RepoRef) -> uuid.UUID:
    now = utcnow()
    values = {
        "default_branch": ref.default_branch,
        "description": ref.description,
        "stars": ref.stars,
        "updated_at": now,
    }
    stmt = (
        pg_insert(Repository)
        .values(id=uuid.uuid4(), owner=ref.owner, name=ref.name, created_at=now, **values)
        .on_conflict_do_update(constraint="uq_repositories_owner_name", set_=values)
        .returning(Repository.id)
    )
    return (await db.execute(stmt)).scalar_one()


async def _claim_or_create(
    db: AsyncSession,
    repository_id: uuid.UUID,
    branch: str,
    commit_sha: str,
    user_id: uuid.UUID | None,
) -> tuple[Analysis, bool]:
    """Insert a PENDING row (race-safe via ON CONFLICT) or lock the existing one.
    Returns (analysis, created)."""
    now = utcnow()
    inserted = await db.scalar(
        pg_insert(Analysis)
        .values(
            id=uuid.uuid4(),
            repository_id=repository_id,
            branch=branch,
            commit_sha=commit_sha,
            status=AnalysisStatus.PENDING,
            requested_by_user_id=user_id,
            attempts=0,
            truncated=False,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_analyses_repo_commit")
        .returning(Analysis.id)
    )
    stmt = (
        select(Analysis)
        .where(Analysis.repository_id == repository_id, Analysis.commit_sha == commit_sha)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one(), inserted is not None


async def _delete_results(db: AsyncSession, analysis_id: uuid.UUID) -> None:
    await db.execute(delete(EdgeRow).where(EdgeRow.analysis_id == analysis_id))
    await db.execute(delete(FileNode).where(FileNode.analysis_id == analysis_id))


async def _reset(db: AsyncSession, a: Analysis, branch: str, user_id: uuid.UUID | None) -> None:
    await _delete_results(db, a.id)
    a.status = AnalysisStatus.PENDING
    a.branch = branch
    if user_id is not None:
        a.requested_by_user_id = user_id
    for attr in (
        "error_code",
        "error_message",
        "locked_at",
        "started_at",
        "finished_at",
        "total_source_files",
        "analyzed_files",
        "edge_count",
        "cycle_count",
        "parse_warning_count",
        "unresolved_imports",
        "external_imports",
        "language_breakdown",
        "cycles",
    ):
        setattr(a, attr, None)
    a.attempts = 0
    a.truncated = False


Row = dict[str, Any]


def _chunks(rows: Sequence[Row], size: int = INSERT_CHUNK) -> Iterable[list[Row]]:
    for i in range(0, len(rows), size):
        yield list(rows[i : i + size])


async def _set_status(db: AsyncSession, a: Analysis, status: AnalysisStatus) -> None:
    logger.info("analysis %s -> %s", a.id, status.value)
    a.status = status
    a.locked_at = utcnow()  # heartbeat: keeps the stale-lock reaper away from live jobs
    await db.commit()


async def _fail(db: AsyncSession, analysis_id: uuid.UUID, code: ErrorCode, message: str) -> None:
    await db.rollback()
    now = utcnow()
    await db.execute(
        update(Analysis)
        .where(Analysis.id == analysis_id)
        .values(
            status=AnalysisStatus.FAILED,
            error_code=code.value,
            error_message=message,
            finished_at=now,
            locked_at=None,
            updated_at=now,
        )
    )
    await db.commit()
    logger.info("analysis %s FAILED: %s %s", analysis_id, code.value, message)


async def _persist(db: AsyncSession, a: Analysis, snap: Snapshot, result: AnalysisResult) -> None:
    await _delete_results(db, a.id)
    report = result.cycles
    nodes: list[dict[str, Any]] = []
    for path in sorted(result.files):
        pf, m = result.files[path], result.metrics.get(path)
        content = snap.sources.get(path, "")
        nodes.append(
            {
                "id": uuid.uuid4(),
                "analysis_id": a.id,
                "path": path,
                "language": pf.language,
                "loc": pf.loc,
                "in_degree": m.in_degree if m else 0,
                "out_degree": m.out_degree if m else 0,
                "role": m.role if m else FileRole.ISOLATED,
                "pagerank": m.pagerank if m else 0.0,
                "is_circular": m.is_circular if m else path in report.circular_nodes,
                "scc_id": m.scc_id if m else report.scc_id_by_node.get(path),
                "parse_warning": pf.parse_warning,
                "exports": list(pf.exports),
                "functions": list(pf.functions),
                "classes": list(pf.classes),
                "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                "content": content,
            }
        )
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for e in result.graph.edges:
        if (e.source, e.target) in seen:
            continue
        seen.add((e.source, e.target))
        edges.append(
            {
                "id": uuid.uuid4(),
                "analysis_id": a.id,
                "source_path": e.source,
                "target_path": e.target,
                "kind": e.kind,
                "line": e.line,
                "is_circular": (e.source, e.target) in report.circular_edges,
            }
        )
    for chunk in _chunks(nodes):
        await db.execute(insert(FileNode), chunk)
    for chunk in _chunks(edges):
        await db.execute(insert(EdgeRow), chunk)

    a.total_source_files = snap.total_source_files
    a.analyzed_files = len(nodes)
    a.truncated = snap.truncated
    a.edge_count = len(edges)
    a.cycle_count = len(report.cycles)
    a.parse_warning_count = sum(1 for f in result.files.values() if f.parse_warning)
    a.unresolved_imports = result.unresolved_imports
    a.external_imports = result.external_imports
    a.language_breakdown = dict(
        sorted(Counter(f.language.value for f in result.files.values()).items())
    )
    a.cycles = [list(c) for c in report.cycles[:MAX_STORED_CYCLES]]


# ---------- public API ----------


async def enqueue_analysis(
    db: AsyncSession,
    *,
    repo_url: str,
    branch: str | None,
    force: bool,
    user_id: uuid.UUID | None,
    gh: GitHubClient,
) -> Analysis:
    """Resolve the ref, upsert the repository and return the (possibly cached) analysis.

    COMPLETED or in-flight analyses for the same commit are returned as-is (in-flight ones even
    with `force`, since a worker owns them); FAILED ones, or COMPLETED ones with `force`, are
    reset to PENDING."""
    try:
        owner, name, url_branch = parse_repo_url(repo_url)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REPO_URL, str(exc)) from exc
    ref = await gh.resolve_ref(owner, name, branch or url_branch)
    repository_id = await _upsert_repository(db, ref)
    a, created = await _claim_or_create(db, repository_id, ref.branch, ref.commit_sha, user_id)
    if not created and (
        a.status == AnalysisStatus.FAILED or (force and a.status == AnalysisStatus.COMPLETED)
    ):
        await _reset(db, a, ref.branch, user_id)
        logger.info("analysis %s reset for re-run (force=%s)", a.id, force)
    await db.commit()
    loaded = await _load(db, a.id)
    assert loaded is not None
    return loaded


async def run_analysis(db: AsyncSession, analysis_id: uuid.UUID, gh: GitHubClient) -> None:
    """Execute the pipeline for one analysis. Always ends in COMPLETED or FAILED."""
    a = await _load(db, analysis_id)
    if a is None:
        logger.warning("analysis %s vanished before it could run", analysis_id)
        return
    if a.status in (AnalysisStatus.COMPLETED, AnalysisStatus.FAILED):
        return
    settings = get_settings()
    owner, name, sha = a.repository.owner, a.repository.name, a.commit_sha
    try:
        a.started_at = utcnow()
        await _set_status(db, a, AnalysisStatus.FETCHING_TREE)
        snap = await gh.download_snapshot(
            owner,
            name,
            sha,
            max_files=settings.max_files,
            max_file_bytes=settings.max_file_bytes,
            max_tarball_bytes=settings.max_tarball_bytes,
        )
        if not snap.sources:
            raise AppError(
                ErrorCode.NO_SOURCE_FILES,
                "No supported source files (Python, JavaScript, TypeScript) found",
            )
        await _set_status(db, a, AnalysisStatus.PARSING_AST)
        result = await asyncio.to_thread(analyze_sources, snap.sources, snap.config_files)
        await _set_status(db, a, AnalysisStatus.COMPUTING_GRAPH)
        await _persist(db, a, snap, result)
        a.status = AnalysisStatus.COMPLETED
        a.finished_at = utcnow()
        a.locked_at = None
        await db.commit()
        logger.info(
            "analysis %s COMPLETED (%s/%s@%s: %d files, %d edges)",
            analysis_id,
            owner,
            name,
            sha[:7],
            len(result.files),
            len(result.graph.edges),
        )
    except AppError as exc:
        await _fail(db, analysis_id, exc.code, exc.message)
    except Exception:
        logger.exception("analysis %s crashed", analysis_id)
        await _fail(db, analysis_id, ErrorCode.INTERNAL_ERROR, _INTERNAL_MESSAGE)


def _stored_error(a: Analysis) -> AppError:
    try:
        code = ErrorCode(a.error_code or ErrorCode.INTERNAL_ERROR)
    except ValueError:
        code = ErrorCode.INTERNAL_ERROR
    return AppError(code, a.error_message or _INTERNAL_MESSAGE)


async def ensure_completed_analysis(
    db: AsyncSession,
    repository: Repository,
    branch: str,
    commit_sha: str,
    gh: GitHubClient,
) -> Analysis:
    """Return a COMPLETED analysis for `commit_sha`, running it inline if needed.

    Claims the row by moving it to FETCHING_TREE with a fresh lock (so the worker skips it);
    if a live worker already owns it, waits up to INLINE_WAIT_SECONDS for it to finish.
    Raises the stored AppError if the analysis FAILED."""
    a, _ = await _claim_or_create(db, repository.id, branch, commit_sha, None)
    unlocked = a.locked_at is None or a.locked_at < stale_cutoff()
    claimable = a.status == AnalysisStatus.FAILED or (a.status in ACTIVE_STATUSES and unlocked)
    if a.status == AnalysisStatus.COMPLETED:
        await db.commit()
    elif claimable:
        if a.status == AnalysisStatus.FAILED:
            await _reset(db, a, branch, None)
        a.status = AnalysisStatus.FETCHING_TREE
        a.locked_at = utcnow()
        a.attempts += 1
        await db.commit()
        await run_analysis(db, a.id, gh)
    else:
        await db.commit()
        await _wait_for_terminal(db, a.id)

    done = await _load(db, a.id)
    assert done is not None
    if done.status == AnalysisStatus.FAILED:
        raise _stored_error(done)
    if done.status != AnalysisStatus.COMPLETED:
        raise AppError(
            ErrorCode.ANALYSIS_NOT_READY, "The new commit is still being analyzed, retry soon"
        )
    return done


async def _wait_for_terminal(db: AsyncSession, analysis_id: uuid.UUID) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + INLINE_WAIT_SECONDS
    while loop.time() < deadline:
        status = await db.scalar(select(Analysis.status).where(Analysis.id == analysis_id))
        await db.commit()
        if status in (AnalysisStatus.COMPLETED, AnalysisStatus.FAILED, None):
            return
        await asyncio.sleep(1.0)
