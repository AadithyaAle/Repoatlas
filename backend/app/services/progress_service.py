"""Trainee progress: answering checkpoints / acknowledging steps, in tour order."""

import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.security import CurrentUser
from app.db.base import utcnow
from app.db.models import UserStepProgress
from app.schemas.atlas import AnswerOut, AnswerRequest, TourProgressOut
from app.services import tour_service


def progress_out(
    tour_id: uuid.UUID, ordered_step_ids: Sequence[uuid.UUID], completed: Iterable[uuid.UUID]
) -> TourProgressOut:
    done = set(completed)
    completed_ids = [sid for sid in ordered_step_ids if sid in done]
    total = len(ordered_step_ids)
    return TourProgressOut(
        tour_id=tour_id,
        completed_step_ids=completed_ids,
        total_steps=total,
        percent_complete=round(len(completed_ids) / total * 100, 1) if total else 0.0,
    )


async def _completed_step_ids(
    db: AsyncSession, user_id: uuid.UUID, tour_id: uuid.UUID
) -> set[uuid.UUID]:
    rows = await db.scalars(
        select(UserStepProgress.step_id).where(
            UserStepProgress.user_id == user_id,
            UserStepProgress.tour_id == tour_id,
            UserStepProgress.completed.is_(True),
        )
    )
    return set(rows)


async def answer_step(
    db: AsyncSession,
    tour_id: uuid.UUID,
    step_id: uuid.UUID,
    body: AnswerRequest,
    user: CurrentUser,
) -> AnswerOut:
    tour = await tour_service.get_visible_tour(db, tour_id, user, steps=True)
    step = tour_service.find_step(tour, step_id)
    checkpoint = step.checkpoint or None
    if checkpoint is not None:
        n_options = len(checkpoint["options"])
        if body.selected_index is None or body.selected_index >= n_options:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"selected_index must be between 0 and {n_options - 1}",
                details={"options": n_options},
            )
        correct = body.selected_index == int(checkpoint["correct_index"])
    else:
        correct = True

    earlier = {s.id for s in tour.steps if s.position < step.position}
    if earlier - await _completed_step_ids(db, user.id, tour_id):
        raise AppError(ErrorCode.CONFLICT, "Complete the previous steps first")

    now = utcnow()
    await db.execute(
        pg_insert(UserStepProgress)
        .values(
            id=uuid.uuid4(),
            user_id=user.id,
            user_login=user.login,
            tour_id=tour_id,
            step_id=step_id,
            attempts=0,
            completed=False,
            updated_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_user_step_progress_user_step")
    )
    progress = (
        await db.execute(
            select(UserStepProgress)
            .where(UserStepProgress.user_id == user.id, UserStepProgress.step_id == step_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    if progress.attempts == 0 and checkpoint is not None:
        progress.first_try_correct = correct
    progress.attempts += 1
    progress.user_login = user.login or progress.user_login
    if correct and not progress.completed:
        progress.completed = True
        progress.completed_at = now
    progress.updated_at = now
    await db.commit()

    explanation = checkpoint.get("explanation") if checkpoint is not None and correct else None
    return AnswerOut(
        step_id=step_id,
        correct=correct,
        completed=progress.completed,
        attempts=progress.attempts,
        explanation=str(explanation) if explanation is not None else None,
    )


async def get_progress(db: AsyncSession, tour_id: uuid.UUID, user: CurrentUser) -> TourProgressOut:
    tour = await tour_service.get_visible_tour(db, tour_id, user, steps=True)
    ordered = [s.id for s in tour_service.ordered_steps(tour)]
    return progress_out(tour_id, ordered, await _completed_step_ids(db, user.id, tour_id))
