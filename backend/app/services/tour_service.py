"""Tour authoring: tours and their pinned steps.

Access rules (see CONTRIBUTING): PRIVATE tours are invisible to everyone but their owner
(NOT_FOUND); mutations of a visible tour by a non-owner are FORBIDDEN. Steps are always
looked up through their tour so a step id from another tour is NOT_FOUND.
"""

import uuid
from collections import Counter
from collections.abc import Iterable
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ErrorCode
from app.core.security import CurrentUser
from app.db.base import utcnow
from app.db.models import Tour, TourStep, TourVisibility
from app.engine import drift_detector
from app.engine.types import DriftStatus
from app.schemas.atlas import (
    StepCreate,
    StepOut,
    StepReorder,
    StepUpdate,
    TourCreate,
    TourOut,
    TourSummaryOut,
    TourUpdate,
)
from app.services import graph_service
from app.services.serializers import health_counts, repository_out, step_out

# ---------- access helpers (shared with drift / progress services) ----------


def is_owner(tour: Tour, user: CurrentUser | None) -> bool:
    return user is not None and tour.owner_user_id == user.id


async def get_visible_tour(
    db: AsyncSession, tour_id: uuid.UUID, user: CurrentUser | None, *, steps: bool = False
) -> Tour:
    """Tour (repository loaded, steps optionally) or NOT_FOUND when missing / private."""
    stmt = (
        select(Tour)
        .options(selectinload(Tour.repository))
        .where(Tour.id == tour_id)
        .execution_options(populate_existing=True)
    )
    if steps:
        stmt = stmt.options(selectinload(Tour.steps))
    tour = (await db.execute(stmt)).scalar_one_or_none()
    if tour is None or (tour.visibility == TourVisibility.PRIVATE and not is_owner(tour, user)):
        raise AppError(ErrorCode.NOT_FOUND, "Tour not found")
    return tour


async def get_owned_tour(
    db: AsyncSession, tour_id: uuid.UUID, user: CurrentUser, *, steps: bool = False
) -> Tour:
    tour = await get_visible_tour(db, tour_id, user, steps=steps)
    if not is_owner(tour, user):
        raise AppError(ErrorCode.FORBIDDEN, "Only the tour owner can modify this tour")
    return tour


def ordered_steps(tour: Tour) -> list[TourStep]:
    """`tour.steps` must be loaded."""
    return sorted(tour.steps, key=lambda s: s.position)


def find_step(tour: Tour, step_id: uuid.UUID) -> TourStep:
    """`tour.steps` must be loaded."""
    for step in tour.steps:
        if step.id == step_id:
            return step
    raise AppError(ErrorCode.NOT_FOUND, "Step not found")


def pin_snippet(content: str, start_line: int, end_line: int) -> tuple[str, str]:
    """(snippet, snippet_hash) for a 1-based inclusive range, or INVALID_LINE_RANGE."""
    try:
        snippet = drift_detector.extract_lines(content, start_line, end_line)
    except ValueError as exc:
        loc = len(content.splitlines())
        raise AppError(
            ErrorCode.INVALID_LINE_RANGE,
            f"Lines {start_line}-{end_line} are outside the file ({loc} lines)",
            details={"loc": loc, "start_line": start_line, "end_line": end_line},
        ) from exc
    return snippet, drift_detector.snippet_hash(snippet)


async def health_by_tour(
    db: AsyncSession, tour_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Counter[DriftStatus]]:
    """Step count per drift status for many tours in one grouped query."""
    ids = list(tour_ids)
    result: dict[uuid.UUID, Counter[DriftStatus]] = {tid: Counter() for tid in ids}
    if not ids:
        return result
    rows = await db.execute(
        select(TourStep.tour_id, TourStep.drift_status, func.count())
        .where(TourStep.tour_id.in_(ids))
        .group_by(TourStep.tour_id, TourStep.drift_status)
    )
    for tour_id, status, n in rows:
        result[tour_id][status] = int(n)
    return result


# ---------- serialization ----------


def _summary_fields(tour: Tour, statuses: list[DriftStatus]) -> dict[str, Any]:
    return {
        "id": tour.id,
        "title": tour.title,
        "description": tour.description,
        "visibility": tour.visibility,
        "repository": repository_out(tour.repository),
        "analysis_id": tour.analysis_id,
        "base_commit_sha": tour.base_commit_sha,
        "owner_user_id": tour.owner_user_id,
        "owner_login": tour.owner_login,
        "step_count": len(statuses),
        "health": health_counts(statuses),
        "last_synced_at": tour.last_synced_at,
        "created_at": tour.created_at,
        "updated_at": tour.updated_at,
    }


def summary_out(tour: Tour, statuses: Iterable[DriftStatus]) -> TourSummaryOut:
    """`tour.repository` must be loaded."""
    return TourSummaryOut(**_summary_fields(tour, list(statuses)))


def tour_out(tour: Tour, user: CurrentUser | None) -> TourOut:
    """`tour.repository` and `tour.steps` must be loaded."""
    owner = is_owner(tour, user)
    steps = ordered_steps(tour)
    return TourOut(
        **_summary_fields(tour, [s.drift_status for s in steps]),
        steps=[step_out(s, is_owner=owner) for s in steps],
        is_owner=owner,
    )


# ---------- tours ----------


async def create_tour(db: AsyncSession, body: TourCreate, user: CurrentUser) -> TourOut:
    analysis = await graph_service.get_completed_analysis(db, body.analysis_id)
    tour = Tour(
        repository_id=analysis.repository_id,
        analysis_id=analysis.id,
        owner_user_id=user.id,
        owner_login=user.login,
        title=body.title,
        description=body.description,
        visibility=body.visibility,
        base_commit_sha=analysis.commit_sha,
    )
    db.add(tour)
    await db.commit()
    return await get_tour(db, tour.id, user)


async def list_tours(
    db: AsyncSession,
    user: CurrentUser | None,
    *,
    repository_id: uuid.UUID | None = None,
    mine: bool = False,
) -> list[TourSummaryOut]:
    stmt = select(Tour).options(selectinload(Tour.repository))
    if mine:
        if user is None:
            raise AppError(ErrorCode.UNAUTHORIZED, "Authentication required")
        stmt = stmt.where(Tour.owner_user_id == user.id)
    elif user is None:
        stmt = stmt.where(Tour.visibility == TourVisibility.PUBLIC)
    else:
        stmt = stmt.where(
            or_(Tour.visibility == TourVisibility.PUBLIC, Tour.owner_user_id == user.id)
        )
    if repository_id is not None:
        stmt = stmt.where(Tour.repository_id == repository_id)
    tours = (await db.scalars(stmt.order_by(Tour.updated_at.desc(), Tour.id))).all()
    health = await health_by_tour(db, (t.id for t in tours))
    return [summary_out(t, health[t.id].elements()) for t in tours]


async def get_tour(db: AsyncSession, tour_id: uuid.UUID, user: CurrentUser | None) -> TourOut:
    return tour_out(await get_visible_tour(db, tour_id, user, steps=True), user)


async def update_tour(
    db: AsyncSession, tour_id: uuid.UUID, body: TourUpdate, user: CurrentUser
) -> TourOut:
    tour = await get_owned_tour(db, tour_id, user)
    if body.title is not None:
        tour.title = body.title
    if "description" in body.model_fields_set:
        tour.description = body.description
    if body.visibility is not None:
        tour.visibility = body.visibility
    tour.updated_at = utcnow()
    await db.commit()
    return await get_tour(db, tour_id, user)


async def delete_tour(db: AsyncSession, tour_id: uuid.UUID, user: CurrentUser) -> None:
    tour = await get_owned_tour(db, tour_id, user)
    await db.delete(tour)
    await db.commit()


# ---------- steps ----------


async def create_step(
    db: AsyncSession, tour_id: uuid.UUID, body: StepCreate, user: CurrentUser
) -> StepOut:
    tour = await get_owned_tour(db, tour_id, user, steps=True)
    node = await graph_service.get_file_node(db, tour.analysis_id, body.file_path)
    snippet, digest = pin_snippet(node.content, body.start_line, body.end_line)
    existing = ordered_steps(tour)
    position = len(existing) if body.position is None else min(body.position, len(existing))
    for s in existing:
        if s.position >= position:
            s.position += 1  # (tour_id, position) is unique DEFERRABLE INITIALLY DEFERRED
    now = utcnow()
    step = TourStep(
        position=position,
        title=body.title,
        body_markdown=body.body_markdown,
        file_path=body.file_path,
        start_line=body.start_line,
        end_line=body.end_line,
        snippet_hash=digest,
        snippet_snapshot=snippet,
        checkpoint=body.checkpoint.model_dump() if body.checkpoint else None,
        drift_status=DriftStatus.HEALTHY,
        drift_similarity=1.0,
        last_checked_at=now,
        last_checked_commit_sha=tour.base_commit_sha,
    )
    tour.steps.append(step)
    tour.updated_at = now
    await db.commit()
    return step_out(step, is_owner=True)


async def update_step(
    db: AsyncSession, tour_id: uuid.UUID, step_id: uuid.UUID, body: StepUpdate, user: CurrentUser
) -> StepOut:
    tour = await get_owned_tour(db, tour_id, user, steps=True)
    step = find_step(tour, step_id)
    if body.title is not None:
        step.title = body.title
    if body.body_markdown is not None:
        step.body_markdown = body.body_markdown
    if body.remove_checkpoint:
        step.checkpoint = None
    elif body.checkpoint is not None:
        step.checkpoint = body.checkpoint.model_dump()
    tour.updated_at = utcnow()
    await db.commit()
    return step_out(step, is_owner=True)


async def delete_step(
    db: AsyncSession, tour_id: uuid.UUID, step_id: uuid.UUID, user: CurrentUser
) -> None:
    tour = await get_owned_tour(db, tour_id, user, steps=True)
    step = find_step(tour, step_id)
    tour.steps.remove(step)  # delete-orphan cascade
    for i, s in enumerate(ordered_steps(tour)):
        s.position = i
    tour.updated_at = utcnow()
    await db.commit()


async def reorder_steps(
    db: AsyncSession, tour_id: uuid.UUID, body: StepReorder, user: CurrentUser
) -> list[StepOut]:
    tour = await get_owned_tour(db, tour_id, user, steps=True)
    by_id = {s.id: s for s in tour.steps}
    if len(body.step_ids) != len(set(body.step_ids)) or set(body.step_ids) != set(by_id):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "step_ids must list every step of the tour exactly once",
            details={"expected": len(by_id), "received": len(body.step_ids)},
        )
    for i, sid in enumerate(body.step_ids):
        by_id[sid].position = i
    tour.updated_at = utcnow()
    await db.commit()
    return [step_out(s, is_owner=True) for s in ordered_steps(tour)]
