import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.handlers import (
    REQUEST_ID_HEADER,
    RequestContextMiddleware,
    configure_logging,
    register_exception_handlers,
)
from app.core.version import VERSION

__all__ = ["VERSION", "app", "create_app"]

logger = logging.getLogger("app")

TAGS_METADATA = [
    {"name": "meta", "description": "Health, server capabilities and GitHub quota."},
    {
        "name": "repositories",
        "description": "Queue analyses of public GitHub repositories and browse analyzed repos.",
    },
    {
        "name": "analyses",
        "description": "Analysis status, dependency graph, file contents and blast-radius "
        "simulation for a pinned commit.",
    },
    {
        "name": "tours",
        "description": "Onboarding tours: steps anchored to code, checkpoints, progress and "
        "self-healing drift sync.",
    },
    {"name": "dashboard", "description": "Analytics for the signed-in user's repos and tours."},
    {"name": "ai", "description": "Optional LLM-assisted authoring (requires GEMINI_API_KEY)."},
]


async def _close_github_client() -> None:
    from app.services.github_service import get_github_client

    if get_github_client.cache_info().currsize == 0:
        return  # never created in this process
    try:
        await get_github_client().aclose()
    except Exception:
        logger.warning("Failed to close GitHub client", exc_info=True)
    get_github_client.cache_clear()


async def _dispose_engine() -> None:
    from app.db.session import get_engine

    if get_engine.cache_info().currsize:
        await get_engine().dispose()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    worker: tuple[asyncio.Task[None], asyncio.Event] | None = None
    if settings.worker_mode == "embedded":
        # Lazy import: only the API process running the embedded worker pays for it.
        from app.workers.analysis_worker import start_embedded_worker

        worker = start_embedded_worker()
        logger.info("Embedded analysis worker started")
    try:
        yield
    finally:
        if worker is not None:
            from app.workers.analysis_worker import stop_embedded_worker

            await stop_embedded_worker(*worker)
            logger.info("Embedded analysis worker stopped")
        await _close_github_client()
        await _dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json_format=settings.environment == "production")
    app = FastAPI(
        title="RepoAtlas API",
        version=VERSION,
        description=(
            "AST dependency graphs, blast-radius simulation and self-healing onboarding tours "
            "for GitHub repositories. Every endpoint returns the envelope "
            "`{success, data, error}`."
        ),
        contact={
            "name": "RepoAtlas maintainers",
            "url": "https://github.com/AadithyaAle/repoatlas",
        },
        license_info={"name": "MIT", "identifier": "MIT"},
        servers=[{"url": "/", "description": "Current host"}],
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
    )
    register_exception_handlers(app)
    # Order: last added = outermost. Request context wraps everything so all responses
    # (including CORS preflights and compressed bodies) carry X-Request-ID.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Any localhost port in development (dev servers, browser previews); never in production.
        allow_origin_regex=(
            r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
            if settings.environment == "development"
            else None
        ),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestContextMiddleware)
    app.include_router(api_router)
    return app


app = create_app()
