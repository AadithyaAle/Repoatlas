"""Shared fixtures.

Unit tests (tests/unit) are pure. Integration tests (tests/integration) use a real Postgres:
`docker compose up -d db` (test DB `repoatlas_test` on localhost:5433).
"""

import os
import time
import uuid
from collections.abc import AsyncIterator, Callable

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://atlas:atlas@localhost:5433/repoatlas_test"
)
os.environ["WORKER_MODE"] = "off"
os.environ["SUPABASE_JWT_SECRET"] = "test-secret-for-hs256-signing-only-000000"
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("GITHUB_TOKEN", None)
os.environ.pop("GEMINI_API_KEY", None)

import httpx
import jwt
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models  # noqa: F401  (register tables)
from app.db.base import Base
from app.db.session import get_engine, get_sessionmaker

TEST_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]


@pytest.fixture(scope="session")
async def _schema() -> AsyncIterator[None]:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture
async def db_session(_schema: None) -> AsyncIterator[AsyncSession]:
    """Fresh session; all tables truncated after each test."""
    async with get_sessionmaker()() as session:
        yield session
    async with get_engine().begin() as conn:
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[httpx.AsyncClient]:
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def make_token(
    user_id: uuid.UUID | None = None, login: str = "octocat", expires_in: int = 3600
) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id or uuid.uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "email": f"{login}@example.com",
        "iat": now,
        "exp": now + expires_in,
        "user_metadata": {"user_name": login, "avatar_url": None},
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


@pytest.fixture
def auth_headers() -> Callable[..., dict[str, str]]:
    """`auth_headers(user_id, login="alice")` -> {"Authorization": "Bearer ..."}"""

    def _make(user_id: uuid.UUID | None = None, login: str = "octocat") -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(user_id, login)}"}

    return _make
