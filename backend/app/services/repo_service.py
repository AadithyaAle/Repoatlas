"""Repository listing/lookup with each repo's latest analysis and public tour count.

Bounded queries: one for repositories + latest analysis (DISTINCT ON subquery), one grouped
count for tours — never one query per repository."""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.core.errors import AppError, ErrorCode
from app.db.models import Analysis, Repository, Tour, TourVisibility
from app.schemas.atlas import RepositorySummaryOut
from app.services import serializers


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


RepoRows = Select[Repository, Analysis]


def _base_query() -> RepoRows:
    """(Repository, latest Analysis or None) rows."""
    latest = (
        select(Analysis.id.label("analysis_id"), Analysis.repository_id.label("repository_id"))
        .ext(distinct_on(Analysis.repository_id))
        .order_by(Analysis.repository_id, Analysis.created_at.desc(), Analysis.id.desc())
        .subquery("latest")
    )
    return (
        select(Repository, Analysis)
        .outerjoin(latest, latest.c.repository_id == Repository.id)
        .outerjoin(Analysis, Analysis.id == latest.c.analysis_id)
    )


async def _public_tour_counts(
    db: AsyncSession, repository_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not repository_ids:
        return {}
    rows = await db.execute(
        select(Tour.repository_id, func.count(Tour.id))
        .where(Tour.repository_id.in_(repository_ids), Tour.visibility == TourVisibility.PUBLIC)
        .group_by(Tour.repository_id)
    )
    return {rid: int(n) for rid, n in rows}


async def _summaries(db: AsyncSession, stmt: RepoRows) -> list[RepositorySummaryOut]:
    rows = (await db.execute(stmt)).all()
    pairs: list[tuple[Repository, Analysis | None]] = [(repo, a) for repo, a in rows]
    counts = await _public_tour_counts(db, [repo.id for repo, _ in pairs])
    out: list[RepositorySummaryOut] = []
    for repo, analysis in pairs:
        if analysis is not None:
            set_committed_value(analysis, "repository", repo)  # no lazy load in async
        out.append(
            RepositorySummaryOut(
                repository=serializers.repository_out(repo),
                latest_analysis=serializers.analysis_out(analysis) if analysis else None,
                tour_count=counts.get(repo.id, 0),
            )
        )
    return out


async def list_repositories(
    db: AsyncSession, *, q: str | None = None, limit: int = 20
) -> list[RepositorySummaryOut]:
    """Repositories by most recent analysis (newest first), optionally filtered by a
    case-insensitive substring of "owner/name"."""
    stmt = _base_query()
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where((Repository.owner + "/" + Repository.name).ilike(pattern, escape="\\"))
    stmt = stmt.order_by(
        Analysis.created_at.desc().nulls_last(), Repository.owner, Repository.name
    ).limit(limit)
    return await _summaries(db, stmt)


async def get_repository_summary(db: AsyncSession, owner: str, name: str) -> RepositorySummaryOut:
    """Case-insensitive owner/name lookup, or NOT_FOUND."""
    stmt = (
        _base_query()
        .where(
            func.lower(Repository.owner) == owner.lower(),
            func.lower(Repository.name) == name.lower(),
        )
        .order_by(Repository.created_at)
        .limit(1)
    )
    found = await _summaries(db, stmt)
    if not found:
        raise AppError(
            ErrorCode.NOT_FOUND,
            f"Repository {owner}/{name} has not been analyzed",
            details={"owner": owner, "name": name},
        )
    return found[0]
