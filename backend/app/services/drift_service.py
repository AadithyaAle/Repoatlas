"""Workflow 4 — "Sync & Verify Tour Health".

`sync_tour` resolves the latest commit of the tour's branch, makes sure that commit is analyzed
(reusing the cached analysis when nothing changed), re-evaluates every step anchor against the
new file contents with `drift_detector.evaluate_step`, auto-heals moved snippets, records
proposals for changed ones, moves the tour forward and stores a `TourSyncRun`.
`resolve_step` lets the owner settle a step that needs review.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.core.errors import AppError, ErrorCode
from app.core.security import CurrentUser
from app.db.base import utcnow
from app.db.models import FileNode, TourStep, TourSyncRun
from app.engine.drift_detector import evaluate_step
from app.engine.types import DriftResult, DriftStatus, StepAnchor
from app.schemas.atlas import ResolveDriftRequest, StepOut, SyncReportOut, SyncStepResult
from app.services import analysis_service, graph_service, tour_service
from app.services.github_service import GitHubClient
from app.services.serializers import health_counts, step_out

_REVIEWABLE = (DriftStatus.OUTDATED_NEEDS_REVIEW, DriftStatus.BROKEN_FILE_DELETED)


def _clear_proposal(step: TourStep) -> None:
    step.proposed_start_line = None
    step.proposed_end_line = None
    step.proposed_snippet = None
    step.drift_diff = None


def _apply(step: TourStep, result: DriftResult) -> None:
    if result.status == DriftStatus.DRIFTED_AUTO_FIXED:
        assert result.start_line is not None and result.end_line is not None
        step.start_line, step.end_line = result.start_line, result.end_line
        if result.current_snippet is not None:
            step.snippet_snapshot = result.current_snippet  # same normalized text -> same hash
        _clear_proposal(step)
    elif result.status == DriftStatus.OUTDATED_NEEDS_REVIEW:
        step.proposed_start_line = result.start_line
        step.proposed_end_line = result.end_line
        step.proposed_snippet = result.current_snippet
        step.drift_diff = result.unified_diff
    else:  # HEALTHY, BROKEN_FILE_DELETED: keep the pinned lines
        _clear_proposal(step)
    step.drift_status = result.status
    step.drift_similarity = result.similarity


async def _contents(db: AsyncSession, analysis_id: uuid.UUID, paths: set[str]) -> dict[str, str]:
    if not paths:
        return {}
    nodes = await db.scalars(
        select(FileNode)
        .options(undefer(FileNode.content))
        .where(FileNode.analysis_id == analysis_id, FileNode.path.in_(paths))
    )
    return {n.path: n.content for n in nodes}


async def sync_tour(
    db: AsyncSession, tour_id: uuid.UUID, user: CurrentUser, gh: GitHubClient
) -> SyncReportOut:
    tour = await tour_service.get_owned_tour(db, tour_id, user)
    current = await graph_service.get_analysis(db, tour.analysis_id)
    repo = tour.repository
    ref = await gh.resolve_ref(repo.owner, repo.name, current.branch)
    latest = ref.commit_sha
    new_analysis = await analysis_service.ensure_completed_analysis(
        db, repo, current.branch, latest, gh
    )
    # ensure_completed_analysis commits (and may run the pipeline); reload a fresh tour.
    tour = await tour_service.get_owned_tour(db, tour_id, user, steps=True)
    steps = tour_service.ordered_steps(tour)
    contents = await _contents(db, new_analysis.id, {s.file_path for s in steps})

    now = utcnow()
    results: list[SyncStepResult] = []
    for step in steps:
        previous, old_start, old_end = step.drift_status, step.start_line, step.end_line
        anchor = StepAnchor(
            file_path=step.file_path,
            start_line=step.start_line,
            end_line=step.end_line,
            snippet_hash=step.snippet_hash,
            snippet_snapshot=step.snippet_snapshot,
        )
        result = evaluate_step(anchor, contents.get(step.file_path))
        _apply(step, result)
        step.last_checked_at = now
        step.last_checked_commit_sha = latest
        results.append(
            SyncStepResult(
                step_id=step.id,
                position=step.position,
                title=step.title,
                file_path=step.file_path,
                previous_status=previous,
                status=result.status,
                old_start_line=old_start,
                old_end_line=old_end,
                new_start_line=result.start_line,
                new_end_line=result.end_line,
                similarity=result.similarity,
            )
        )

    counts = health_counts(r.status for r in results)
    previous_base = tour.base_commit_sha
    tour.analysis_id = new_analysis.id
    tour.base_commit_sha = latest
    tour.last_synced_at = now
    db.add(
        TourSyncRun(
            tour_id=tour.id,
            triggered_by_user_id=user.id,
            from_commit_sha=previous_base,
            to_commit_sha=latest,
            counts={s.value: n for s, n in counts.items()},
            created_at=now,
        )
    )
    await db.commit()
    return SyncReportOut(
        tour_id=tour.id,
        from_commit_sha=previous_base,
        to_commit_sha=latest,
        new_analysis_id=new_analysis.id,
        up_to_date=previous_base == latest,
        counts=counts,
        steps=results,
        synced_at=now,
    )


async def resolve_step(
    db: AsyncSession,
    tour_id: uuid.UUID,
    step_id: uuid.UUID,
    body: ResolveDriftRequest,
    user: CurrentUser,
) -> StepOut:
    tour = await tour_service.get_owned_tour(db, tour_id, user, steps=True)
    step = tour_service.find_step(tour, step_id)
    if body.action != "repin" and step.drift_status not in _REVIEWABLE:
        raise AppError(
            ErrorCode.CONFLICT,
            f"Step is {step.drift_status.value}; nothing to resolve",
            details={"drift_status": step.drift_status.value},
        )

    if body.action == "repin":
        assert body.start_line is not None and body.end_line is not None  # schema-validated
        start, end = body.start_line, body.end_line
        content = (await graph_service.get_file_node(db, tour.analysis_id, step.file_path)).content
    else:
        if body.action == "accept_proposed":
            if step.proposed_start_line is None or step.proposed_end_line is None:
                raise AppError(ErrorCode.CONFLICT, "There is no proposed location to accept")
            start, end = step.proposed_start_line, step.proposed_end_line
        else:  # keep_original
            start, end = step.start_line, step.end_line
        found = await db.scalar(
            select(FileNode.content).where(
                FileNode.analysis_id == tour.analysis_id, FileNode.path == step.file_path
            )
        )
        if found is None:
            raise AppError(
                ErrorCode.CONFLICT, "File no longer exists; re-pin the step to another range"
            )
        content = found

    snippet, digest = tour_service.pin_snippet(content, start, end)
    now = utcnow()
    step.start_line, step.end_line = start, end
    step.snippet_snapshot, step.snippet_hash = snippet, digest
    step.drift_status = DriftStatus.HEALTHY
    step.drift_similarity = 1.0
    step.last_checked_at = now
    step.last_checked_commit_sha = tour.base_commit_sha
    _clear_proposal(step)
    tour.updated_at = now
    await db.commit()
    return step_out(step, is_owner=True)
