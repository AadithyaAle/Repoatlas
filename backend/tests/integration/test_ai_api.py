import json
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Analysis, AnalysisStatus
from app.services import ai_service
from app.services.ai_service import GeminiClient, SlidingWindowLimiter, get_ai_client
from tests.integration.factories import OWNER_ID, SHA_B, make_analysis, make_repository

Headers = dict[str, str]

API_KEY = "AIza-integration-test-key-000"
MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
CONFIG = "\n".join(
    [
        "import os",
        "from functools import lru_cache",
        "",
        "from app.util import env",
        "",
        "",
        "class Settings:",
        "    def __init__(self) -> None:",
        "        self.debug = env('DEBUG') == '1'",
        "",
        "",
        "@lru_cache",
        "def get_settings() -> Settings:",
        "    return Settings()",
    ]
)
FILES = {
    "app/config.py": CONFIG + "\n",
    "app/util.py": "import os\n\n\ndef env(name):\n    return os.environ.get(name)\n",
    "app/main.py": "from app.config import get_settings\n\nsettings = get_settings()\n",
    "app/db.py": "from app.config import get_settings\n\nURL = get_settings().debug\n",
}
EDGES = [
    ("app/config.py", "app/util.py"),
    ("app/main.py", "app/config.py"),
    ("app/db.py", "app/config.py"),
]
DRAFT: dict[str, Any] = {
    "title": "Cached settings accessor",
    "body_markdown": "### What it does\n`get_settings` returns a cached `Settings`.",
    "checkpoint": {
        "question": "Why is Settings constructed only once?",
        "options": ["lru_cache memoizes get_settings", "It is a global", "It is not"],
        "correct_index": 0,
        "explanation": "`@lru_cache` on line 12 caches the return value.",
    },
}


class FakeAI:
    model = "fake-model"

    def __init__(self, reply: object) -> None:
        self.reply = reply
        self.calls: list[tuple[str, str]] = []

    async def generate_json(self, system: str, user: str) -> object:
        self.calls.append((system, user))
        return self.reply


@pytest.fixture(autouse=True)
def _reset_ai_state() -> Iterator[None]:
    ai_service.reset_state()
    yield
    ai_service.reset_state()


@pytest.fixture
def owner(auth_headers: Callable[..., Headers]) -> Headers:
    return auth_headers(OWNER_ID, "owner")


@pytest.fixture
async def analysis(db_session: AsyncSession) -> Analysis:
    repo = await make_repository(db_session)
    return await make_analysis(db_session, repo, FILES, edges=EDGES)


@contextmanager
def _override(client: object) -> Iterator[None]:
    from app.main import app

    app.dependency_overrides[get_ai_client] = lambda: client
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_ai_client, None)


@pytest.fixture
def fake_ai() -> Iterator[FakeAI]:
    fake = FakeAI(DRAFT)
    with _override(fake):
        yield fake


@pytest.fixture
def sleeps() -> list[float]:
    return []


@pytest.fixture
async def gemini(sleeps: list[float]) -> AsyncIterator[GeminiClient]:
    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    client = GeminiClient(API_KEY, MODEL, sleep=fake_sleep)
    with _override(client):
        yield client
    await client.aclose()


@pytest.fixture
def mock() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False) as router:
        yield router


def _body(
    analysis_id: object, start: int = 12, end: int = 14, path: str = "app/config.py"
) -> dict[str, Any]:
    return {
        "analysis_id": str(analysis_id),
        "file_path": path,
        "start_line": start,
        "end_line": end,
    }


async def _draft(
    client: httpx.AsyncClient, headers: Headers | None, body: dict[str, Any]
) -> httpx.Response:
    return await client.post("/api/v1/ai/step-draft", json=body, headers=headers or {})


def _error(res: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert res.status_code == status, res.text
    payload: dict[str, Any] = res.json()
    assert payload["success"] is False
    assert payload["error"]["code"] == code
    return payload["error"]


# ---------- without a key ----------


async def test_ai_disabled_returns_503_envelope(
    client: httpx.AsyncClient, owner: Headers, analysis: Analysis
) -> None:
    res = await _draft(client, owner, _body(analysis.id))
    error = _error(res, 503, "AI_DISABLED")
    assert error["message"] == "AI features are not configured on this server"


async def test_meta_reports_ai_disabled(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/meta")
    assert res.json()["data"]["ai_enabled"] is False


# ---------- fake client ----------


async def test_draft_is_grounded_and_cached(
    client: httpx.AsyncClient, owner: Headers, analysis: Analysis, fake_ai: FakeAI
) -> None:
    res = await _draft(client, owner, _body(analysis.id))
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["title"] == DRAFT["title"]
    assert data["body_markdown"] == DRAFT["body_markdown"]
    assert data["checkpoint"]["correct_index"] == 0
    assert data["model"] == "fake-model"
    assert data["cached"] is False

    assert len(fake_ai.calls) == 1
    system, user = fake_ai.calls[0]
    assert "senior software engineer" in system
    assert "octo/demo" in user
    assert "`app/util.py`" in user  # direct import
    assert "`app/db.py`, `app/main.py`" in user  # direct dependents (sorted)
    assert "Role: STANDARD" in user
    assert "   13 | def get_settings() -> Settings:" in user
    assert "    2 | from functools import lru_cache" in user  # context before (12 - 10)

    again = await _draft(client, owner, _body(analysis.id))
    assert again.status_code == 200
    assert again.json()["data"] == {**data, "cached": True}
    assert len(fake_ai.calls) == 1  # served from cache


async def test_invalid_checkpoint_is_dropped(
    client: httpx.AsyncClient, owner: Headers, analysis: Analysis, fake_ai: FakeAI
) -> None:
    fake_ai.reply = {**DRAFT, "checkpoint": {**DRAFT["checkpoint"], "correct_index": 7}}
    res = await _draft(client, owner, _body(analysis.id))
    assert res.status_code == 200, res.text
    assert res.json()["data"]["checkpoint"] is None


async def test_empty_body_is_ai_failed(
    client: httpx.AsyncClient, owner: Headers, analysis: Analysis, fake_ai: FakeAI
) -> None:
    fake_ai.reply = {**DRAFT, "body_markdown": "  "}
    _error(await _draft(client, owner, _body(analysis.id)), 502, "AI_FAILED")


@pytest.mark.parametrize(("start", "end"), [(10, 99), (5, 4)])
async def test_invalid_range_is_422(
    client: httpx.AsyncClient,
    owner: Headers,
    analysis: Analysis,
    fake_ai: FakeAI,
    start: int,
    end: int,
) -> None:
    res = await _draft(client, owner, _body(analysis.id, start, end))
    error = _error(res, 422, "INVALID_LINE_RANGE")
    assert error["details"]["loc"] == 14
    assert fake_ai.calls == []


async def test_unknown_file_is_404(
    client: httpx.AsyncClient, owner: Headers, analysis: Analysis, fake_ai: FakeAI
) -> None:
    res = await _draft(client, owner, _body(analysis.id, 1, 1, path="app/nope.py"))
    _error(res, 404, "FILE_NOT_IN_SNAPSHOT")


async def test_analysis_not_ready_is_409(
    client: httpx.AsyncClient, owner: Headers, db_session: AsyncSession, fake_ai: FakeAI
) -> None:
    repo = await make_repository(db_session)
    pending = await make_analysis(
        db_session, repo, FILES, commit_sha=SHA_B, status=AnalysisStatus.PENDING
    )
    _error(await _draft(client, owner, _body(pending.id)), 409, "ANALYSIS_NOT_READY")
    assert fake_ai.calls == []


async def test_unauthenticated_is_401(
    client: httpx.AsyncClient, analysis: Analysis, fake_ai: FakeAI
) -> None:
    _error(await _draft(client, None, _body(analysis.id)), 401, "UNAUTHORIZED")
    assert fake_ai.calls == []


async def test_rate_limit_per_user(
    client: httpx.AsyncClient,
    owner: Headers,
    auth_headers: Callable[..., Headers],
    analysis: Analysis,
    fake_ai: FakeAI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ai_service, "_limiter", SlidingWindowLimiter(1, 600.0))
    assert (await _draft(client, owner, _body(analysis.id, 1, 2))).status_code == 200
    # cache hits are free
    assert (await _draft(client, owner, _body(analysis.id, 1, 2))).json()["data"]["cached"]
    error = _error(await _draft(client, owner, _body(analysis.id, 3, 4)), 429, "AI_FAILED")
    assert 0 < error["details"]["retry_after"] <= 600
    other = await _draft(client, auth_headers(login="bob"), _body(analysis.id, 3, 4))
    assert other.status_code == 200


# ---------- real GeminiClient against a mocked Gemini API ----------


def _gemini_ok(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidates": [
            {"content": {"parts": [{"text": json.dumps(payload)}]}, "finishReason": "STOP"}
        ]
    }


async def test_gemini_end_to_end_with_retry(
    client: httpx.AsyncClient,
    owner: Headers,
    analysis: Analysis,
    gemini: GeminiClient,
    mock: respx.MockRouter,
    sleeps: list[float],
) -> None:
    route = mock.post(GEMINI_URL).mock(
        side_effect=[httpx.Response(500), httpx.Response(200, json=_gemini_ok(DRAFT))]
    )
    res = await _draft(client, owner, _body(analysis.id))
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["model"] == MODEL and data["cached"] is False
    assert data["checkpoint"]["options"] == DRAFT["checkpoint"]["options"]
    assert route.call_count == 2
    assert sleeps == [1.0]

    request = route.calls.last.request
    assert request.headers["x-goog-api-key"] == API_KEY
    assert API_KEY not in str(request.url)
    assert request.url.path == f"/v1beta/models/{MODEL}:generateContent"
    sent = json.loads(request.content)
    assert API_KEY not in request.content.decode()
    cfg = sent["generationConfig"]
    assert cfg["responseMimeType"] == "application/json"
    assert cfg["responseSchema"]["properties"]["checkpoint"]["nullable"] is True
    assert "senior software engineer" in sent["systemInstruction"]["parts"][0]["text"]
    assert "`app/util.py`" in sent["contents"][0]["parts"][0]["text"]


async def test_gemini_blocked_prompt_is_502(
    client: httpx.AsyncClient,
    owner: Headers,
    analysis: Analysis,
    gemini: GeminiClient,
    mock: respx.MockRouter,
) -> None:
    mock.post(GEMINI_URL).respond(200, json={"promptFeedback": {"blockReason": "SAFETY"}})
    res = await _draft(client, owner, _body(analysis.id))
    error = _error(res, 502, "AI_FAILED")
    assert "SAFETY" in error["message"]
    assert API_KEY not in res.text


async def test_gemini_client_error_is_not_retried(
    client: httpx.AsyncClient,
    owner: Headers,
    analysis: Analysis,
    gemini: GeminiClient,
    mock: respx.MockRouter,
    sleeps: list[float],
) -> None:
    route = mock.post(GEMINI_URL).respond(400, json={"error": {"status": "INVALID_ARGUMENT"}})
    error = _error(await _draft(client, owner, _body(analysis.id)), 502, "AI_FAILED")
    assert error["details"] == {"status": 400}
    assert route.call_count == 1 and sleeps == []


async def test_gemini_exhausted_retries_is_502(
    client: httpx.AsyncClient,
    owner: Headers,
    analysis: Analysis,
    gemini: GeminiClient,
    mock: respx.MockRouter,
    sleeps: list[float],
) -> None:
    route = mock.post(GEMINI_URL).mock(side_effect=httpx.ConnectTimeout)
    _error(await _draft(client, owner, _body(analysis.id)), 502, "AI_FAILED")
    assert route.call_count == 3 and sleeps == [1.0, 2.0]
