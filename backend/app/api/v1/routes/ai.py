from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import AuthUser, DbSession
from app.schemas.atlas import AIStepDraftOut, AIStepDraftRequest
from app.schemas.common import ApiResponse, ok
from app.services import ai_service

router = APIRouter(prefix="/ai", tags=["ai"])

AI = Annotated[ai_service.AIClient, Depends(ai_service.get_ai_client)]


@router.post(
    "/step-draft",
    response_model=ApiResponse[AIStepDraftOut],
    summary="Optional: draft a tour step grounded in AST context (503 AI_DISABLED without key)",
)
async def draft_step(
    body: AIStepDraftRequest, db: DbSession, user: AuthUser, client: AI
) -> ApiResponse[AIStepDraftOut]:
    return ok(await ai_service.draft_step(db, body, user, client))
