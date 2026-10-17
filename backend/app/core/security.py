"""Supabase JWT verification.

The frontend sends `Authorization: Bearer <supabase access token>`. We verify it with the
project's JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, asymmetric keys, cached) or the
legacy HS256 `SUPABASE_JWT_SECRET`, check `aud`/`exp`, and expose the caller as `CurrentUser`.
"""

import uuid
from dataclasses import dataclass

from fastapi import Request


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: uuid.UUID  # JWT sub
    email: str | None
    login: str | None  # GitHub username from user_metadata.user_name / preferred_username
    avatar_url: str | None


async def get_optional_user(request: Request) -> CurrentUser | None:
    """None when no Authorization header; raises AppError(UNAUTHORIZED) when a token is invalid."""
    raise NotImplementedError


async def get_current_user(request: Request) -> CurrentUser:
    """Raises AppError(UNAUTHORIZED) when missing/invalid."""
    raise NotImplementedError
