import uuid

from fastapi import APIRouter, Query

from app.api.deps import DbSession
from app.schemas.atlas import AnalysisOut, BlastRadiusOut, FileContentOut, GraphOut
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/analyses", tags=["analyses"])


@router.get("/{analysis_id}", response_model=ApiResponse[AnalysisOut], summary="Analysis status")
async def get_analysis(analysis_id: uuid.UUID, db: DbSession) -> ApiResponse[AnalysisOut]:
    raise NotImplementedError


@router.get(
    "/{analysis_id}/graph",
    response_model=ApiResponse[GraphOut],
    summary="Dependency graph (409 ANALYSIS_NOT_READY until COMPLETED)",
)
async def get_graph(analysis_id: uuid.UUID, db: DbSession) -> ApiResponse[GraphOut]:
    raise NotImplementedError


@router.get(
    "/{analysis_id}/file",
    response_model=ApiResponse[FileContentOut],
    summary="Source of one file at the analyzed commit",
)
async def get_file(
    analysis_id: uuid.UUID, db: DbSession, path: str = Query(min_length=1, max_length=1024)
) -> ApiResponse[FileContentOut]:
    raise NotImplementedError


@router.get(
    "/{analysis_id}/blast-radius",
    response_model=ApiResponse[BlastRadiusOut],
    summary="Reverse-BFS impact of changing a file",
)
async def get_blast_radius(
    analysis_id: uuid.UUID, db: DbSession, path: str = Query(min_length=1, max_length=1024)
) -> ApiResponse[BlastRadiusOut]:
    raise NotImplementedError
