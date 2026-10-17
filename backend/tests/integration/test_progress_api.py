import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserStepProgress
from tests.integration.factories import (
    OWNER_ID,
    TRAINEE_ID,
    api_create_step,
    api_create_tour,
    make_analysis,
    make_repository,
)

Headers = dict[str, str]
FILES = {"app/main.py": "import os\n\n\ndef main():\n    print('hi')\n    return 0\n"}
CHECKPOINT = {
    "question": "What does main return?",
    "options": ["None", "0", "1"],
    "correct_index": 1,
    "explanation": "It returns 0 on success.",
}


@pytest.fixture
def owner(auth_headers: Callable[..., Headers]) -> Headers:
    return auth_headers(OWNER_ID, "owner")


@pytest.fixture
def trainee(auth_headers: Callable[..., Headers]) -> Headers:
    return auth_headers(TRAINEE_ID, "trainee")


async def _tour(
    client: httpx.AsyncClient, db: AsyncSession, owner: Headers, visibility: str = "PUBLIC"
) -> tuple[str, list[dict[str, Any]]]:
    repo = await make_repository(db)
    analysis = await make_analysis(db, repo, FILES)
    tour = await api_create_tour(client, owner, analysis.id, visibility=visibility)
    tid = tour["id"]
    steps = [
        await api_create_step(client, owner, tid, "app/main.py", 1, 1, title="Imports"),
        await api_create_step(
            client, owner, tid, "app/main.py", 4, 6, title="Main", checkpoint=CHECKPOINT
        ),
        await api_create_step(client, owner, tid, "app/main.py", 6, 6, title="Return"),
    ]
    return tid, steps


async def test_answer_flow_and_progress(
    client: httpx.AsyncClient, db_session: AsyncSession, owner: Headers, trainee: Headers
) -> None:
    tid, (first, quiz, last) = await _tour(client, db_session, owner)

    def url(step: dict[str, Any]) -> str:
        return f"/api/v1/tours/{tid}/steps/{step['id']}/answer"

    # Steps must be completed in order.
    res = await client.post(url(quiz), json={"selected_index": 1}, headers=trainee)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"

    res = await client.post(url(first), json={}, headers=trainee)
    assert res.status_code == 200
    assert res.json()["data"] == {
        "step_id": first["id"],
        "correct": True,
        "completed": True,
        "attempts": 1,
        "explanation": None,
    }

    for bad in ({}, {"selected_index": 3}):
        res = await client.post(url(quiz), json=bad, headers=trainee)
        assert res.status_code == 422
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"

    wrong = (await client.post(url(quiz), json={"selected_index": 0}, headers=trainee)).json()
    assert wrong["data"] == {
        "step_id": quiz["id"],
        "correct": False,
        "completed": False,
        "attempts": 1,
        "explanation": None,
    }
    right = (await client.post(url(quiz), json={"selected_index": 1}, headers=trainee)).json()
    assert right["data"] == {
        "step_id": quiz["id"],
        "correct": True,
        "completed": True,
        "attempts": 2,
        "explanation": CHECKPOINT["explanation"],
    }
    # A later wrong answer never un-completes the step.
    again = (await client.post(url(quiz), json={"selected_index": 2}, headers=trainee)).json()
    assert (again["data"]["correct"], again["data"]["completed"]) == (False, True)
    assert again["data"]["attempts"] == 3 and again["data"]["explanation"] is None

    row = (
        await db_session.scalars(
            select(UserStepProgress).where(UserStepProgress.step_id == uuid.UUID(quiz["id"]))
        )
    ).one()
    assert (row.user_id, row.user_login, row.first_try_correct) == (TRAINEE_ID, "trainee", False)
    assert row.completed_at is not None

    progress = (await client.get(f"/api/v1/tours/{tid}/progress", headers=trainee)).json()
    assert progress["data"] == {
        "tour_id": tid,
        "completed_step_ids": [first["id"], quiz["id"]],
        "total_steps": 3,
        "percent_complete": 66.7,
    }

    res = await client.post(url(last), json={}, headers=trainee)
    assert res.json()["data"]["completed"] is True
    progress = (await client.get(f"/api/v1/tours/{tid}/progress", headers=trainee)).json()
    assert progress["data"]["percent_complete"] == 100.0

    # Other users start from zero.
    fresh = await client.get(f"/api/v1/tours/{tid}/progress", headers=owner)
    assert fresh.json()["data"]["completed_step_ids"] == []
    assert fresh.json()["data"]["percent_complete"] == 0.0


async def test_first_try_correct_recorded(
    client: httpx.AsyncClient, db_session: AsyncSession, owner: Headers, trainee: Headers
) -> None:
    tid, (first, quiz, _) = await _tour(client, db_session, owner)
    await client.post(f"/api/v1/tours/{tid}/steps/{first['id']}/answer", json={}, headers=trainee)
    res = await client.post(
        f"/api/v1/tours/{tid}/steps/{quiz['id']}/answer",
        json={"selected_index": 1},
        headers=trainee,
    )
    assert res.json()["data"]["attempts"] == 1
    rows = {
        str(r.step_id): r
        for r in (
            await db_session.scalars(
                select(UserStepProgress).where(UserStepProgress.user_id == TRAINEE_ID)
            )
        ).all()
    }
    assert rows[quiz["id"]].first_try_correct is True
    assert rows[first["id"]].first_try_correct is None  # no checkpoint -> not scored


async def test_progress_access_rules(
    client: httpx.AsyncClient, db_session: AsyncSession, owner: Headers, trainee: Headers
) -> None:
    tid, (first, _, _) = await _tour(client, db_session, owner, visibility="PRIVATE")
    assert (await client.get(f"/api/v1/tours/{tid}/progress")).status_code == 401
    assert (await client.get(f"/api/v1/tours/{tid}/progress", headers=trainee)).status_code == 404
    res = await client.post(
        f"/api/v1/tours/{tid}/steps/{first['id']}/answer", json={}, headers=trainee
    )
    assert res.status_code == 404
    # The owner may take their own private tour.
    res = await client.post(
        f"/api/v1/tours/{tid}/steps/{first['id']}/answer", json={}, headers=owner
    )
    assert res.status_code == 200
