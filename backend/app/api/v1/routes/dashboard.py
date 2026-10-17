from fastapi import APIRouter

from app.api.deps import AuthUser, DbSession
from app.schemas.atlas import DashboardOut
from app.schemas.common import ApiResponse, ok
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "",
    response_model=ApiResponse[DashboardOut],
    summary="Repo analytics, tour health and trainee progress for the caller",
)
async def get_dashboard(db: DbSession, user: AuthUser) -> ApiResponse[DashboardOut]:
    return ok(await dashboard_service.get_dashboard(db, user))
