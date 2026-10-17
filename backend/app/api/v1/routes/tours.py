import uuid

from fastapi import APIRouter, Query, status

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
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/tours", tags=["tours"])


# ----- Tours -----


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[TourOut])
async def create_tour(body: TourCreate, db: DbSession, user: AuthUser) -> ApiResponse[TourOut]:
    raise NotImplementedError


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
    raise NotImplementedError


@router.get("/{tour_id}", response_model=ApiResponse[TourOut])
async def get_tour(tour_id: uuid.UUID, db: DbSession, user: OptionalUser) -> ApiResponse[TourOut]:
    raise NotImplementedError


@router.patch("/{tour_id}", response_model=ApiResponse[TourOut])
async def update_tour(
    tour_id: uuid.UUID, body: TourUpdate, db: DbSession, user: AuthUser
) -> ApiResponse[TourOut]:
    raise NotImplementedError


@router.delete("/{tour_id}", response_model=ApiResponse[DeletedOut])
async def delete_tour(tour_id: uuid.UUID, db: DbSession, user: AuthUser) -> ApiResponse[DeletedOut]:
    raise NotImplementedError


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
    raise NotImplementedError


@router.patch("/{tour_id}/steps/{step_id}", response_model=ApiResponse[StepOut])
async def update_step(
    tour_id: uuid.UUID, step_id: uuid.UUID, body: StepUpdate, db: DbSession, user: AuthUser
) -> ApiResponse[StepOut]:
    raise NotImplementedError


@router.delete("/{tour_id}/steps/{step_id}", response_model=ApiResponse[DeletedOut])
async def delete_step(
    tour_id: uuid.UUID, step_id: uuid.UUID, db: DbSession, user: AuthUser
) -> ApiResponse[DeletedOut]:
    raise NotImplementedError


@router.put("/{tour_id}/steps/order", response_model=ApiResponse[list[StepOut]])
async def reorder_steps(
    tour_id: uuid.UUID, body: StepReorder, db: DbSession, user: AuthUser
) -> ApiResponse[list[StepOut]]:
    raise NotImplementedError


# ----- Drift engine (owner only) -----


@router.post(
    "/{tour_id}/sync",
    response_model=ApiResponse[SyncReportOut],
    summary="Sync & verify tour health against the latest commit",
)
async def sync_tour(
    tour_id: uuid.UUID, db: DbSession, user: AuthUser
) -> ApiResponse[SyncReportOut]:
    raise NotImplementedError


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
    raise NotImplementedError


# ----- Player / progress -----


@router.get("/{tour_id}/progress", response_model=ApiResponse[TourProgressOut])
async def get_progress(
    tour_id: uuid.UUID, db: DbSession, user: AuthUser
) -> ApiResponse[TourProgressOut]:
    raise NotImplementedError


@router.post(
    "/{tour_id}/steps/{step_id}/answer",
    response_model=ApiResponse[AnswerOut],
    summary="Answer a checkpoint (or acknowledge a step without one)",
)
async def answer_step(
    tour_id: uuid.UUID, step_id: uuid.UUID, body: AnswerRequest, db: DbSession, user: AuthUser
) -> ApiResponse[AnswerOut]:
    raise NotImplementedError
