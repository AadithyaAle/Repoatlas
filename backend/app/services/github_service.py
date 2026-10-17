"""Async GitHub client (httpx). Two API calls per analysis:

1. `resolve_ref`: GET /repos/{o}/{r} (default branch, metadata) + GET /repos/{o}/{r}/commits/{ref}
   -> pinned commit SHA.
2. `download_snapshot`: GET /repos/{o}/{r}/tarball/{sha} (follows redirect to codeload; streamed,
   aborted above `max_tarball_bytes`), extracted in memory with path-traversal protection.

Rate-limit headers (`x-ratelimit-remaining`, `x-ratelimit-reset`) are recorded on every response.
Errors map to AppError: 404 -> GITHUB_REPO_NOT_FOUND, 403/429 with remaining=0 ->
GITHUB_RATE_LIMITED (details.reset_at), 5xx/timeouts -> GITHUB_UNAVAILABLE (after retries with
exponential backoff).
"""

import asyncio
import io
import logging
import posixpath
import tarfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.engine.ast_parser import SUPPORTED_EXTENSIONS

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 1.0, 2.0)
SKIP_DIRS = frozenset(
    {
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        "out",
        "coverage",
        "__pycache__",
        ".venv",
        "venv",
        "vendor",
        "site-packages",
        ".tox",
        ".mypy_cache",
    }
)
_SKIP_SUFFIXES = (".min.js", ".min.mjs", ".min.cjs", ".d.ts", ".d.mts", ".d.cts")
_PRIORITY_ROOTS = frozenset({"src", "app", "lib"})


@dataclass(frozen=True, slots=True)
class RepoRef:
    owner: str  # canonical casing from GitHub
    name: str
    default_branch: str
    branch: str
    commit_sha: str
    description: str | None
    stars: int | None


@dataclass(slots=True)
class Snapshot:
    sources: dict[str, str]  # repo-relative path -> utf-8 text (supported extensions, capped)
    config_files: dict[str, str]  # tsconfig*.json / jsconfig.json
    total_source_files: int  # before cap
    truncated: bool
    skipped_files: list[str] = field(default_factory=list)  # binary / oversize / non-utf8


@dataclass(frozen=True, slots=True)
class RateLimit:
    limit: int | None
    remaining: int | None
    reset_at: datetime | None
    authenticated: bool


# ---------- tarball extraction (pure, runs in a worker thread) ----------


def _safe_relpath(member_name: str) -> str | None:
    """Strip the top-level `{owner}-{repo}-{sha}/` dir; reject absolute / traversal paths."""
    if member_name.startswith(("/", "\\")) or "\\" in member_name or "\x00" in member_name:
        return None
    parts = [p for p in member_name.split("/") if p not in ("", ".")]
    if len(parts) < 2 or ".." in parts or ":" in parts[0]:
        return None
    return "/".join(parts[1:])


def _is_config(path: str) -> bool:
    base = posixpath.basename(path)
    return base == "jsconfig.json" or (base.startswith("tsconfig") and base.endswith(".json"))


def _is_source(path: str) -> bool:
    lower = path.lower()
    if lower.endswith(_SKIP_SUFFIXES):
        return False
    return posixpath.splitext(path)[1] in SUPPORTED_EXTENSIONS


def _priority(path: str) -> tuple[int, int, str]:
    parts = path.split("/")
    preferred = (len(parts) > 1 and parts[0] in _PRIORITY_ROOTS) or (
        len(parts) > 3 and parts[0] == "packages" and parts[2] == "src"
    )
    return (0 if preferred else 1, len(parts), path)


def _decode(raw: bytes) -> str | None:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return None if "\x00" in text else text  # NUL => binary (and Postgres rejects it)


def extract_snapshot(data: bytes, *, max_files: int, max_file_bytes: int) -> Snapshot:
    """Extract supported sources + TS/JS configs from a GitHub tar.gz held in memory."""
    skipped: list[str] = []
    candidates: dict[str, tarfile.TarInfo] = {}
    configs: dict[str, tarfile.TarInfo] = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            for member in tf.getmembers():
                if not member.isreg():  # dirs, symlinks, hardlinks, devices, fifos
                    continue
                path = _safe_relpath(member.name)
                if path is None:
                    logger.warning("Skipping unsafe tar member %r", member.name)
                    continue
                if any(part in SKIP_DIRS for part in path.split("/")[:-1]):
                    continue
                is_config, is_source = _is_config(path), _is_source(path)
                if not (is_config or is_source):
                    continue
                if member.size > max_file_bytes:
                    skipped.append(path)
                    continue
                (configs if is_config else candidates)[path] = member

            ranked = sorted(candidates, key=_priority)
            selected = {p: candidates[p] for p in ranked[:max_files]}
            sources: dict[str, str] = {}
            config_files: dict[str, str] = {}
            # Read in archive order so the gzip stream only ever seeks forward.
            to_read = [(p, m, False) for p, m in selected.items()]
            to_read += [(p, m, True) for p, m in configs.items()]
            for path, member, is_config in sorted(to_read, key=lambda t: t[1].offset_data):
                fh = tf.extractfile(member)
                text = _decode(fh.read()) if fh is not None else None
                if text is None:
                    skipped.append(path)
                else:
                    (config_files if is_config else sources)[path] = text
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise AppError(
            ErrorCode.GITHUB_UNAVAILABLE, "Could not read the repository archive from GitHub"
        ) from exc

    return Snapshot(
        sources=dict(sorted(sources.items())),
        config_files=dict(sorted(config_files.items())),
        total_source_files=len(candidates),
        truncated=len(candidates) > max_files,
        skipped_files=sorted(skipped),
    )


# ---------- HTTP client ----------


def _int_header(headers: httpx.Headers, key: str) -> int | None:
    value = headers.get(key)
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def _message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return ""
    return str(body.get("message", "")) if isinstance(body, dict) else ""


class GitHubClient:
    """Wraps one shared `httpx.AsyncClient`. Construct with `token`/`base_url` from Settings."""

    def __init__(
        self,
        token: str | None,
        base_url: str = "https://api.github.com",
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "RepoAtlas",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._authenticated = bool(token)
        self._sleep = sleep
        self._last_rate_limit: RateLimit | None = None
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(20.0, connect=10.0),
            follow_redirects=True,
            transport=transport,
        )

    @property
    def last_rate_limit(self) -> RateLimit | None:
        return self._last_rate_limit

    def _record_rate_limit(self, resp: httpx.Response) -> None:
        remaining = _int_header(resp.headers, "x-ratelimit-remaining")
        if remaining is None:
            return
        reset = _int_header(resp.headers, "x-ratelimit-reset")
        self._last_rate_limit = RateLimit(
            limit=_int_header(resp.headers, "x-ratelimit-limit"),
            remaining=remaining,
            reset_at=datetime.fromtimestamp(reset, UTC) if reset is not None else None,
            authenticated=self._authenticated,
        )

    async def _send(self, path: str, *, stream: bool = False) -> httpx.Response:
        """GET with retries on 5xx / transport errors. Returns any response with status < 500."""
        for attempt in range(MAX_ATTEMPTS):
            last = attempt == MAX_ATTEMPTS - 1
            request = self._client.build_request("GET", path)
            try:
                resp = await self._client.send(request, stream=stream)
            except httpx.TransportError as exc:  # includes timeouts
                logger.warning("GitHub GET %s failed (attempt %d): %r", path, attempt + 1, exc)
                if last:
                    raise AppError(
                        ErrorCode.GITHUB_UNAVAILABLE, "GitHub is unreachable, try again later"
                    ) from exc
            else:
                self._record_rate_limit(resp)
                if resp.status_code < 500:
                    return resp
                await resp.aclose()
                logger.warning(
                    "GitHub GET %s -> %d (attempt %d)", path, resp.status_code, attempt + 1
                )
                if last:
                    raise AppError(
                        ErrorCode.GITHUB_UNAVAILABLE,
                        f"GitHub returned {resp.status_code}, try again later",
                    )
            await self._sleep(BACKOFF_SECONDS[attempt])
        raise AssertionError("unreachable")  # pragma: no cover

    async def _get(
        self,
        path: str,
        slug: str,
        *,
        stream: bool = False,
        overrides: dict[int, AppError] | None = None,
    ) -> httpx.Response:
        resp = await self._send(path, stream=stream)
        if resp.status_code < 400:
            return resp
        if stream:
            await resp.aread()
            await resp.aclose()
        raise self._map_error(resp, slug, overrides or {})

    def _map_error(
        self, resp: httpx.Response, slug: str, overrides: dict[int, AppError]
    ) -> AppError:
        status, message = resp.status_code, _message(resp)
        if status in overrides:
            return overrides[status]
        if status in (403, 429) and (
            status == 429
            or resp.headers.get("x-ratelimit-remaining") == "0"
            or "rate limit" in message.lower()
        ):
            reset = _int_header(resp.headers, "x-ratelimit-reset")
            retry_after = _int_header(resp.headers, "retry-after")
            if reset is not None:
                reset_at: datetime | None = datetime.fromtimestamp(reset, UTC)
            elif retry_after is not None:
                reset_at = datetime.now(UTC) + timedelta(seconds=retry_after)
            else:
                reset_at = None
            return AppError(
                ErrorCode.GITHUB_RATE_LIMITED,
                "GitHub API rate limit exceeded, try again later",
                details={
                    "reset_at": reset_at.isoformat() if reset_at else None,
                    "authenticated": self._authenticated,
                },
            )
        if status in (404, 451):
            return AppError(
                ErrorCode.GITHUB_REPO_NOT_FOUND, f"Repository {slug} not found or is private"
            )
        logger.warning("GitHub error for %s: %d %s", slug, status, message)
        return AppError(
            ErrorCode.GITHUB_UNAVAILABLE,
            f"GitHub rejected the request for {slug} ({status})",
            details={"status": status},
        )

    async def resolve_ref(self, owner: str, name: str, branch: str | None) -> RepoRef:
        slug = f"{owner}/{name}"
        repo = (await self._get(f"/repos/{quote(owner)}/{quote(name)}", slug)).json()
        if repo.get("private"):
            raise AppError(
                ErrorCode.GITHUB_REPO_NOT_FOUND, f"Repository {slug} not found or is private"
            )
        c_owner, c_name = str(repo["owner"]["login"]), str(repo["name"])
        default_branch = str(repo["default_branch"])
        ref = branch or default_branch
        not_found = AppError(ErrorCode.NOT_FOUND, f"Branch '{ref}' not found")
        commit = (
            await self._get(
                f"/repos/{quote(c_owner)}/{quote(c_name)}/commits/{quote(ref, safe='/')}",
                slug,
                overrides={
                    404: not_found,
                    422: not_found,
                    409: AppError(ErrorCode.NO_SOURCE_FILES, f"Repository {slug} is empty"),
                },
            )
        ).json()
        stars = repo.get("stargazers_count")
        return RepoRef(
            owner=c_owner,
            name=c_name,
            default_branch=default_branch,
            branch=ref,
            commit_sha=str(commit["sha"]),
            description=repo.get("description"),
            stars=int(stars) if isinstance(stars, int) else None,
        )

    async def download_snapshot(
        self,
        owner: str,
        name: str,
        commit_sha: str,
        *,
        max_files: int,
        max_file_bytes: int,
        max_tarball_bytes: int,
    ) -> Snapshot:
        slug = f"{owner}/{name}"
        too_large = AppError(
            ErrorCode.REPO_TOO_LARGE,
            f"Repository archive exceeds {max_tarball_bytes // 1_000_000} MB",
            details={"max_tarball_bytes": max_tarball_bytes},
        )
        path = f"/repos/{quote(owner)}/{quote(name)}/tarball/{quote(commit_sha)}"
        resp = await self._get(path, slug, stream=True)
        buf = bytearray()
        try:
            declared = _int_header(resp.headers, "content-length")
            if declared is not None and declared > max_tarball_bytes:
                raise too_large
            async for chunk in resp.aiter_bytes():
                buf += chunk
                if len(buf) > max_tarball_bytes:
                    raise too_large
        except httpx.HTTPError as exc:
            raise AppError(
                ErrorCode.GITHUB_UNAVAILABLE, "Download of the repository archive failed"
            ) from exc
        finally:
            await resp.aclose()
        return await asyncio.to_thread(
            extract_snapshot, bytes(buf), max_files=max_files, max_file_bytes=max_file_bytes
        )

    async def get_rate_limit(self) -> RateLimit:
        """GET /rate_limit (does not count against the quota)."""
        core = (await self._get("/rate_limit", "rate_limit")).json()["resources"]["core"]
        reset = core.get("reset")
        return RateLimit(
            limit=core.get("limit"),
            remaining=core.get("remaining"),
            reset_at=datetime.fromtimestamp(reset, UTC) if isinstance(reset, int) else None,
            authenticated=self._authenticated,
        )

    async def aclose(self) -> None:
        await self._client.aclose()


@lru_cache
def get_github_client() -> GitHubClient:
    """Process-wide singleton built from Settings (FastAPI dependency / worker use)."""
    settings = get_settings()
    token = settings.github_token.get_secret_value() if settings.github_token else None
    return GitHubClient(token or None, settings.github_api_url)
