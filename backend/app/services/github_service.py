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

from dataclasses import dataclass, field
from datetime import datetime


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


class GitHubClient:
    """Wraps one shared `httpx.AsyncClient`. Construct with `token`/`base_url` from Settings."""

    def __init__(self, token: str | None, base_url: str = "https://api.github.com") -> None:
        raise NotImplementedError

    @property
    def last_rate_limit(self) -> RateLimit | None:
        raise NotImplementedError

    async def resolve_ref(self, owner: str, name: str, branch: str | None) -> RepoRef:
        raise NotImplementedError

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
        raise NotImplementedError

    async def get_rate_limit(self) -> RateLimit:
        """GET /rate_limit (does not count against the quota)."""
        raise NotImplementedError

    async def aclose(self) -> None:
        raise NotImplementedError


def get_github_client() -> GitHubClient:
    """Process-wide singleton built from Settings (FastAPI dependency / worker use)."""
    raise NotImplementedError
