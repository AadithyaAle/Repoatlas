import io
import tarfile
from collections.abc import AsyncIterator, Awaitable, Iterator
from datetime import UTC, datetime

import httpx
import pytest
import respx

from app.core.errors import AppError, ErrorCode
from app.services.github_service import GitHubClient

API = "https://api.github.com"
REPO = f"{API}/repos/octo/repo"
CANON = f"{API}/repos/Octo/Repo"
SHA = "a" * 40
TARBALL = f"{CANON}/tarball/{SHA}"
RESET = 1_700_000_000
REPO_JSON = {
    "owner": {"login": "Octo"},
    "name": "Repo",
    "default_branch": "main",
    "description": "demo",
    "stargazers_count": 42,
    "private": False,
}
RL_HEADERS = {
    "x-ratelimit-limit": "60",
    "x-ratelimit-remaining": "59",
    "x-ratelimit-reset": str(RESET),
}


@pytest.fixture
def sleeps() -> list[float]:
    return []


@pytest.fixture
async def gh(sleeps: list[float]) -> AsyncIterator[GitHubClient]:
    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    client = GitHubClient(None, API, sleep=fake_sleep)
    yield client
    await client.aclose()


@pytest.fixture
def mock() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False) as router:
        yield router


def tarball(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(f"Octo-Repo-aaaaaaa/{name}")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


async def expect_error(coro: Awaitable[object], code: ErrorCode) -> AppError:
    with pytest.raises(AppError) as exc:
        await coro
    assert exc.value.code == code, exc.value.message
    return exc.value


def download(gh: GitHubClient, max_tarball_bytes: int = 1_000_000) -> Awaitable[object]:
    limits = {"max_files": 10, "max_file_bytes": 1000, "max_tarball_bytes": max_tarball_bytes}
    return gh.download_snapshot("Octo", "Repo", SHA, **limits)


async def test_resolve_ref_happy_path(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(REPO).respond(200, json=REPO_JSON, headers=RL_HEADERS)
    commits = mock.get(f"{CANON}/commits/main").respond(200, json={"sha": SHA})
    ref = await gh.resolve_ref("octo", "repo", None)
    assert (ref.owner, ref.name, ref.branch) == ("Octo", "Repo", "main")
    assert ref.default_branch == "main"
    assert (ref.commit_sha, ref.description, ref.stars) == (SHA, "demo", 42)
    assert commits.called
    rl = gh.last_rate_limit
    assert rl is not None and rl.remaining == 59 and rl.limit == 60 and not rl.authenticated
    assert rl.reset_at == datetime.fromtimestamp(RESET, UTC)
    request = mock.calls[0].request
    assert request.headers["Accept"] == "application/vnd.github+json"
    assert request.headers["X-GitHub-Api-Version"] == "2022-11-28"
    assert request.headers["User-Agent"] == "RepoAtlas"
    assert "Authorization" not in request.headers


async def test_explicit_branch_with_slash(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(REPO).respond(200, json=REPO_JSON)
    mock.get(f"{CANON}/commits/feature/x").respond(200, json={"sha": SHA})
    ref = await gh.resolve_ref("octo", "repo", "feature/x")
    assert ref.branch == "feature/x" and ref.default_branch == "main"


async def test_token_sent_as_bearer_and_rate_limit(mock: respx.MockRouter) -> None:
    route = mock.get(f"{API}/rate_limit").respond(
        200, json={"resources": {"core": {"limit": 5000, "remaining": 4999, "reset": RESET}}}
    )
    client = GitHubClient("tkn", API)
    try:
        rl = await client.get_rate_limit()
    finally:
        await client.aclose()
    assert route.calls[0].request.headers["Authorization"] == "Bearer tkn"
    assert (rl.limit, rl.remaining, rl.authenticated) == (5000, 4999, True)
    assert rl.reset_at == datetime.fromtimestamp(RESET, UTC)


async def test_private_repo_is_not_found(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(REPO).respond(200, json={**REPO_JSON, "private": True})
    await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.GITHUB_REPO_NOT_FOUND)


async def test_404_maps_to_repo_not_found(gh: GitHubClient, mock: respx.MockRouter) -> None:
    route = mock.get(REPO).respond(404, json={"message": "Not Found"})
    err = await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.GITHUB_REPO_NOT_FOUND)
    assert err.message == "Repository octo/repo not found or is private"
    assert route.call_count == 1


async def test_rate_limited_403(
    gh: GitHubClient, mock: respx.MockRouter, sleeps: list[float]
) -> None:
    route = mock.get(REPO).respond(
        403,
        json={"message": "API rate limit exceeded for 1.2.3.4."},
        headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(RESET)},
    )
    err = await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.GITHUB_RATE_LIMITED)
    assert err.details == {
        "reset_at": datetime.fromtimestamp(RESET, UTC).isoformat(),
        "authenticated": False,
    }
    assert route.call_count == 1 and sleeps == []  # 4xx is never retried
    assert gh.last_rate_limit is not None and gh.last_rate_limit.remaining == 0


async def test_plain_403_is_unavailable(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(REPO).respond(403, json={"message": "Resource not accessible"})
    await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.GITHUB_UNAVAILABLE)


async def test_5xx_and_timeout_retried_then_success(
    gh: GitHubClient, mock: respx.MockRouter, sleeps: list[float]
) -> None:
    route = mock.get(REPO)
    route.side_effect = [
        httpx.Response(502),
        httpx.ConnectTimeout("slow"),
        httpx.Response(200, json=REPO_JSON),
    ]
    mock.get(f"{CANON}/commits/main").respond(200, json={"sha": SHA})
    ref = await gh.resolve_ref("octo", "repo", None)
    assert ref.commit_sha == SHA
    assert route.call_count == 3
    assert sleeps == [0.5, 1.0]


async def test_5xx_exhausted(gh: GitHubClient, mock: respx.MockRouter, sleeps: list[float]) -> None:
    route = mock.get(REPO).respond(503)
    await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.GITHUB_UNAVAILABLE)
    assert route.call_count == 3
    assert sleeps == [0.5, 1.0]


async def test_timeouts_exhausted(gh: GitHubClient, mock: respx.MockRouter) -> None:
    route = mock.get(REPO).mock(side_effect=httpx.ReadTimeout)
    await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.GITHUB_UNAVAILABLE)
    assert route.call_count == 3


async def test_branch_not_found_422(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(REPO).respond(200, json=REPO_JSON)
    mock.get(f"{CANON}/commits/nope").respond(
        422, json={"message": "No commit found for SHA: nope"}
    )
    err = await expect_error(gh.resolve_ref("octo", "repo", "nope"), ErrorCode.NOT_FOUND)
    assert err.message == "Branch 'nope' not found"


async def test_empty_repo_409(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(REPO).respond(200, json=REPO_JSON)
    mock.get(f"{CANON}/commits/main").respond(409, json={"message": "Git Repository is empty."})
    await expect_error(gh.resolve_ref("octo", "repo", None), ErrorCode.NO_SOURCE_FILES)


async def test_download_snapshot_follows_redirect(gh: GitHubClient, mock: respx.MockRouter) -> None:
    codeload = f"https://codeload.github.com/Octo/Repo/legacy.tar.gz/{SHA}"
    mock.get(TARBALL).respond(302, headers={"location": codeload})
    body = tarball({"src/a.py": b"x = 1\n", "tsconfig.json": b"{}", "img.png": b"\x89PNG"})
    mock.get(codeload).respond(200, content=body)
    snap = await gh.download_snapshot(
        "Octo", "Repo", SHA, max_files=10, max_file_bytes=1000, max_tarball_bytes=1_000_000
    )
    assert snap.sources == {"src/a.py": "x = 1\n"}
    assert snap.config_files == {"tsconfig.json": "{}"}
    assert not snap.truncated and snap.total_source_files == 1


async def test_tarball_404(gh: GitHubClient, mock: respx.MockRouter) -> None:
    mock.get(TARBALL).respond(404, json={"message": "Not Found"})
    await expect_error(download(gh), ErrorCode.GITHUB_REPO_NOT_FOUND)


async def test_tarball_too_large_by_content_length(
    gh: GitHubClient, mock: respx.MockRouter
) -> None:
    mock.get(TARBALL).respond(200, content=b"x" * 2000)
    await expect_error(download(gh, max_tarball_bytes=1000), ErrorCode.REPO_TOO_LARGE)


async def test_tarball_too_large_while_streaming(gh: GitHubClient, mock: respx.MockRouter) -> None:
    async def body() -> AsyncIterator[bytes]:
        for _ in range(10):
            yield b"x" * 500

    mock.get(TARBALL).mock(side_effect=lambda request: httpx.Response(200, content=body()))
    await expect_error(download(gh, max_tarball_bytes=1000), ErrorCode.REPO_TOO_LARGE)
