import uuid
from collections.abc import Callable
from datetime import timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.models import TourSyncRun
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
FILES = {
    "a.py": "import b\n\n\ndef run():\n    return b.value\n",
    "b.py": "value = 1\n",
    "c.py": "import b\n",
    "d.py": "import a\n",
}
EDGES = [("a.py", "b.py"), ("c.py", "b.py"), ("d.py", "a.py")]
CHECKPOINT = {"question": "What is imported?", "options": ["a", "b"], "correct_index": 1}


async def test_dashboard_requires_auth(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/dashboard")
    assert res.status_code == 401


async def test_dashboard_for_owner_and_trainee(
    client: httpx.AsyncClient, db_session: AsyncSession, auth_headers: Callable[..., Headers]
) -> None:
    owner, trainee = auth_headers(OWNER_ID, "owner"), auth_headers(TRAINEE_ID, "trainee")
    repo = await make_repository(db_session)
    analysis = await make_analysis(db_session, repo, FILES, edges=EDGES, requested_by=OWNER_ID)
    other_repo = await make_repository(db_session, name="unrelated")
    await make_analysis(db_session, other_repo, FILES, commit_sha="f" * 40)

    tour = await api_create_tour(client, owner, analysis.id)
    tid = tour["id"]
    s0 = await api_create_step(client, owner, tid, "a.py", 1, 1, checkpoint=CHECKPOINT)
    await api_create_step(client, owner, tid, "a.py", 4, 5)
    base = utcnow()
    for i in range(12):
        db_session.add(
            TourSyncRun(
                tour_id=uuid.UUID(tid),
                triggered_by_user_id=OWNER_ID,
                from_commit_sha=SHA_A,
                to_commit_sha=SHA_A,
                counts={"HEALTHY": i},
                created_at=base + timedelta(seconds=i),
            )
        )
    await db_session.commit()

    answer = f"/api/v1/tours/{tid}/steps/{s0['id']}/answer"
    for choice in (0, 1):  # wrong first, then right
        res = await client.post(answer, json={"selected_index": choice}, headers=trainee)
        assert res.status_code == 200, res.text

    # ----- owner -----
    res = await client.get("/api/v1/dashboard", headers=owner)
    assert res.status_code == 200, res.text
    data = res.json()["data"]

    assert len(data["repos"]) == 1
    repo_stats = data["repos"][0]
    assert repo_stats["repository"]["name"] == "demo"
    assert repo_stats["analysis_id"] == str(analysis.id)
    assert repo_stats["commit_sha"] == SHA_A
    assert (repo_stats["analyzed_files"], repo_stats["edge_count"]) == (4, 3)
    assert (repo_stats["god_modules"], repo_stats["entry_points"]) == (0, 2)
    assert repo_stats["role_breakdown"] == {
        "ENTRY_POINT": 2,
        "CORE_UTILITY": 0,
        "GOD_MODULE": 0,
        "LEAF": 1,
        "ISOLATED": 0,
        "STANDARD": 1,
    }
    assert repo_stats["language_breakdown"] == {"python": 4}
    riskiest = repo_stats["riskiest_files"]
    assert [r["target"] for r in riskiest][:2] == ["b.py", "a.py"]
    assert riskiest[0]["direct_dependents"] == ["a.py", "c.py"]
    assert riskiest[0]["transitive_dependents"] == ["d.py"]
    assert riskiest[0]["risk_level"] == "CRITICAL"
    assert riskiest[0]["total_files"] == 4

    assert len(data["tours"]) == 1
    health = data["tours"][0]
    assert health["tour"]["id"] == tid
    assert health["tour"]["step_count"] == 2
    assert health["health_score"] == 100.0
    history = health["sync_history"]
    assert len(history) == 10
    assert [h["counts"]["HEALTHY"] for h in history] == list(range(11, 1, -1))
    assert health["trainees"] == [
        {
            "user_id": str(TRAINEE_ID),
            "user_login": "trainee",
            "completed_steps": 1,
            "total_steps": 2,
            "first_try_accuracy": 0.0,
            "last_activity_at": health["trainees"][0]["last_activity_at"],
        }
    ]
    assert health["trainees"][0]["last_activity_at"] is not None
    assert data["learning"] == []

    # ----- trainee -----
    res = await client.get("/api/v1/dashboard", headers=trainee)
    data = res.json()["data"]
    assert data["repos"] == [] and data["tours"] == []
    assert data["learning"] == [
        {
            "tour_id": tid,
            "completed_step_ids": [s0["id"]],
            "total_steps": 2,
            "percent_complete": 50.0,
        }
    ]
