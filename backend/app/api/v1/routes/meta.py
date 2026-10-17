import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.deps import DbSession
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.core.version import VERSION
from app.schemas.atlas import HealthOut, MetaOut, RateLimitOut
from app.schemas.common import ApiResponse, ok
from app.services.github_service import GitHubClient, get_github_client

router = APIRouter(tags=["meta"])
logger = logging.getLogger(__name__)

GitHub = Annotated[GitHubClient, Depends(get_github_client)]


@router.get("/health", response_model=ApiResponse[HealthOut], summary="Liveness + DB check")
async def health(db: DbSession) -> ApiResponse[HealthOut]:
    try:
        async with asyncio.timeout(5):
            await db.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("Health check: database unavailable (%s)", type(exc).__name__)
        raise AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "Database unavailable",
            details={"database": "unavailable"},
        ) from exc
    return ok(HealthOut(status="ok", database="ok"))


@router.get("/meta", response_model=ApiResponse[MetaOut], summary="Server capabilities")
async def meta() -> ApiResponse[MetaOut]:
    settings = get_settings()
    return ok(
        MetaOut(
            version=VERSION,
            ai_enabled=settings.ai_enabled,
            max_files=settings.max_files,
            github_authenticated=bool(settings.github_token),
        )
    )


@router.get(
    "/github/rate-limit",
    response_model=ApiResponse[RateLimitOut],
    summary="Remaining GitHub API quota for the server token",
)
async def github_rate_limit(gh: GitHub) -> ApiResponse[RateLimitOut]:
    rl = await gh.get_rate_limit()
    return ok(
        RateLimitOut(
            limit=rl.limit,
            remaining=rl.remaining,
            reset_at=rl.reset_at,
            authenticated=rl.authenticated,
        )
    )
