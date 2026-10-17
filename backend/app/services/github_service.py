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
