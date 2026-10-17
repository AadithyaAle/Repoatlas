from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Analysis, TourSyncRun
from app.engine.drift_detector import snippet_hash
from app.services.github_service import get_github_client
from tests.integration.factories import (
    OWNER_ID,
    SHA_A,
    SHA_B,
    TRAINEE_ID,
    FakeGitHub,
    api_create_step,
    api_create_tour,
    make_analysis,
    make_repository,
)

Headers = dict[str, str]

HEALTHY = "import os\n\n\ndef healthy():\n    return os.getcwd()\n"
MOVED = "def moved(a, b):\n    total = a + b\n    return total * 2\n"
CHANGED = "def changed(x):\n    y = x * 10\n    z = y + 3\n    return z\n"
OLD_FILES = {
    "app/healthy.py": HEALTHY,
    "app/moved.py": MOVED,
    "app/changed.py": CHANGED,
    "app/deleted.py": "def gone():\n    return 1\n",
}
NEW_FILES = {
    "app/healthy.py": HEALTHY,
    "app/moved.py": "import sys\nimport json\n\n\n" + MOVED,  # block now at lines 5-7
    "app/changed.py": CHANGED.replace("x * 10", "x * 11"),
    # app/deleted.py removed
}


@pytest.fixture
def owner(auth_headers: Callable[..., Headers]) -> Headers:
    return auth_headers(OWNER_ID, "owner")


@pytest.fixture
async def fake_github() -> AsyncIterator[FakeGitHub]:
    from app.main import app

    fake = FakeGitHub(SHA_B)
    app.dependency_overrides[get_github_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_github_client, None)


@pytest.fixture
async def analyses(db_session: AsyncSession) -> tuple[Analysis, Analysis]:
    repo = await make_repository(db_session)
    old = await make_analysis(db_session, repo, OLD_FILES, commit_sha=SHA_A)
    new = await make_analysis(db_session, repo, NEW_FILES, commit_sha=SHA_B)
    return old, new


async def _tour_with_steps(
    client: httpx.AsyncClient, owner: Headers, analysis: Analysis
) -> tuple[str, dict[str, dict[str, Any]]]:
    tour = await api_create_tour(client, owner, analysis.id)
    tid = tour["id"]
    steps = {
        "healthy": await api_create_step(client, owner, tid, "app/healthy.py", 4, 5),
        "moved": await api_create_step(client, owner, tid, "app/moved.py", 1, 3),
        "changed": await api_create_step(client, owner, tid, "app/changed.py", 1, 4),
        "deleted": await api_create_step(client, owner, tid, "app/deleted.py", 1, 2),
    }
    return tid, steps


async def _sync(client: httpx.AsyncClient, owner: Headers, tid: str) -> dict[str, Any]:
    res = await client.post(f"/api/v1/tours/{tid}/sync", headers=owner)
    assert res.status_code == 200, res.text
    data: dict[str, Any] = res.json()["data"]
    return data


async def _steps(client: httpx.AsyncClient, owner: Headers, tid: str) -> dict[str, dict[str, Any]]:
    data = (await client.get(f"/api/v1/tours/{tid}", headers=owner)).json()["data"]
    return {s["file_path"].removeprefix("app/").removesuffix(".py"): s for s in data["steps"]}


async def test_sync_classifies_every_step(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    owner: Headers,
    analyses: tuple[Analysis, Analysis],
    fake_github: FakeGitHub,
) -> None:
    old, new = analyses
    tid, created = await _tour_with_steps(client, owner, old)

    report = await _sync(client, owner, tid)
    assert fake_github.resolved == [("octo", "demo", "main")]
    assert (report["from_commit_sha"], report["to_commit_sha"]) == (SHA_A, SHA_B)
    assert report["new_analysis_id"] == str(new.id)
    assert report["up_to_date"] is False
    assert report["counts"] == {
        "UNVERIFIED": 0,
        "HEALTHY": 1,
        "DRIFTED_AUTO_FIXED": 1,
        "OUTDATED_NEEDS_REVIEW": 1,
        "BROKEN_FILE_DELETED": 1,
    }
    by_path = {r["file_path"]: r for r in report["steps"]}
    assert all(r["previous_status"] == "HEALTHY" for r in report["steps"])
    moved = by_path["app/moved.py"]
    assert (moved["old_start_line"], moved["old_end_line"]) == (1, 3)
    assert (moved["new_start_line"], moved["new_end_line"]) == (5, 7)

    steps = await _steps(client, owner, tid)
    healthy = steps["healthy"]
    assert healthy["drift_status"] == "HEALTHY"
    assert (healthy["start_line"], healthy["end_line"]) == (4, 5)
    assert healthy["drift_diff"] is None and healthy["proposed_start_line"] is None

    moved_step = steps["moved"]
    assert moved_step["drift_status"] == "DRIFTED_AUTO_FIXED"
    assert (moved_step["start_line"], moved_step["end_line"]) == (5, 7)
    assert moved_step["snippet_hash"] == created["moved"]["snippet_hash"]
    assert moved_step["drift_similarity"] == 1.0

    changed = steps["changed"]
    assert changed["drift_status"] == "OUTDATED_NEEDS_REVIEW"
    assert (changed["start_line"], changed["end_line"]) == (1, 4)  # untouched until resolved
    assert changed["proposed_start_line"] is not None
    assert changed["proposed_end_line"] is not None
    assert "x * 11" in changed["proposed_snippet"]
    assert "-    y = x * 10" in changed["drift_diff"]
    assert "+    y = x * 11" in changed["drift_diff"]
    assert 0 < changed["drift_similarity"] < 1

    deleted = steps["deleted"]
    assert deleted["drift_status"] == "BROKEN_FILE_DELETED"
    assert (deleted["start_line"], deleted["end_line"]) == (1, 2)
    assert deleted["drift_diff"] is None and deleted["drift_similarity"] == 0.0

    tour = (await client.get(f"/api/v1/tours/{tid}", headers=owner)).json()["data"]
    assert tour["base_commit_sha"] == SHA_B
    assert tour["analysis_id"] == str(new.id)
    assert tour["last_synced_at"] is not None

    runs = (await db_session.scalars(select(TourSyncRun))).all()
    assert len(runs) == 1
    run = runs[0]
    assert (run.from_commit_sha, run.to_commit_sha, run.triggered_by_user_id) == (
        SHA_A,
        SHA_B,
        OWNER_ID,
    )
    assert run.counts["DRIFTED_AUTO_FIXED"] == 1 and run.counts["UNVERIFIED"] == 0


async def test_resync_same_commit_is_up_to_date(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    owner: Headers,
    analyses: tuple[Analysis, Analysis],
    fake_github: FakeGitHub,
) -> None:
    old, _ = analyses
    tid, _ = await _tour_with_steps(client, owner, old)
    await _sync(client, owner, tid)

    again = await _sync(client, owner, tid)
    assert again["up_to_date"] is True
    assert again["from_commit_sha"] == again["to_commit_sha"] == SHA_B
    statuses = {r["file_path"]: (r["previous_status"], r["status"]) for r in again["steps"]}
    assert statuses == {
        "app/healthy.py": ("HEALTHY", "HEALTHY"),
        "app/moved.py": ("DRIFTED_AUTO_FIXED", "HEALTHY"),  # healed lines now match
        "app/changed.py": ("OUTDATED_NEEDS_REVIEW", "OUTDATED_NEEDS_REVIEW"),
        "app/deleted.py": ("BROKEN_FILE_DELETED", "BROKEN_FILE_DELETED"),
    }
    assert len((await db_session.scalars(select(TourSyncRun))).all()) == 2


async def test_sync_requires_owner_and_auth(
    client: httpx.AsyncClient,
    owner: Headers,
    auth_headers: Callable[..., Headers],
    analyses: tuple[Analysis, Analysis],
    fake_github: FakeGitHub,
) -> None:
    old, _ = analyses
    tid, _ = await _tour_with_steps(client, owner, old)
    assert (await client.post(f"/api/v1/tours/{tid}/sync")).status_code == 401
    res = await client.post(f"/api/v1/tours/{tid}/sync", headers=auth_headers(TRAINEE_ID, "t"))
    assert res.status_code == 403
    assert fake_github.resolved == []


async def test_resolve_accept_proposed(
    client: httpx.AsyncClient,
    owner: Headers,
    analyses: tuple[Analysis, Analysis],
    fake_github: FakeGitHub,
) -> None:
    old, _ = analyses
    tid, created = await _tour_with_steps(client, owner, old)
    await _sync(client, owner, tid)
    changed = (await _steps(client, owner, tid))["changed"]
    url = f"/api/v1/tours/{tid}/steps/{changed['id']}/resolve"

    res = await client.post(url, json={"action": "accept_proposed"}, headers=owner)
    assert res.status_code == 200, res.text
    step = res.json()["data"]
    assert step["drift_status"] == "HEALTHY"
    assert (step["start_line"], step["end_line"]) == (
        changed["proposed_start_line"],
        changed["proposed_end_line"],
    )
    assert step["snippet_snapshot"] == changed["proposed_snippet"]
    assert step["snippet_hash"] == snippet_hash(step["snippet_snapshot"])
    assert step["proposed_start_line"] is None and step["drift_diff"] is None

    # Nothing left to resolve; healthy steps cannot accept/keep.
    again = await client.post(url, json={"action": "accept_proposed"}, headers=owner)
    assert again.status_code == 409
    healthy_url = f"/api/v1/tours/{tid}/steps/{created['healthy']['id']}/resolve"
    res = await client.post(healthy_url, json={"action": "keep_original"}, headers=owner)
    assert res.status_code == 409


async def test_resolve_keep_original_and_repin(
    client: httpx.AsyncClient,
    owner: Headers,
    analyses: tuple[Analysis, Analysis],
    fake_github: FakeGitHub,
) -> None:
    old, _ = analyses
    tid, created = await _tour_with_steps(client, owner, old)
    await _sync(client, owner, tid)

    def url(name: str) -> str:
        return f"/api/v1/tours/{tid}/steps/{created[name]['id']}/resolve"

    res = await client.post(url("changed"), json={"action": "keep_original"}, headers=owner)
    assert res.status_code == 200, res.text
    step = res.json()["data"]
    assert step["drift_status"] == "HEALTHY"
    assert (step["start_line"], step["end_line"]) == (1, 4)
    assert step["snippet_snapshot"] == NEW_FILES["app/changed.py"].rstrip("\n")
    assert step["snippet_hash"] == snippet_hash(step["snippet_snapshot"])
    assert step["snippet_hash"] != created["changed"]["snippet_hash"]

    # The deleted file cannot be kept, accepted (no proposal) or re-pinned.
    for action in ("keep_original", "accept_proposed"):
        res = await client.post(url("deleted"), json={"action": action}, headers=owner)
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "CONFLICT"
    repin = {"action": "repin", "start_line": 1, "end_line": 1}
    res = await client.post(url("deleted"), json=repin, headers=owner)
    assert res.status_code == 404

    # Repin works from any status, and validates the range against the current snapshot.
    res = await client.post(
        url("moved"), json={"action": "repin", "start_line": 1, "end_line": 6}, headers=owner
    )
    assert res.status_code == 200, res.text
    step = res.json()["data"]
    assert (step["start_line"], step["end_line"], step["drift_status"]) == (1, 6, "HEALTHY")
    assert step["snippet_snapshot"].startswith("import sys\nimport json")
    res = await client.post(
        url("moved"), json={"action": "repin", "start_line": 5, "end_line": 50}, headers=owner
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "INVALID_LINE_RANGE"
    res = await client.post(url("moved"), json={"action": "repin"}, headers=owner)
    assert res.status_code == 422
