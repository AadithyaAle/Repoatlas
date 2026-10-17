"""Durable DB-backed analysis worker.

The `analyses` table is the queue: rows that are PENDING, or mid-pipeline with a stale lock (the
worker died), are claimed with `SELECT ... FOR UPDATE SKIP LOCKED`, so any number of workers can
run safely. Run standalone with `python -m app.workers.analysis_worker`, or embedded in the API
process via `start_embedded_worker` / `stop_embedded_worker`.
"""

import asyncio
import contextlib
import logging
import signal
import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.errors import ErrorCode
from app.db.base import utcnow
from app.db.models import Analysis, AnalysisStatus
from app.db.session import get_engine, get_sessionmaker
from app.services.analysis_service import ACTIVE_STATUSES, run_analysis, stale_cutoff
from app.services.github_service import GitHubClient, get_github_client

logger = logging.getLogger(__name__)

CONCURRENCY = 1
MAX_ATTEMPTS = 3
SHUTDOWN_GRACE_SECONDS = 30.0


async def claim_next(db: AsyncSession) -> uuid.UUID | None:
    """Lock the oldest claimable analysis, stamp `locked_at`, bump `attempts`, commit.

    Jobs that already used MAX_ATTEMPTS are marked FAILED and skipped."""
    while True:
        stmt = (
            select(Analysis)
            .where(
                Analysis.status.in_(ACTIVE_STATUSES),
                or_(Analysis.locked_at.is_(None), Analysis.locked_at < stale_cutoff()),
            )
            .order_by(Analysis.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        a = (await db.execute(stmt)).scalar_one_or_none()
        if a is None:
            await db.commit()
            return None
        now = utcnow()
        a.attempts += 1
        if a.attempts > MAX_ATTEMPTS:
            a.status = AnalysisStatus.FAILED
            a.error_code = ErrorCode.INTERNAL_ERROR.value
            a.error_message = f"Gave up after {MAX_ATTEMPTS} attempts"
            a.locked_at = None
            a.finished_at = now
            await db.commit()
            logger.warning("analysis %s gave up after %d attempts", a.id, MAX_ATTEMPTS)
            continue
        a.locked_at = now
        await db.commit()
        logger.info("claimed analysis %s (attempt %d)", a.id, a.attempts)
        return a.id


async def _drain(
    sessionmaker: async_sessionmaker[AsyncSession], gh: GitHubClient, stop: asyncio.Event
) -> None:
    while not stop.is_set():
        async with sessionmaker() as db:
            analysis_id = await claim_next(db)
            if analysis_id is None:
                return
            await run_analysis(db, analysis_id, gh)


async def worker_loop(
    stop: asyncio.Event,
    *,
    gh: GitHubClient | None = None,
    sessionmaker: async_sessionmaker[AsyncSession] | None = None,
) -> None:
    """Poll for jobs until `stop` is set. A running job always finishes before exit."""
    settings = get_settings()
    client = gh or get_github_client()
    sm = sessionmaker or get_sessionmaker()
    logger.info("analysis worker started (poll=%.1fs)", settings.worker_poll_seconds)
    while not stop.is_set():
        try:
            await asyncio.gather(*(_drain(sm, client, stop) for _ in range(CONCURRENCY)))
        except Exception:
            logger.exception("analysis worker iteration failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=settings.worker_poll_seconds)
    logger.info("analysis worker stopped")


def start_embedded_worker() -> tuple[asyncio.Task[None], asyncio.Event]:
    stop = asyncio.Event()
    task = asyncio.create_task(worker_loop(stop), name="analysis-worker")
    return task, stop


async def stop_embedded_worker(task: asyncio.Task[None], stop_event: asyncio.Event) -> None:
    stop_event.set()
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=SHUTDOWN_GRACE_SECONDS)
    except TimeoutError:
        logger.warning("analysis worker did not stop in time; cancelling")
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def _main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    try:
        await worker_loop(stop)
    finally:
        await get_github_client().aclose()
        await get_engine().dispose()


if __name__ == "__main__":
    logging.basicConfig(
        level=get_settings().log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    asyncio.run(_main())
