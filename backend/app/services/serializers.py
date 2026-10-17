"""ORM -> API schema conversion shared by all routes. Keeps authorization-sensitive
projection (checkpoint answers) in one place."""

from collections import Counter
from collections.abc import Iterable

from app.db.models import Analysis, Repository, TourStep
from app.engine.types import DriftStatus
from app.schemas.atlas import (
    AnalysisOut,
    CheckpointOwnerOut,
    CheckpointPublicOut,
    RepositoryOut,
    StepOut,
)


def repo_html_url(owner: str, name: str) -> str:
    return f"https://github.com/{owner}/{name}"


def file_permalink(owner: str, name: str, commit_sha: str, path: str, lines: str = "") -> str:
    anchor = f"#L{lines}" if lines else ""
    return f"https://github.com/{owner}/{name}/blob/{commit_sha}/{path}{anchor}"


def repository_out(repo: Repository) -> RepositoryOut:
    return RepositoryOut(
        id=repo.id,
        owner=repo.owner,
        name=repo.name,
        default_branch=repo.default_branch,
        description=repo.description,
        stars=repo.stars,
        html_url=repo_html_url(repo.owner, repo.name),
    )


def analysis_out(analysis: Analysis) -> AnalysisOut:
    """`analysis.repository` must be loaded (selectinload / joinedload)."""
    return AnalysisOut.model_validate(
        {
            **{c: getattr(analysis, c) for c in AnalysisOut.model_fields if c != "repository"},
            "repository": repository_out(analysis.repository),
        }
    )


def checkpoint_out(
    checkpoint: dict[str, object] | None, *, is_owner: bool
) -> CheckpointOwnerOut | CheckpointPublicOut | None:
    """Trainees never receive `correct_index` / `explanation`."""
    if not checkpoint:
        return None
    if is_owner:
        return CheckpointOwnerOut.model_validate(checkpoint)
    return CheckpointPublicOut(
        question=str(checkpoint["question"]),
        options=[str(o) for o in checkpoint["options"]],  # type: ignore[attr-defined]
    )


def step_out(step: TourStep, *, is_owner: bool) -> StepOut:
    return StepOut(
        id=step.id,
        position=step.position,
        title=step.title,
        body_markdown=step.body_markdown,
        file_path=step.file_path,
        start_line=step.start_line,
        end_line=step.end_line,
        snippet_snapshot=step.snippet_snapshot,
        snippet_hash=step.snippet_hash,
        checkpoint=checkpoint_out(step.checkpoint, is_owner=is_owner),
        drift_status=step.drift_status,
        drift_similarity=step.drift_similarity,
        proposed_start_line=step.proposed_start_line,
        proposed_end_line=step.proposed_end_line,
        proposed_snippet=step.proposed_snippet,
        drift_diff=step.drift_diff,
        last_checked_at=step.last_checked_at,
    )


def health_counts(statuses: Iterable[DriftStatus]) -> dict[DriftStatus, int]:
    """Count per drift status; every status present (0 when absent) for stable UIs."""
    counts = Counter(statuses)
    return {s: counts.get(s, 0) for s in DriftStatus}
