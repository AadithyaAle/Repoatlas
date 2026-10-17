import uuid

from fastapi import APIRouter, Query

from app.api.deps import DbSession
from app.schemas.atlas import AnalysisOut, BlastRadiusOut, FileContentOut, GraphOut
from app.schemas.common import ApiResponse, ok
from app.services import analysis_query_service, graph_service, serializers

router = APIRouter(prefix="/analyses", tags=["analyses"])


@router.get("/{analysis_id}", response_model=ApiResponse[AnalysisOut], summary="Analysis status")
async def get_analysis(analysis_id: uuid.UUID, db: DbSession) -> ApiResponse[AnalysisOut]:
    return ok(serializers.analysis_out(await graph_service.get_analysis(db, analysis_id)))


@router.get(
    "/{analysis_id}/graph",
    response_model=ApiResponse[GraphOut],
    summary="Dependency graph (409 ANALYSIS_NOT_READY until COMPLETED)",
)
async def get_graph(analysis_id: uuid.UUID, db: DbSession) -> ApiResponse[GraphOut]:
    return ok(await analysis_query_service.get_graph(db, analysis_id))


@router.get(
    "/{analysis_id}/file",
    response_model=ApiResponse[FileContentOut],
    summary="Source of one file at the analyzed commit",
)
async def get_file(
    analysis_id: uuid.UUID, db: DbSession, path: str = Query(min_length=1, max_length=1024)
) -> ApiResponse[FileContentOut]:
    return ok(await analysis_query_service.get_file(db, analysis_id, path))


@router.get(
    "/{analysis_id}/blast-radius",
    response_model=ApiResponse[BlastRadiusOut],
    summary="Reverse-BFS impact of changing a file",
)
async def get_blast_radius(
    analysis_id: uuid.UUID, db: DbSession, path: str = Query(min_length=1, max_length=1024)
) -> ApiResponse[BlastRadiusOut]:
    return ok(await analysis_query_service.get_blast_radius(db, analysis_id, path))
