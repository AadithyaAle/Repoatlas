"""Load a COMPLETED analysis' dependency graph from Postgres.

Completed analyses are immutable (pinned to a commit), so the in-memory graph is cached per
analysis id in a small LRU; blast-radius queries then cost one BFS, not a DB round trip.
"""

import uuid
from collections import OrderedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, undefer

from app.core.errors import AppError, ErrorCode
from app.db.models import Analysis, AnalysisStatus, EdgeRow, FileNode
from app.engine.graph_algorithms import build_graph
from app.engine.types import DependencyGraph, Edge

_CACHE_SIZE = 32
_cache: OrderedDict[uuid.UUID, DependencyGraph] = OrderedDict()


async def get_analysis(db: AsyncSession, analysis_id: uuid.UUID) -> Analysis:
    """Analysis with repository loaded, or NOT_FOUND."""
    stmt = (
        select(Analysis)
        .options(selectinload(Analysis.repository))
        .where(Analysis.id == analysis_id)
    )
    analysis = (await db.execute(stmt)).scalar_one_or_none()
    if analysis is None:
        raise AppError(ErrorCode.NOT_FOUND, "Analysis not found")
    return analysis


async def get_completed_analysis(db: AsyncSession, analysis_id: uuid.UUID) -> Analysis:
    analysis = await get_analysis(db, analysis_id)
    if analysis.status != AnalysisStatus.COMPLETED:
        raise AppError(
            ErrorCode.ANALYSIS_NOT_READY,
            f"Analysis is {analysis.status.value}",
            details={"status": analysis.status.value},
        )
    return analysis


async def load_graph(db: AsyncSession, analysis_id: uuid.UUID) -> DependencyGraph:
    """Caller must have checked the analysis is COMPLETED."""
    if (graph := _cache.get(analysis_id)) is not None:
        _cache.move_to_end(analysis_id)
        return graph
    paths = (
        await db.execute(select(FileNode.path).where(FileNode.analysis_id == analysis_id))
    ).scalars()
    rows = await db.execute(
        select(EdgeRow.source_path, EdgeRow.target_path, EdgeRow.kind, EdgeRow.line).where(
            EdgeRow.analysis_id == analysis_id
        )
    )
    graph = build_graph(list(paths), [Edge(s, t, k, line) for s, t, k, line in rows])
    _cache[analysis_id] = graph
    if len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return graph


def invalidate(analysis_id: uuid.UUID) -> None:
    """Call when an analysis is reset/re-run (force)."""
    _cache.pop(analysis_id, None)


async def get_file_node(db: AsyncSession, analysis_id: uuid.UUID, path: str) -> FileNode:
    """File node with content loaded, or FILE_NOT_IN_SNAPSHOT."""
    stmt = (
        select(FileNode)
        .options(undefer(FileNode.content))
        .where(FileNode.analysis_id == analysis_id, FileNode.path == path)
    )
    node = (await db.execute(stmt)).scalar_one_or_none()
    if node is None:
        raise AppError(
            ErrorCode.FILE_NOT_IN_SNAPSHOT,
            f"'{path}' is not part of this analysis",
            details={"path": path},
        )
    return node
