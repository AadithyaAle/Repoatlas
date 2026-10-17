from fastapi import APIRouter

from app.schemas.atlas import MetaOut, RateLimitOut
from app.schemas.common import ApiResponse

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=ApiResponse[dict[str, str]], summary="Liveness + DB check")
async def health() -> ApiResponse[dict[str, str]]:
    raise NotImplementedError


@router.get("/meta", response_model=ApiResponse[MetaOut], summary="Server capabilities")
async def meta() -> ApiResponse[MetaOut]:
    raise NotImplementedError


@router.get(
    "/github/rate-limit",
    response_model=ApiResponse[RateLimitOut],
    summary="Remaining GitHub API quota for the server token",
)
async def github_rate_limit() -> ApiResponse[RateLimitOut]:
    raise NotImplementedError
