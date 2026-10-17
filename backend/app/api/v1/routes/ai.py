from fastapi import APIRouter

from app.api.deps import AuthUser, DbSession
from app.schemas.atlas import AIStepDraftOut, AIStepDraftRequest
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post(
    "/step-draft",
    response_model=ApiResponse[AIStepDraftOut],
    summary="Optional: draft a tour step grounded in AST context (503 AI_DISABLED without key)",
)
async def draft_step(
    body: AIStepDraftRequest, db: DbSession, user: AuthUser
) -> ApiResponse[AIStepDraftOut]:
    raise NotImplementedError
