from dataclasses import replace
from typing import Any

import pytest
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.engine.types import FileRole
from app.services import ai_service
from app.services.ai_service import (
    ROLE_MEANING,
    SlidingWindowLimiter,
    StepContext,
    build_prompt,
    cache_key,
    parse_generate_response,
    validate_draft,
)

SECRET = "AIza-unit-test-secret-key"

CTX = StepContext(
    repo_owner="octo",
    repo_name="demo",
    commit_sha="a" * 40,
    file_path="app/core/config.py",
    language="python",
    loc=40,
    content_sha256="c" * 64,
    start_line=12,
    end_line=14,
    snippet_lines=("def get_settings():", "    return Settings()", ""),
    snippet_truncated=False,
    before_lines=("import os", "", "@lru_cache"),
    after_lines=("# end",),
    role=FileRole.CORE_UTILITY,
    role_meaning=ROLE_MEANING[FileRole.CORE_UTILITY],
    in_degree=7,
    out_degree=1,
    exports=(),
    functions=("get_settings",),
    classes=("Settings",),
    imports=("app/core/env.py",),
    imports_total=1,
    dependents=("app/main.py", "app/db/session.py"),
    dependents_total=19,
    impact_percentage=42.5,
    risk_score=31.25,
    risk_level="HIGH",
    transitive_dependents=12,
    total_files=48,
    is_circular=True,
    parse_warning=None,
)

GOOD: dict[str, Any] = {
    "title": "  How   settings are cached  ",
    "body_markdown": "### What it does\nReturns a cached `Settings`.",
    "checkpoint": {
        "question": "What does get_settings return?",
        "options": ["A Settings instance", "A dict", "None"],
        "correct_index": 0,
        "explanation": "Line 13 returns Settings().",
    },
}


def test_build_prompt_includes_graph_facts_and_numbered_snippet() -> None:
    system, user = build_prompt(CTX)
    assert "senior software engineer" in system
    assert "exactly one correct option" in system
    for fact in (
        "octo/demo",
        "aaaaaaaaaaaa",
        "`app/core/config.py`",
        "CORE_UTILITY",
        ROLE_MEANING[FileRole.CORE_UTILITY],
        "Imported by 7",
        "imports 1",
        "`app/core/env.py`",
        "`app/main.py`, `app/db/session.py` (+17 more)",
        "42.5%",
        "31.25 (HIGH)",
        "12 transitive",
        "circular import: yes",
        "`get_settings`",
        "`Settings`",
    ):
        assert fact in user, fact
    assert "   12 | def get_settings():" in user
    assert "   13 |     return Settings()" in user
    assert "    9 | import os" in user  # context before starts at 12 - 3
    assert "   15 | # end" in user
    assert "lines 12-14 (explain THIS)" in user
    assert user.index("Context before") < user.index("Pinned code") < user.index("Context after")


def test_build_prompt_is_pure_and_never_contains_the_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "gemini_api_key", SecretStr(SECRET))
    first = build_prompt(CTX)
    assert first == build_prompt(CTX)
    assert all(SECRET not in part for part in first)


def test_build_prompt_marks_truncation_and_omits_empty_sections() -> None:
    ctx = replace(CTX, snippet_truncated=True, before_lines=(), after_lines=(), exports=())
    _, user = build_prompt(ctx)
    assert "truncated to lines 12-14" in user
    assert "Context before" not in user and "Context after" not in user
    assert "Top-level exports: none" in user


def test_request_body_shape_and_no_key() -> None:
    client = ai_service.GeminiClient(SECRET, "gemini-2.5-flash")
    body = client.request_body("sys", "usr")
    cfg = body["generationConfig"]
    assert cfg["temperature"] == 0.3 and cfg["maxOutputTokens"] == 4096
    assert cfg["responseMimeType"] == "application/json"
    assert cfg["responseSchema"]["required"] == ["title", "body_markdown", "checkpoint"]
    assert body["systemInstruction"]["parts"][0]["text"] == "sys"
    assert cfg["thinkingConfig"] == {"thinkingBudget": 0}
    gemini3 = ai_service.GeminiClient(SECRET, "gemini-3.8-flash").request_body("s", "u")
    assert gemini3["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
    assert body["contents"][0]["parts"][0]["text"] == "usr"
    assert SECRET not in repr(body)


def test_validate_draft_accepts_good_json() -> None:
    title, body, checkpoint = validate_draft(GOOD)
    assert title == "How settings are cached"
    assert body.startswith("### What it does")
    assert checkpoint is not None and checkpoint.correct_index == 0
    assert checkpoint.options == ["A Settings instance", "A dict", "None"]


def test_validate_draft_trims_title_and_body() -> None:
    title, body, _ = validate_draft({**GOOD, "title": "t" * 500, "body_markdown": "b" * 30000})
    assert len(title) == 200 and len(body) == 20000


@pytest.mark.parametrize(
    "checkpoint",
    [
        {**GOOD["checkpoint"], "correct_index": 3},
        {**GOOD["checkpoint"], "options": ["only one"]},
        {**GOOD["checkpoint"], "options": ["Same", "same", "other"]},
        {**GOOD["checkpoint"], "question": ""},
        "not an object",
        None,
    ],
)
def test_validate_draft_drops_invalid_checkpoint(checkpoint: object) -> None:
    title, body, cp = validate_draft({**GOOD, "checkpoint": checkpoint})
    assert cp is None
    assert title and body


@pytest.mark.parametrize(
    "raw",
    [
        {**GOOD, "body_markdown": "   \n  "},
        {**GOOD, "title": "   "},
        {"title": "x"},
        {"title": 1, "body_markdown": "x"},
        ["not", "an", "object"],
        "plain text",
    ],
)
def test_validate_draft_rejects_bad_output(raw: object) -> None:
    with pytest.raises(AppError) as exc:
        validate_draft(raw)
    assert exc.value.code == ErrorCode.AI_FAILED
    assert exc.value.status_code == 502


def test_parse_generate_response() -> None:
    text = '{"title": "t", "body_markdown": "b", "checkpoint": null}'
    data = {
        "candidates": [
            {
                "content": {"parts": [{"text": "thinking...", "thought": True}, {"text": text}]},
                "finishReason": "STOP",
            }
        ]
    }
    expected = {"title": "t", "body_markdown": "b", "checkpoint": None}
    assert parse_generate_response(data) == expected


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        ({"promptFeedback": {"blockReason": "SAFETY"}}, "blocked this request (SAFETY)"),
        ({"candidates": []}, "returned no draft"),
        ({"candidates": [{"finishReason": "SAFETY"}]}, "finish reason: SAFETY"),
        (
            {"candidates": [{"content": {"parts": [{"text": '{"title": '}]}}]},
            "malformed JSON",
        ),
        ("nope", "unreadable"),
    ],
)
def test_parse_generate_response_failures(data: object, fragment: str) -> None:
    with pytest.raises(AppError) as exc:
        parse_generate_response(data)
    assert exc.value.code == ErrorCode.AI_FAILED
    assert fragment in exc.value.message


def test_cache_key_is_stable_and_sensitive_to_every_input() -> None:
    args = ("gemini-2.5-flash", "a" * 40, "app/x.py", 1, 10, "c" * 64)
    key = cache_key(*args)
    assert key == cache_key(*args)
    assert len(key) == 64
    variants = [
        ("other-model", *args[1:]),
        (args[0], "b" * 40, *args[2:]),
        (*args[:2], "app/y.py", *args[3:]),
        (*args[:3], 2, *args[4:]),
        (*args[:4], 11, args[5]),
        (*args[:5], "d" * 64),
    ]
    assert len({cache_key(*v) for v in variants} | {key}) == len(variants) + 1


def test_rate_limiter_sliding_window() -> None:
    now = [1000.0]
    limiter = SlidingWindowLimiter(3, 600.0, clock=lambda: now[0])
    for offset in (0.0, 10.0, 20.0):
        now[0] = 1000.0 + offset
        limiter.acquire("u1")
    limiter.acquire("u2")  # independent key

    now[0] = 1100.0
    with pytest.raises(AppError) as exc:
        limiter.acquire("u1")
    assert exc.value.status_code == 429
    assert exc.value.code == ErrorCode.AI_FAILED
    assert exc.value.details == {"retry_after": 500}  # first hit at 1000 expires at 1600
    assert "500 seconds" in exc.value.message

    now[0] = 1600.0  # oldest hit leaves the window
    limiter.acquire("u1")
    with pytest.raises(AppError):
        limiter.acquire("u1")

    limiter.reset()
    limiter.acquire("u1")


def test_get_ai_client_disabled_without_key() -> None:
    assert not get_settings().ai_enabled
    with pytest.raises(AppError) as exc:
        ai_service.get_ai_client()
    assert exc.value.code == ErrorCode.AI_DISABLED
    assert exc.value.status_code == 503
