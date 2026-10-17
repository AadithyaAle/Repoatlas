from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, OptionalUser
from app.schemas.atlas import AnalysisOut, AnalyzeRequest, RepositorySummaryOut
from app.schemas.common import ApiResponse, ok
from app.services import analysis_service, repo_service, serializers
from app.services.github_service import GitHubClient, get_github_client

router = APIRouter(prefix="/repos", tags=["repositories"])

GitHub = Annotated[GitHubClient, Depends(get_github_client)]


@router.post(
    "/analyze",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ApiResponse[AnalysisOut],
    summary="Queue an analysis of a public GitHub repo (deduplicated per commit)",
)
async def analyze_repo(
    body: AnalyzeRequest, db: DbSession, user: OptionalUser, gh: GitHub
) -> ApiResponse[AnalysisOut]:
    analysis = await analysis_service.enqueue_analysis(
        db,
        repo_url=body.repo_url,
        branch=body.branch,
        force=body.force,
        user_id=user.id if user else None,
        gh=gh,
    )
    return ok(serializers.analysis_out(analysis))


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
    return ok(await repo_service.list_repositories(db, q=q, limit=limit))


@router.get(
    "/{owner}/{name}",
    response_model=ApiResponse[RepositorySummaryOut],
    summary="Repository with its latest analysis",
)
async def get_repo(owner: str, name: str, db: DbSession) -> ApiResponse[RepositorySummaryOut]:
    return ok(await repo_service.get_repository_summary(db, owner, name))
