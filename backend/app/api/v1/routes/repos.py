from fastapi import APIRouter, Query, status

from app.api.deps import DbSession, OptionalUser
from app.schemas.atlas import AnalysisOut, AnalyzeRequest, RepositorySummaryOut
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/repos", tags=["repositories"])


@router.post(
    "/analyze",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ApiResponse[AnalysisOut],
    summary="Queue an analysis of a public GitHub repo (deduplicated per commit)",
)
async def analyze_repo(
    body: AnalyzeRequest, db: DbSession, user: OptionalUser
) -> ApiResponse[AnalysisOut]:
    raise NotImplementedError


@router.get(
    "",
    response_model=ApiResponse[list[RepositorySummaryOut]],
    summary="Recently analyzed repositories",
)
async def list_repos(
    db: DbSession,
    q: str | None = Query(default=None, max_length=100, description="Filter by owner/name"),
    limit: int = Query(default=20, ge=1, le=100),
) -> ApiResponse[list[RepositorySummaryOut]]:
    raise NotImplementedError


@router.get(
    "/{owner}/{name}",
    response_model=ApiResponse[RepositorySummaryOut],
    summary="Repository with its latest analysis",
)
async def get_repo(owner: str, name: str, db: DbSession) -> ApiResponse[RepositorySummaryOut]:
    raise NotImplementedError
