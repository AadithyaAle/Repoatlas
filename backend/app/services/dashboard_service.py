"""Personal dashboard: repo analytics, health of owned tours (with trainees) and own learning."""

import asyncio
import uuid
from collections import defaultdict

from sqlalchemy import Integer, cast, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import CurrentUser
from app.db.models import (
    Analysis,
    AnalysisStatus,
    FileNode,
    Tour,
    TourStep,
    TourSyncRun,
    TourVisibility,
    UserStepProgress,
)
from app.engine.graph_algorithms import risk_level, top_risky_files
from app.engine.types import BlastRadiusResult, DriftStatus, FileRole
from app.schemas.atlas import (
    BlastRadiusOut,
    DashboardOut,
    RepoAnalyticsOut,
    SyncRunOut,
    TourHealthOut,
    TourProgressOut,
    TraineeProgressOut,
)
from app.services import graph_service, tour_service
from app.services.progress_service import progress_out
from app.services.serializers import repository_out

MAX_REPOS = 10
MAX_SYNC_RUNS = 10
RISKIEST_FILES = 5
_HEALTHY = (DriftStatus.HEALTHY, DriftStatus.DRIFTED_AUTO_FIXED)


def _blast_out(r: BlastRadiusResult, total_files: int) -> BlastRadiusOut:
    return BlastRadiusOut(
        target=r.target,
        direct_dependents=r.direct_dependents,
        transitive_dependents=r.transitive_dependents,
        depth_by_path=r.depth_by_path,
        max_depth=r.max_depth,
        impact_percentage=r.impact_percentage,
        risk_score=r.risk_score,
        risk_level=risk_level(r.risk_score),
        total_files=total_files,
    )


async def _repos(db: AsyncSession, user: CurrentUser) -> list[RepoAnalyticsOut]:
    requested = select(Analysis.repository_id).where(Analysis.requested_by_user_id == user.id)
    toured = select(Tour.repository_id).where(Tour.owner_user_id == user.id)
    latest = (
        await db.scalars(
            select(Analysis)
            .options(selectinload(Analysis.repository))
            .where(
                Analysis.status == AnalysisStatus.COMPLETED,
                or_(Analysis.repository_id.in_(requested), Analysis.repository_id.in_(toured)),
            )
            .ext(distinct_on(Analysis.repository_id))  # latest per repository
            .order_by(Analysis.repository_id, Analysis.created_at.desc())
        )
    ).all()
    analyses = sorted(latest, key=lambda a: a.created_at, reverse=True)[:MAX_REPOS]
    if not analyses:
        return []

    roles: dict[uuid.UUID, dict[FileRole, int]] = defaultdict(dict)
    rows = await db.execute(
        select(FileNode.analysis_id, FileNode.role, func.count())
        .where(FileNode.analysis_id.in_([a.id for a in analyses]))
        .group_by(FileNode.analysis_id, FileNode.role)
    )
    for analysis_id, role, n in rows:
        roles[analysis_id][role] = int(n)

    out: list[RepoAnalyticsOut] = []
    for a in analyses:
        breakdown = {r: roles[a.id].get(r, 0) for r in FileRole}
        graph = await graph_service.load_graph(db, a.id)
        risky = await asyncio.to_thread(top_risky_files, graph, RISKIEST_FILES)
        out.append(
            RepoAnalyticsOut(
                repository=repository_out(a.repository),
                analysis_id=a.id,
                commit_sha=a.commit_sha,
                analyzed_files=a.analyzed_files or 0,
                edge_count=a.edge_count or 0,
                cycle_count=a.cycle_count or 0,
                god_modules=breakdown[FileRole.GOD_MODULE],
                entry_points=breakdown[FileRole.ENTRY_POINT],
                riskiest_files=[_blast_out(r, len(graph.nodes)) for r in risky],
                role_breakdown=breakdown,
                language_breakdown=a.language_breakdown or {},
            )
        )
    return out


async def _tours(db: AsyncSession, user: CurrentUser) -> list[TourHealthOut]:
    tours = (
        await db.scalars(
            select(Tour)
            .options(selectinload(Tour.repository))
            .where(Tour.owner_user_id == user.id)
            .order_by(Tour.updated_at.desc(), Tour.id)
        )
    ).all()
    if not tours:
        return []
    ids = [t.id for t in tours]
    health = await tour_service.health_by_tour(db, ids)

    rank = (
        func.row_number()
        .over(partition_by=TourSyncRun.tour_id, order_by=TourSyncRun.created_at.desc())
        .label("rn")
    )
    ranked = select(TourSyncRun.id, rank).where(TourSyncRun.tour_id.in_(ids)).subquery()
    runs: dict[uuid.UUID, list[SyncRunOut]] = defaultdict(list)
    for run in await db.scalars(
        select(TourSyncRun)
        .join(ranked, ranked.c.id == TourSyncRun.id)
        .where(ranked.c.rn <= MAX_SYNC_RUNS)
        .order_by(TourSyncRun.created_at.desc())
    ):
        runs[run.tour_id].append(
            SyncRunOut(
                id=run.id,
                from_commit_sha=run.from_commit_sha,
                to_commit_sha=run.to_commit_sha,
                counts={DriftStatus(k): v for k, v in run.counts.items()},
                created_at=run.created_at,
            )
        )

    p = UserStepProgress
    trainees: dict[uuid.UUID, list[TraineeProgressOut]] = defaultdict(list)
    rows = await db.execute(
        select(
            p.tour_id,
            p.user_id,
            func.max(p.user_login),
            func.count().filter(p.completed.is_(True)),
            func.avg(cast(p.first_try_correct, Integer)),  # AVG ignores NULLs
            func.max(p.updated_at),
        )
        .where(p.tour_id.in_(ids))
        .group_by(p.tour_id, p.user_id)
        .order_by(func.max(p.updated_at).desc())
    )
    for tour_id, user_id, login, completed, accuracy, last_activity in rows:
        trainees[tour_id].append(
            TraineeProgressOut(
                user_id=user_id,
                user_login=login,
                completed_steps=int(completed),
                total_steps=health[tour_id].total(),
                first_try_accuracy=round(float(accuracy), 4) if accuracy is not None else None,
                last_activity_at=last_activity,
            )
        )

    out: list[TourHealthOut] = []
    for t in tours:
        counts = health[t.id]
        total = counts.total()
        healthy = sum(counts[s] for s in _HEALTHY)
        out.append(
            TourHealthOut(
                tour=tour_service.summary_out(t, counts.elements()),
                health_score=round(healthy / total * 100, 1) if total else 0.0,
                sync_history=runs[t.id],
                trainees=trainees[t.id],
            )
        )
    return out


async def _learning(db: AsyncSession, user: CurrentUser) -> list[TourProgressOut]:
    p = UserStepProgress
    tour_ids = list(
        await db.scalars(
            select(p.tour_id)
            .join(Tour, Tour.id == p.tour_id)
            .where(
                p.user_id == user.id,
                Tour.owner_user_id != user.id,
                Tour.visibility == TourVisibility.PUBLIC,
            )
            .group_by(p.tour_id)
            .order_by(func.max(p.updated_at).desc())
        )
    )
    if not tour_ids:
        return []
    steps: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for tour_id, step_id in await db.execute(
        select(TourStep.tour_id, TourStep.id)
        .where(TourStep.tour_id.in_(tour_ids))
        .order_by(TourStep.tour_id, TourStep.position)
    ):
        steps[tour_id].append(step_id)
    completed = set(
        await db.scalars(
            select(p.step_id).where(
                p.user_id == user.id, p.tour_id.in_(tour_ids), p.completed.is_(True)
            )
        )
    )
    return [progress_out(tid, steps[tid], completed) for tid in tour_ids]


async def get_dashboard(db: AsyncSession, user: CurrentUser) -> DashboardOut:
    return DashboardOut(
        repos=await _repos(db, user),
        tours=await _tours(db, user),
        learning=await _learning(db, user),
    )
