"""Supabase JWT verification.

The frontend sends `Authorization: Bearer <supabase access token>`. We verify it with the
project's JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, asymmetric keys, cached) or the
legacy HS256 `SUPABASE_JWT_SECRET`, check `aud`/`exp`, and expose the caller as `CurrentUser`.
Tokens are never logged.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

_ASYMMETRIC_ALGS = frozenset({"RS256", "ES256"})
_LEEWAY_SECONDS = 10
# Only declares the bearer scheme in OpenAPI; the header is parsed and validated below.
_bearer_scheme = HTTPBearer(auto_error=False, description="Supabase access token")


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: uuid.UUID  # JWT sub
    email: str | None
    login: str | None  # GitHub username from user_metadata.user_name / preferred_username
    avatar_url: str | None


@lru_cache(maxsize=4)
def get_jwks_client(supabase_url: str) -> jwt.PyJWKClient:
    """One cached JWKS client per Supabase project (keys cached 10 min)."""
    url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=600)


def _unauthorized(message: str) -> AppError:
    return AppError(ErrorCode.UNAUTHORIZED, message)


def _extract_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header is None:
        return None
    scheme, _, token = header.strip().partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token or " " in token:
        raise _unauthorized("Authorization header must be 'Bearer <token>'")
    return token


async def _signing_key(token: str, alg: str) -> Any:
    settings = get_settings()
    if alg == "HS256" and settings.supabase_jwt_secret:
        return settings.supabase_jwt_secret
    if alg in _ASYMMETRIC_ALGS and settings.supabase_url:
        client = get_jwks_client(settings.supabase_url)
        try:
            # PyJWKClient does blocking HTTP; keep it off the event loop.
            signing_key = await asyncio.to_thread(client.get_signing_key_from_jwt, token)
        except jwt.PyJWKClientConnectionError as exc:
            logger.warning("JWKS fetch failed: %s", type(exc).__name__)
            raise AppError(
                ErrorCode.SERVICE_UNAVAILABLE, "Authentication service unavailable"
            ) from exc
        except (jwt.PyJWKClientError, jwt.InvalidTokenError) as exc:
            raise _unauthorized("Token signing key not recognized") from exc
        return signing_key.key
    raise _unauthorized(f"Unsupported token algorithm '{alg}'")


def _decode(token: str, key: Any, alg: str) -> dict[str, Any]:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience=get_settings().supabase_jwt_audience,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "sub", "aud"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("Token has expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise _unauthorized("Token audience is invalid") from exc
    except jwt.InvalidSignatureError as exc:
        raise _unauthorized("Token signature is invalid") from exc
    except jwt.MissingRequiredClaimError as exc:
        raise _unauthorized(f"Token is missing the '{exc.claim}' claim") from exc
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Token is invalid") from exc
    return claims


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _to_user(claims: dict[str, Any]) -> CurrentUser:
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError as exc:
        raise _unauthorized("Token subject is not a valid user id") from exc
    meta = claims.get("user_metadata")
    meta = meta if isinstance(meta, dict) else {}
    return CurrentUser(
        id=user_id,
        email=_str_or_none(claims.get("email")),
        login=_str_or_none(meta.get("user_name")) or _str_or_none(meta.get("preferred_username")),
        avatar_url=_str_or_none(meta.get("avatar_url")),
    )


async def authenticate(request: Request) -> CurrentUser | None:
    """Verify the bearer token on `request`; None when no Authorization header is present."""
    token = _extract_token(request)
    if token is None:
        return None
    try:
        alg = str(jwt.get_unverified_header(token).get("alg", ""))
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Token is malformed") from exc
    key = await _signing_key(token, alg)
    return _to_user(_decode(token, key, alg))


async def get_optional_user(
    request: Request,
    _credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser | None:
    """None when no Authorization header; raises AppError(UNAUTHORIZED) when a token is invalid."""
    return await authenticate(request)


async def get_current_user(
    user: CurrentUser | None = Depends(get_optional_user),
) -> CurrentUser:
    """Raises AppError(UNAUTHORIZED) when missing/invalid."""
    if user is None:
        raise _unauthorized("Authentication required")
    return user
