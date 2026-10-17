from fastapi import APIRouter

from app.api.v1.routes import ai, analyses, dashboard, meta, repos, tours

api_router = APIRouter(prefix="/api/v1")
for module in (meta, repos, analyses, tours, dashboard, ai):
    api_router.include_router(module.router)
