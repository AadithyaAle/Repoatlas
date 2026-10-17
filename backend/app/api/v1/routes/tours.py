import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AuthUser, DbSession, OptionalUser
from app.schemas.atlas import (
    AnswerOut,
    AnswerRequest,
    DeletedOut,
    ResolveDriftRequest,
    StepCreate,
    StepOut,
    StepReorder,
    StepUpdate,
    SyncReportOut,
    TourCreate,
    TourOut,
    TourProgressOut,
    TourSummaryOut,
    TourUpdate,
)
from app.schemas.common import ApiResponse, ok
from app.services import drift_service, progress_service, tour_service
from app.services.github_service import GitHubClient, get_github_client

router = APIRouter(prefix="/tours", tags=["tours"])

GitHub = Annotated[GitHubClient, Depends(get_github_client)]


# ----- Tours -----


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[TourOut])
async def create_tour(body: TourCreate, db: DbSession, user: AuthUser) -> ApiResponse[TourOut]:
    return ok(await tour_service.create_tour(db, body, user))


@router.get(
    "",
    response_model=ApiResponse[list[TourSummaryOut]],
    summary="Public tours (+ caller's private tours), optionally filtered by repository",
)
async def list_tours(
    db: DbSession,
    user: OptionalUser,
    repository_id: uuid.UUID | None = Query(default=None),
    mine: bool = Query(default=False),
) -> ApiResponse[list[TourSummaryOut]]:
    return ok(await tour_service.list_tours(db, user, repository_id=repository_id, mine=mine))


@router.get("/{tour_id}", response_model=ApiResponse[TourOut])
async def get_tour(tour_id: uuid.UUID, db: DbSession, user: OptionalUser) -> ApiResponse[TourOut]:
    return ok(await tour_service.get_tour(db, tour_id, user))


@router.patch("/{tour_id}", response_model=ApiResponse[TourOut])
async def update_tour(
    tour_id: uuid.UUID, body: TourUpdate, db: DbSession, user: AuthUser
) -> ApiResponse[TourOut]:
    return ok(await tour_service.update_tour(db, tour_id, body, user))


@router.delete("/{tour_id}", response_model=ApiResponse[DeletedOut])
async def delete_tour(tour_id: uuid.UUID, db: DbSession, user: AuthUser) -> ApiResponse[DeletedOut]:
    await tour_service.delete_tour(db, tour_id, user)
    return ok(DeletedOut(id=tour_id))


# ----- Steps (owner only) -----


@router.post(
    "/{tour_id}/steps",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[StepOut],
    summary="Pin a line range; server computes snippet snapshot + SHA-256",
)
async def create_step(
    tour_id: uuid.UUID, body: StepCreate, db: DbSession, user: AuthUser
) -> ApiResponse[StepOut]:
    return ok(await tour_service.create_step(db, tour_id, body, user))


@router.patch("/{tour_id}/steps/{step_id}", response_model=ApiResponse[StepOut])
async def update_step(
    tour_id: uuid.UUID, step_id: uuid.UUID, body: StepUpdate, db: DbSession, user: AuthUser
) -> ApiResponse[StepOut]:
    return ok(await tour_service.update_step(db, tour_id, step_id, body, user))


@router.delete("/{tour_id}/steps/{step_id}", response_model=ApiResponse[DeletedOut])
async def delete_step(
    tour_id: uuid.UUID, step_id: uuid.UUID, db: DbSession, user: AuthUser
) -> ApiResponse[DeletedOut]:
    await tour_service.delete_step(db, tour_id, step_id, user)
    return ok(DeletedOut(id=step_id))


@router.put("/{tour_id}/steps/order", response_model=ApiResponse[list[StepOut]])
async def reorder_steps(
    tour_id: uuid.UUID, body: StepReorder, db: DbSession, user: AuthUser
) -> ApiResponse[list[StepOut]]:
    return ok(await tour_service.reorder_steps(db, tour_id, body, user))


# ----- Drift engine (owner only) -----


@router.post(
    "/{tour_id}/sync",
    response_model=ApiResponse[SyncReportOut],
    summary="Sync & verify tour health against the latest commit",
)
async def sync_tour(
    tour_id: uuid.UUID, db: DbSession, user: AuthUser, gh: GitHub
) -> ApiResponse[SyncReportOut]:
    return ok(await drift_service.sync_tour(db, tour_id, user, gh))


@router.post(
    "/{tour_id}/steps/{step_id}/resolve",
    response_model=ApiResponse[StepOut],
    summary="Resolve an OUTDATED_NEEDS_REVIEW step",
)
async def resolve_step(
    tour_id: uuid.UUID,
    step_id: uuid.UUID,
    body: ResolveDriftRequest,
    db: DbSession,
    user: AuthUser,
) -> ApiResponse[StepOut]:
    return ok(await drift_service.resolve_step(db, tour_id, step_id, body, user))


# ----- Player / progress -----


@router.get("/{tour_id}/progress", response_model=ApiResponse[TourProgressOut])
async def get_progress(
    tour_id: uuid.UUID, db: DbSession, user: AuthUser
) -> ApiResponse[TourProgressOut]:
    return ok(await progress_service.get_progress(db, tour_id, user))


@router.post(
    "/{tour_id}/steps/{step_id}/answer",
    response_model=ApiResponse[AnswerOut],
    summary="Answer a checkpoint (or acknowledge a step without one)",
)
async def answer_step(
    tour_id: uuid.UUID, step_id: uuid.UUID, body: AnswerRequest, db: DbSession, user: AuthUser
) -> ApiResponse[AnswerOut]:
    return ok(await progress_service.answer_step(db, tour_id, step_id, body, user))
