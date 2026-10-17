import asyncio
import re
import sys
import types
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
import pytest
from fastapi import FastAPI

from app.core.config import get_settings
from app.core.version import VERSION
from app.services.github_service import RateLimit, get_github_client


async def test_health_ok(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {
        "success": True,
        "data": {"status": "ok", "database": "ok"},
        "error": None,
    }


async def test_meta(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/meta")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"] == {
        "version": VERSION,
        "ai_enabled": False,
        "max_files": get_settings().max_files,
        "github_authenticated": False,
    }


async def test_github_rate_limit_uses_injected_client(client: httpx.AsyncClient) -> None:
    from app.main import app

    reset = datetime(2030, 1, 1, tzinfo=UTC)

    class FakeGitHub:
        async def get_rate_limit(self) -> RateLimit:
            return RateLimit(limit=60, remaining=59, reset_at=reset, authenticated=False)

    app.dependency_overrides[get_github_client] = FakeGitHub
    try:
        res = await client.get("/api/v1/github/rate-limit")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["limit"] == 60
    assert data["remaining"] == 59
    assert data["authenticated"] is False
    assert datetime.fromisoformat(data["reset_at"]) == reset


async def test_unknown_route_envelope(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert res.json() == {
        "success": False,
        "data": None,
        "error": {"code": "NOT_FOUND", "message": "Route not found", "details": {}},
    }


async def test_method_not_allowed_envelope(client: httpx.AsyncClient) -> None:
    res = await client.delete("/api/v1/meta")
    assert res.status_code == 405
    assert res.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
    assert "GET" in res.headers["allow"]


async def test_validation_error_envelope(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/v1/repos/analyze", json={"repo_url": "not a url"})
    assert res.status_code == 422
    body = res.json()
    assert body["success"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    errors = body["error"]["details"]["errors"]
    assert errors
    assert errors[0]["loc"] == ["body", "repo_url"]
    assert set(errors[0]) == {"loc", "msg", "type"}  # input is never echoed back
    assert "github.com" in errors[0]["msg"]


async def test_request_id_echoed(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/meta", headers={"X-Request-ID": "abc-123"})
    assert res.headers["x-request-id"] == "abc-123"


async def test_request_id_generated_when_missing_or_invalid(client: httpx.AsyncClient) -> None:
    generated = (await client.get("/api/v1/meta")).headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", generated)
    replaced = (await client.get("/api/v1/meta", headers={"X-Request-ID": "bad id\t!"})).headers
    assert re.fullmatch(r"[0-9a-f]{32}", replaced["x-request-id"])
    # Error responses carry it too.
    assert (await client.get("/api/v1/nope")).headers["x-request-id"]


async def test_large_responses_are_gzipped(client: httpx.AsyncClient) -> None:
    res = await client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert res.headers["content-encoding"] == "gzip"
    assert res.json()["info"]["version"] == VERSION


@pytest.fixture
async def scratch_client() -> AsyncIterator[httpx.AsyncClient]:
    """Fresh app with routes that fail on purpose (independent of real route implementations)."""
    from app.main import create_app

    app: FastAPI = create_app()

    @app.get("/boom/not-implemented")
    async def not_implemented() -> None:
        raise NotImplementedError

    @app.get("/boom/crash")
    async def crash() -> None:
        raise RuntimeError("secret internals: password=hunter2")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_not_implemented_envelope(scratch_client: httpx.AsyncClient) -> None:
    res = await scratch_client.get("/boom/not-implemented")
    assert res.status_code == 501
    assert res.json()["error"]["code"] == "NOT_IMPLEMENTED"
    assert "Traceback" not in res.text


async def test_unhandled_error_is_generic_500(scratch_client: httpx.AsyncClient) -> None:
    res = await scratch_client.get("/boom/crash", headers={"X-Request-ID": "req-42"})
    assert res.status_code == 500
    body = res.json()
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == "An unexpected error occurred"
    assert body["error"]["details"] == {"request_id": "req-42"}
    assert res.headers["x-request-id"] == "req-42"
    assert "hunter2" not in res.text


async def test_lifespan_runs_embedded_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.main import create_app, lifespan

    events: list[str] = []
    stop_event = asyncio.Event()

    async def _loop() -> None:
        await stop_event.wait()

    def start_embedded_worker() -> tuple[asyncio.Task[None], asyncio.Event]:
        events.append("start")
        return asyncio.create_task(_loop()), stop_event

    async def stop_embedded_worker(task: asyncio.Task[None], event: asyncio.Event) -> None:
        events.append("stop")
        event.set()
        await task

    fake = types.SimpleNamespace(
        start_embedded_worker=start_embedded_worker, stop_embedded_worker=stop_embedded_worker
    )
    monkeypatch.setitem(sys.modules, "app.workers.analysis_worker", fake)
    monkeypatch.setattr(get_settings(), "worker_mode", "embedded")

    async with lifespan(create_app()):
        assert events == ["start"]
    assert events == ["start", "stop"]


async def test_lifespan_skips_worker_when_off(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.main import create_app, lifespan

    monkeypatch.setitem(sys.modules, "app.workers.analysis_worker", None)  # import would fail
    async with lifespan(create_app()):
        pass
