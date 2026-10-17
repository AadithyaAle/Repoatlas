import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed, validated runtime configuration. Loaded from env vars / `.env`."""

    # Tests must never pick up a developer's local .env (real keys, real database).
    model_config = SettingsConfigDict(
        env_file=None if os.getenv("ENVIRONMENT") == "test" else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    database_url: SecretStr = Field(
        default=SecretStr("postgresql+asyncpg://atlas:atlas@localhost:5433/repoatlas"),
        description="SQLAlchemy async URL. Supabase: use the pooler connection string.",
    )

    cors_origins: list[str] = ["http://localhost:3000"]

    # GitHub: optional server token raises the rate limit from 60 to 5000 req/h.
    github_token: SecretStr | None = None
    github_api_url: str = "https://api.github.com"

    # Supabase auth: JWTs are verified via JWKS (asymmetric keys) or the legacy HS256 secret.
    supabase_url: str | None = None
    supabase_jwt_secret: SecretStr | None = None
    supabase_jwt_audience: str = "authenticated"

    # Ingestion limits
    max_files: int = 1500
    max_file_bytes: int = 300_000
    max_tarball_bytes: int = 80_000_000

    # Worker: "embedded" runs the DB-backed job loop inside the API process (free hosting),
    # "standalone" expects `python -m app.workers.analysis_worker` as a separate process,
    # "off" disables it (tests).
    worker_mode: Literal["embedded", "standalone", "off"] = "embedded"
    worker_poll_seconds: float = 2.0
    worker_stale_lock_seconds: int = 600

    # Optional LLM features
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-2.5-flash"

    @field_validator("database_url", mode="before")
    @classmethod
    def _asyncpg_scheme(cls, v: str) -> str:
        if isinstance(v, str) and v.startswith(("postgres://", "postgresql://")):
            return "postgresql+asyncpg://" + v.split("://", 1)[1]
        return v

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key.get_secret_value())


@lru_cache
def get_settings() -> Settings:
    return Settings()
