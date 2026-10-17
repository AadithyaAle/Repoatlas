import pytest

from app.core.config import Settings

EXPECTED = ["https://repoatlas.vercel.app", "http://localhost:3000"]


@pytest.mark.parametrize(
    "raw",
    [
        '["https://repoatlas.vercel.app", "http://localhost:3000"]',
        "https://repoatlas.vercel.app,http://localhost:3000",
        " https://repoatlas.vercel.app/ , http://localhost:3000 ,",
        "'https://repoatlas.vercel.app','http://localhost:3000'",
    ],
)
def test_cors_origins_accepts_json_or_comma_separated(
    raw: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert Settings().cors_origins == EXPECTED


def test_cors_origins_single_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://repoatlas.vercel.app")
    assert Settings().cors_origins == ["https://repoatlas.vercel.app"]


def test_database_url_gets_asyncpg_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p%40ss@host:6543/postgres")
    assert Settings().database_url.get_secret_value() == (
        "postgresql+asyncpg://u:p%40ss@host:6543/postgres"
    )
