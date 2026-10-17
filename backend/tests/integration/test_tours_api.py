import uuid
from collections.abc import Callable

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Analysis, AnalysisStatus
from app.engine.drift_detector import snippet_hash
from tests.integration.factories import (
    OWNER_ID,
    SHA_A,
    TRAINEE_ID,
    api_create_step,
    api_create_tour,
    make_analysis,
    make_repository,
)

Headers = dict[str, str]
MAIN = "import os\n\n\ndef main():\n    print('hi')\n    return 0\n"  # 6 lines
FILES = {"app/main.py": MAIN, "app/util.py": "def helper(x):\n    return x + 1\n"}
CHECKPOINT = {
    "question": "What does main return?",
    "options": ["None", "0", "1"],
    "correct_index": 1,
    "explanation": "It returns 0 on success.",
}


@pytest.fixture
async def analysis(db_session: AsyncSession) -> Analysis:
    repo = await make_repository(db_session)
    return await make_analysis(db_session, repo, FILES)


@pytest.fixture
def owner(auth_headers: Callable[..., Headers]) -> Headers:
    return auth_headers(OWNER_ID, "owner")


@pytest.fixture
def trainee(auth_headers: Callable[..., Headers]) -> Headers:
    return auth_headers(TRAINEE_ID, "trainee")


async def test_auth_required(client: httpx.AsyncClient, analysis: Analysis) -> None:
    res = await client.post(
        "/api/v1/tours", json={"analysis_id": str(analysis.id), "title": "Nope tour"}
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"
    res = await client.get("/api/v1/tours", params={"mine": "true"})
    assert res.status_code == 401


async def test_create_and_get_tour(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    assert tour["base_commit_sha"] == SHA_A
    assert tour["analysis_id"] == str(analysis.id)
    assert tour["owner_user_id"] == str(OWNER_ID)
    assert tour["owner_login"] == "owner"
    assert tour["repository"]["owner"] == "octo"
    assert tour["step_count"] == 0 and tour["steps"] == []
    assert set(tour["health"].values()) == {0}
    assert tour["is_owner"] is True

    anon = await client.get(f"/api/v1/tours/{tour['id']}")
    assert anon.status_code == 200
    assert anon.json()["data"]["is_owner"] is False


async def test_create_tour_requires_completed_analysis(
    client: httpx.AsyncClient, db_session: AsyncSession, owner: Headers
) -> None:
    repo = await make_repository(db_session)
    pending = await make_analysis(db_session, repo, FILES, status=AnalysisStatus.PARSING_AST)
    res = await client.post(
        "/api/v1/tours", json={"analysis_id": str(pending.id), "title": "Too early"}, headers=owner
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "ANALYSIS_NOT_READY"
    missing = await client.post(
        "/api/v1/tours", json={"analysis_id": str(uuid.uuid4()), "title": "Ghost"}, headers=owner
    )
    assert missing.status_code == 404


async def test_private_tour_is_invisible_to_others(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers, trainee: Headers
) -> None:
    private = await api_create_tour(client, owner, analysis.id, visibility="PRIVATE")
    public = await api_create_tour(client, owner, analysis.id, title="Public tour")
    url = f"/api/v1/tours/{private['id']}"

    assert (await client.get(url, headers=trainee)).status_code == 404
    assert (await client.get(url)).status_code == 404
    assert (await client.get(url, headers=owner)).status_code == 200
    # Hidden even for mutations (404, not 403).
    patch = await client.patch(url, json={"title": "Hijacked"}, headers=trainee)
    assert patch.status_code == 404

    def ids(res: httpx.Response) -> set[str]:
        return {t["id"] for t in res.json()["data"]}

    assert ids(await client.get("/api/v1/tours", headers=trainee)) == {public["id"]}
    assert ids(await client.get("/api/v1/tours")) == {public["id"]}
    assert ids(await client.get("/api/v1/tours", headers=owner)) == {public["id"], private["id"]}
    mine = await client.get("/api/v1/tours", params={"mine": "true"}, headers=trainee)
    assert mine.json()["data"] == []


async def test_non_owner_mutations_are_forbidden(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers, trainee: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    step = await api_create_step(client, owner, tour["id"], "app/main.py", 4, 5)
    base = f"/api/v1/tours/{tour['id']}"
    step_body = {"title": "x", "file_path": "app/main.py", "start_line": 1, "end_line": 1}
    calls: list[tuple[str, str, object]] = [
        ("PATCH", base, {"title": "Hijacked"}),
        ("DELETE", base, None),
        ("POST", f"{base}/steps", step_body),
        ("PATCH", f"{base}/steps/{step['id']}", {"title": "x"}),
        ("DELETE", f"{base}/steps/{step['id']}", None),
        ("PUT", f"{base}/steps/order", {"step_ids": [step["id"]]}),
        ("POST", f"{base}/sync", None),
        ("POST", f"{base}/steps/{step['id']}/resolve", {"action": "keep_original"}),
    ]
    for method, url, payload in calls:
        res = await client.request(method, url, json=payload, headers=trainee)
        assert res.status_code == 403, (method, url, res.text)
        assert res.json()["error"]["code"] == "FORBIDDEN"


async def test_step_creation_computes_snapshot_and_hash(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    step = await api_create_step(client, owner, tour["id"], "app/main.py", 4, 5)
    expected = "def main():\n    print('hi')"
    assert step["snippet_snapshot"] == expected
    assert step["snippet_hash"] == snippet_hash(expected)
    assert step["drift_status"] == "HEALTHY"
    assert (step["start_line"], step["end_line"], step["position"]) == (4, 5, 0)

    listed = await client.get("/api/v1/tours", params={"repository_id": tour["repository"]["id"]})
    summary = listed.json()["data"][0]
    assert summary["step_count"] == 1 and summary["health"]["HEALTHY"] == 1
    other_repo = await client.get("/api/v1/tours", params={"repository_id": str(uuid.uuid4())})
    assert other_repo.json()["data"] == []


async def test_invalid_line_ranges(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    url = f"/api/v1/tours/{tour['id']}/steps"

    def body(path: str, start: int, end: int) -> dict[str, object]:
        return {"title": "Bad", "file_path": path, "start_line": start, "end_line": end}

    res = await client.post(url, json=body("app/main.py", 5, 7), headers=owner)
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "INVALID_LINE_RANGE" and err["details"]["loc"] == 6

    res = await client.post(url, json=body("app/missing.py", 1, 1), headers=owner)
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "FILE_NOT_IN_SNAPSHOT"

    res = await client.post(url, json=body("app/main.py", 3, 2), headers=owner)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_insert_reorder_delete_keep_positions_compact(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    tid = tour["id"]
    a = await api_create_step(client, owner, tid, "app/main.py", 1, 1, title="A")
    b = await api_create_step(client, owner, tid, "app/main.py", 4, 6, title="B")
    c = await api_create_step(client, owner, tid, "app/util.py", 1, 2, title="C", position=0)

    async def titles() -> list[tuple[str, int]]:
        data = (await client.get(f"/api/v1/tours/{tid}", headers=owner)).json()["data"]
        return [(s["title"], s["position"]) for s in data["steps"]]

    assert await titles() == [("C", 0), ("A", 1), ("B", 2)]

    order_url = f"/api/v1/tours/{tid}/steps/order"
    res = await client.put(order_url, json={"step_ids": [b["id"], c["id"], a["id"]]}, headers=owner)
    assert res.status_code == 200
    assert [s["title"] for s in res.json()["data"]] == ["B", "C", "A"]
    assert await titles() == [("B", 0), ("C", 1), ("A", 2)]

    for bad in ([b["id"], c["id"]], [b["id"], c["id"], a["id"], a["id"]], [str(uuid.uuid4())]):
        res = await client.put(order_url, json={"step_ids": bad}, headers=owner)
        assert res.status_code == 422
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"

    res = await client.delete(f"/api/v1/tours/{tid}/steps/{c['id']}", headers=owner)
    assert res.status_code == 200
    assert res.json()["data"] == {"id": c["id"], "deleted": True}
    assert await titles() == [("B", 0), ("A", 1)]

    # A step id only resolves through its own tour.
    other = await api_create_tour(client, owner, analysis.id, title="Other tour")
    res = await client.patch(
        f"/api/v1/tours/{other['id']}/steps/{a['id']}", json={"title": "x"}, headers=owner
    )
    assert res.status_code == 404


async def test_checkpoint_answer_hidden_from_trainee(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers, trainee: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    step = await api_create_step(
        client, owner, tour["id"], "app/main.py", 4, 6, checkpoint=CHECKPOINT
    )
    assert step["checkpoint"]["correct_index"] == 1

    as_trainee = await client.get(f"/api/v1/tours/{tour['id']}", headers=trainee)
    assert as_trainee.json()["data"]["steps"][0]["checkpoint"] == {
        "question": CHECKPOINT["question"],
        "options": CHECKPOINT["options"],
    }
    assert "correct_index" not in as_trainee.text
    assert "It returns 0" not in as_trainee.text
    anonymous = await client.get(f"/api/v1/tours/{tour['id']}")
    assert "correct_index" not in anonymous.text

    as_owner = await client.get(f"/api/v1/tours/{tour['id']}", headers=owner)
    checkpoint = as_owner.json()["data"]["steps"][0]["checkpoint"]
    assert checkpoint["correct_index"] == 1
    assert checkpoint["explanation"] == CHECKPOINT["explanation"]


async def test_update_step_and_tour_then_delete(
    client: httpx.AsyncClient, analysis: Analysis, owner: Headers
) -> None:
    tour = await api_create_tour(client, owner, analysis.id)
    tid = tour["id"]
    step = await api_create_step(client, owner, tid, "app/main.py", 4, 6, checkpoint=CHECKPOINT)

    res = await client.patch(
        f"/api/v1/tours/{tid}/steps/{step['id']}",
        json={"title": "Renamed", "body_markdown": "**new**", "remove_checkpoint": True},
        headers=owner,
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["title"] == "Renamed" and data["body_markdown"] == "**new**"
    assert data["checkpoint"] is None

    res = await client.patch(
        f"/api/v1/tours/{tid}",
        json={"title": "Renamed tour", "description": "Desc", "visibility": "PRIVATE"},
        headers=owner,
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["title"], data["description"], data["visibility"]) == (
        "Renamed tour",
        "Desc",
        "PRIVATE",
    )

    res = await client.delete(f"/api/v1/tours/{tid}", headers=owner)
    assert res.status_code == 200
    assert res.json()["data"] == {"id": tid, "deleted": True}
    assert (await client.get(f"/api/v1/tours/{tid}", headers=owner)).status_code == 404
