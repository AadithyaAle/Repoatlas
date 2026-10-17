import uuid
from collections.abc import Iterator
from datetime import timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.db.base import utcnow
from app.db.models import Analysis, AnalysisStatus, Repository, Tour, TourVisibility
from app.services.github_service import GitHubClient, RepoRef, get_github_client

SHA = "a" * 40


class FakeGitHub(GitHubClient):
    """Duck-typed GitHubClient (no HTTP)."""

    def __init__(self, error: AppError | None = None) -> None:
        self.error = error
        self.calls = 0

    async def resolve_ref(self, owner: str, name: str, branch: str | None) -> RepoRef:
        self.calls += 1
        if self.error is not None:
            raise self.error
        return RepoRef(
            owner=owner,
            name=name,
            default_branch="main",
            branch=branch or "main",
            commit_sha=SHA,
            description="demo",
            stars=3,
        )


@pytest.fixture
def fake_gh() -> Iterator[FakeGitHub]:
    from app.main import app

    fake = FakeGitHub()
    app.dependency_overrides[get_github_client] = lambda: fake
    try:
        yield fake
    finally:
        app.dependency_overrides.pop(get_github_client, None)


async def seed_repo(
    db: AsyncSession,
    owner: str,
    name: str,
    *,
    analyses_ago: list[int],
    public_tours: int = 0,
    private_tours: int = 0,
) -> Repository:
    """Repository with one analysis per `analyses_ago` entry (minutes in the past)."""
    repo = Repository(owner=owner, name=name, default_branch="main")
    db.add(repo)
    await db.flush()
    now = utcnow()
    analyses = [
        Analysis(
            repository_id=repo.id,
            branch="main",
            commit_sha=uuid.uuid4().hex,
            status=AnalysisStatus.COMPLETED,
            created_at=now - timedelta(minutes=m),
        )
        for m in analyses_ago
    ]
    db.add_all(analyses)
    await db.flush()
    for i in range(public_tours + private_tours):
        db.add(
            Tour(
                repository_id=repo.id,
                analysis_id=analyses[0].id,
                owner_user_id=uuid.uuid4(),
                title=f"Tour {i}",
                visibility=TourVisibility.PUBLIC if i < public_tours else TourVisibility.PRIVATE,
                base_commit_sha=analyses[0].commit_sha,
            )
        )
    await db.commit()
    return repo


# ---------- POST /repos/analyze ----------


async def test_analyze_enqueues_and_dedupes(client: httpx.AsyncClient, fake_gh: FakeGitHub) -> None:
    body = {"repo_url": "https://github.com/octo/demo"}
    first = await client.post("/api/v1/repos/analyze", json=body)
    assert first.status_code == 202
    data = first.json()["data"]
    assert first.json()["success"] is True
    assert data["status"] == "PENDING" and data["commit_sha"] == SHA and data["branch"] == "main"
    assert data["repository"]["owner"] == "octo" and data["repository"]["name"] == "demo"
    assert data["repository"]["html_url"] == "https://github.com/octo/demo"

    second = await client.post("/api/v1/repos/analyze", json=body)
    assert second.status_code == 202
    assert second.json()["data"]["id"] == data["id"]
    assert fake_gh.calls == 2


async def test_analyze_branch_from_body(client: httpx.AsyncClient, fake_gh: FakeGitHub) -> None:
    res = await client.post(
        "/api/v1/repos/analyze", json={"repo_url": "octo/demo", "branch": "dev"}
    )
    assert res.status_code == 202
    assert res.json()["data"]["branch"] == "dev"


async def test_analyze_invalid_url(client: httpx.AsyncClient, fake_gh: FakeGitHub) -> None:
    res = await client.post("/api/v1/repos/analyze", json={"repo_url": "https://gitlab.com/a/b"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"
    assert fake_gh.calls == 0


async def test_analyze_rate_limited(client: httpx.AsyncClient, fake_gh: FakeGitHub) -> None:
    fake_gh.error = AppError(
        ErrorCode.GITHUB_RATE_LIMITED, "GitHub rate limit exceeded", details={"reset_at": None}
    )
    res = await client.post("/api/v1/repos/analyze", json={"repo_url": "octo/demo"})
    assert res.status_code == 429
    body = res.json()
    assert body["success"] is False and body["data"] is None
    assert body["error"]["code"] == "GITHUB_RATE_LIMITED"
    assert body["error"]["message"] == "GitHub rate limit exceeded"


# ---------- GET /repos ----------


async def test_list_empty(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/repos")
    assert res.status_code == 200
    assert res.json() == {"success": True, "data": [], "error": None}


async def test_list_orders_by_latest_analysis_and_counts_public_tours(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    old = await seed_repo(db_session, "acme", "old", analyses_ago=[60])
    new = await seed_repo(
        db_session, "acme", "new", analyses_ago=[30, 1], public_tours=2, private_tours=1
    )
    mid = await seed_repo(db_session, "other", "mid", analyses_ago=[10])

    res = await client.get("/api/v1/repos")
    assert res.status_code == 200
    data = res.json()["data"]
    assert [d["repository"]["id"] for d in data] == [str(new.id), str(mid.id), str(old.id)]
    assert [d["tour_count"] for d in data] == [2, 0, 0]
    latest = data[0]["latest_analysis"]
    assert latest is not None and latest["repository"]["id"] == str(new.id)

    limited = (await client.get("/api/v1/repos", params={"limit": 1})).json()["data"]
    assert [d["repository"]["name"] for d in limited] == ["new"]


async def test_list_latest_analysis_is_most_recent(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    repo = await seed_repo(db_session, "acme", "multi", analyses_ago=[30, 1, 15])
    newest = Analysis(
        repository_id=repo.id,
        branch="main",
        commit_sha="f" * 40,
        status=AnalysisStatus.PENDING,
        created_at=utcnow() + timedelta(minutes=1),
    )
    db_session.add(newest)
    await db_session.commit()
    data = (await client.get("/api/v1/repos")).json()["data"]
    assert len(data) == 1
    assert data[0]["latest_analysis"]["id"] == str(newest.id)
    assert data[0]["latest_analysis"]["status"] == "PENDING"


async def test_list_filter_q(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    await seed_repo(db_session, "Acme", "Widgets", analyses_ago=[2])
    await seed_repo(db_session, "acme", "gadgets", analyses_ago=[1])
    await seed_repo(db_session, "zeta", "under_score", analyses_ago=[3])

    async def names(q: str) -> list[str]:
        res = await client.get("/api/v1/repos", params={"q": q})
        assert res.status_code == 200
        repos = [d["repository"] for d in res.json()["data"]]
        return [f"{r['owner']}/{r['name']}" for r in repos]

    assert await names("ACME") == ["acme/gadgets", "Acme/Widgets"]
    assert await names("acme/wid") == ["Acme/Widgets"]
    assert await names("%") == []
    assert await names("_") == ["zeta/under_score"]
    assert await names("nope") == []


# ---------- GET /repos/{owner}/{name} ----------


async def test_get_repo_case_insensitive(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    repo = await seed_repo(db_session, "Octo", "Demo", analyses_ago=[5], public_tours=1)
    res = await client.get("/api/v1/repos/octo/DEMO")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["repository"]["id"] == str(repo.id)
    assert data["repository"]["owner"] == "Octo" and data["repository"]["name"] == "Demo"
    assert data["latest_analysis"]["status"] == "COMPLETED"
    assert data["tour_count"] == 1


async def test_get_repo_not_found(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/repos/nobody/nothing")
    assert res.status_code == 404
    assert res.json()["success"] is False
    assert res.json()["error"]["code"] == "NOT_FOUND"
