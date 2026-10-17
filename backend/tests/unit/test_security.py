import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Request

from app.api.deps import AuthUser, OptionalUser
from app.core import security
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.core.handlers import register_exception_handlers
from app.core.security import authenticate, get_jwks_client
from tests.conftest import TEST_JWT_SECRET, make_token


def _request(authorization: str | None) -> Request:
    headers = [] if authorization is None else [(b"authorization", authorization.encode())]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iat": now,
        "exp": now + 600,
        "email": "dev@example.com",
        "user_metadata": {"user_name": "octocat", "avatar_url": "https://a.example/x.png"},
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _hs256(claims: dict[str, Any], secret: str = TEST_JWT_SECRET) -> str:
    return jwt.encode(claims, secret, algorithm="HS256")


async def _auth_error(authorization: str | None) -> AppError:
    with pytest.raises(AppError) as info:
        await authenticate(_request(authorization))
    assert info.value.code == ErrorCode.UNAUTHORIZED
    assert info.value.status_code == 401
    return info.value


# ---------- HS256 ----------


async def test_valid_hs256_token() -> None:
    user_id = uuid.uuid4()
    user = await authenticate(_request(f"Bearer {make_token(user_id, login='alice')}"))
    assert user is not None
    assert user.id == user_id
    assert user.login == "alice"
    assert user.email == "alice@example.com"
    assert user.avatar_url is None


async def test_bearer_scheme_is_case_insensitive() -> None:
    assert await authenticate(_request(f"bearer {make_token()}")) is not None


async def test_missing_header_returns_none() -> None:
    assert await authenticate(_request(None)) is None


async def test_expired_token() -> None:
    err = await _auth_error(f"Bearer {make_token(expires_in=-3600)}")
    assert err.message == "Token has expired"


async def test_wrong_audience() -> None:
    err = await _auth_error(f"Bearer {_hs256(_claims(aud='anon'))}")
    assert err.message == "Token audience is invalid"


async def test_bad_signature() -> None:
    token = _hs256(_claims(), secret="another-secret-of-sufficient-length-0000")
    err = await _auth_error(f"Bearer {token}")
    assert err.message == "Token signature is invalid"


async def test_missing_sub() -> None:
    claims = _claims()
    del claims["sub"]
    err = await _auth_error(f"Bearer {_hs256(claims)}")
    assert "sub" in err.message


async def test_non_uuid_sub() -> None:
    err = await _auth_error(f"Bearer {_hs256(_claims(sub='not-a-uuid'))}")
    assert err.message == "Token subject is not a valid user id"


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer ", "Bearer a b", "token"])
async def test_malformed_header(header: str) -> None:
    err = await _auth_error(header)
    assert "Bearer" in err.message


async def test_garbage_token() -> None:
    err = await _auth_error("Bearer not.a.jwt")
    assert err.message == "Token is malformed"


async def test_alg_none_rejected() -> None:
    token = jwt.encode(_claims(), None, algorithm="none")
    err = await _auth_error(f"Bearer {token}")
    assert "Unsupported token algorithm" in err.message


@pytest.mark.parametrize(
    ("metadata", "expected"),
    [
        ({"user_name": "gh-user", "preferred_username": "other"}, "gh-user"),
        ({"preferred_username": "pref"}, "pref"),
        ({"user_name": ""}, None),
        ({}, None),
    ],
)
async def test_login_extraction(metadata: dict[str, str], expected: str | None) -> None:
    user = await authenticate(_request(f"Bearer {_hs256(_claims(user_metadata=metadata))}"))
    assert user is not None
    assert user.login == expected


async def test_non_dict_user_metadata_is_ignored() -> None:
    user = await authenticate(_request(f"Bearer {_hs256(_claims(user_metadata='x'))}"))
    assert user is not None
    assert user.login is None
    assert user.avatar_url is None


# ---------- JWKS (RS256) ----------


class _FakeSigningKey:
    def __init__(self, key: object) -> None:
        self.key = key


class _FakeJwksClient:
    def __init__(self, key: object | None = None, error: Exception | None = None) -> None:
        self._key, self._error = key, error
        self.calls = 0

    def get_signing_key_from_jwt(self, token: str) -> _FakeSigningKey:
        self.calls += 1
        if self._error is not None:
            raise self._error
        return _FakeSigningKey(self._key)


@pytest.fixture
def rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def supabase_url(monkeypatch: pytest.MonkeyPatch) -> str:
    url = "https://project.supabase.co"
    monkeypatch.setattr(get_settings(), "supabase_url", url)
    return url


def _rs256(claims: dict[str, Any], key: rsa.RSAPrivateKey) -> str:
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "key-1"})


def test_jwks_client_url_and_cache() -> None:
    client = get_jwks_client("https://abc.supabase.co/")
    assert client.uri == "https://abc.supabase.co/auth/v1/.well-known/jwks.json"
    assert get_jwks_client("https://abc.supabase.co/") is client


async def test_valid_rs256_token_via_jwks(
    monkeypatch: pytest.MonkeyPatch, rsa_key: rsa.RSAPrivateKey, supabase_url: str
) -> None:
    fake = _FakeJwksClient(rsa_key.public_key())
    requested: list[str] = []

    def _get(url: str) -> _FakeJwksClient:
        requested.append(url)
        return fake

    monkeypatch.setattr(security, "get_jwks_client", _get)
    user_id = uuid.uuid4()
    user = await authenticate(_request(f"Bearer {_rs256(_claims(sub=str(user_id)), rsa_key)}"))
    assert user is not None
    assert user.id == user_id
    assert user.avatar_url == "https://a.example/x.png"
    assert requested == [supabase_url]
    assert fake.calls == 1


async def test_rs256_signed_by_other_key(
    monkeypatch: pytest.MonkeyPatch, rsa_key: rsa.RSAPrivateKey, supabase_url: str
) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(
        security, "get_jwks_client", lambda _url: _FakeJwksClient(other.public_key())
    )
    err = await _auth_error(f"Bearer {_rs256(_claims(), rsa_key)}")
    assert err.message == "Token signature is invalid"


async def test_rs256_unknown_kid(
    monkeypatch: pytest.MonkeyPatch, rsa_key: rsa.RSAPrivateKey, supabase_url: str
) -> None:
    fake = _FakeJwksClient(error=jwt.PyJWKClientError("Unable to find a signing key"))
    monkeypatch.setattr(security, "get_jwks_client", lambda _url: fake)
    err = await _auth_error(f"Bearer {_rs256(_claims(), rsa_key)}")
    assert err.message == "Token signing key not recognized"


async def test_jwks_unreachable_is_503(
    monkeypatch: pytest.MonkeyPatch, rsa_key: rsa.RSAPrivateKey, supabase_url: str
) -> None:
    fake = _FakeJwksClient(error=jwt.PyJWKClientConnectionError("down"))
    monkeypatch.setattr(security, "get_jwks_client", lambda _url: fake)
    with pytest.raises(AppError) as info:
        await authenticate(_request(f"Bearer {_rs256(_claims(), rsa_key)}"))
    assert info.value.status_code == 503


async def test_rs256_without_supabase_url(
    monkeypatch: pytest.MonkeyPatch, rsa_key: rsa.RSAPrivateKey
) -> None:
    monkeypatch.setattr(get_settings(), "supabase_url", None)
    err = await _auth_error(f"Bearer {_rs256(_claims(), rsa_key)}")
    assert "Unsupported token algorithm" in err.message


# ---------- Dependencies: required vs optional ----------


@pytest.fixture
async def dep_client() -> AsyncIterator[httpx.AsyncClient]:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/required")
    async def required(user: AuthUser) -> dict[str, str | None]:
        return {"id": str(user.id), "login": user.login}

    @app.get("/optional")
    async def optional(user: OptionalUser) -> dict[str, str | None]:
        return {"id": str(user.id) if user else None}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def test_required_without_header_is_401(dep_client: httpx.AsyncClient) -> None:
    res = await dep_client.get("/required")
    assert res.status_code == 401
    assert res.json()["error"] == {
        "code": "UNAUTHORIZED",
        "message": "Authentication required",
        "details": {},
    }


async def test_optional_without_header_is_anonymous(dep_client: httpx.AsyncClient) -> None:
    res = await dep_client.get("/optional")
    assert res.status_code == 200
    assert res.json() == {"id": None}


async def test_optional_with_invalid_token_is_401(dep_client: httpx.AsyncClient) -> None:
    res = await dep_client.get("/optional", headers={"Authorization": "Bearer junk"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


async def test_required_with_valid_token(dep_client: httpx.AsyncClient) -> None:
    user_id = uuid.uuid4()
    res = await dep_client.get(
        "/required", headers={"Authorization": f"Bearer {make_token(user_id, login='bob')}"}
    )
    assert res.status_code == 200
    assert res.json() == {"id": str(user_id), "login": "bob"}


def test_openapi_declares_bearer_scheme() -> None:
    app = FastAPI()

    @app.get("/me")
    async def me(user: AuthUser) -> dict[str, str]:
        return {"id": str(user.id)}

    schemes = app.openapi()["components"]["securitySchemes"]
    assert schemes["HTTPBearer"]["scheme"] == "bearer"
