from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings

VERSION = "0.1.0"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="RepoAtlas API",
        version=VERSION,
        description=(
            "AST dependency graphs, blast-radius simulation and self-healing onboarding tours "
            "for GitHub repositories."
        ),
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    # Exception handlers, lifespan (embedded worker), request-id logging: see app/core/handlers.py
    return app


app = create_app()
