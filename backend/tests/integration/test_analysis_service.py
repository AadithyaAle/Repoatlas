import asyncio
import hashlib
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.db.base import utcnow
from app.db.models import Analysis, AnalysisStatus, EdgeRow, FileNode, Repository
from app.db.session import get_sessionmaker
from app.engine import pipeline
from app.engine.types import (
    AnalysisResult,
    CycleReport,
    DependencyGraph,
    Edge,
    FileRole,
    ImportKind,
    Language,
    NodeMetrics,
    ParsedFile,
)
from app.services import analysis_service
from app.services.analysis_service import (
    enqueue_analysis,
    ensure_completed_analysis,
    run_analysis,
)
from app.services.github_service import GitHubClient, RepoRef, Snapshot
from app.workers.analysis_worker import claim_next, worker_loop

SHA = "c" * 40
SOURCES = {"a.py": "import b\n", "b.py": "import a\n", "c.py": "def f():\n    pass\n"}


class FakeGitHub(GitHubClient):
    """Duck-typed GitHubClient returning canned data (no HTTP)."""

    def __init__(
        self,
        sha: str = SHA,
        snapshot: Snapshot | None = None,
        error: Exception | None = None,
    ) -> None:
        self.sha = sha
        self.snapshot = snapshot or Snapshot(
            sources=dict(SOURCES), config_files={}, total_source_files=5, truncated=True
        )
        self.error = error
        self.stars = 7
        self.downloads = 0

    async def resolve_ref(self, owner: str, name: str, branch: str | None) -> RepoRef:
        return RepoRef(
            owner="Octo",
            name="Repo",
            default_branch="main",
            branch=branch or "main",
            commit_sha=self.sha,
            description="demo",
            stars=self.stars,
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
        self.downloads += 1
        if self.error is not None:
            raise self.error
        return self.snapshot


def fake_analyze(sources: dict[str, str], config_files: dict[str, str]) -> AnalysisResult:
    files = {
        p: ParsedFile(
            path=p,
            language=Language.PYTHON,
            loc=s.count("\n"),
            functions=["f"] if p == "c.py" else [],
            parse_warning="recovered" if p == "c.py" else None,
        )
        for p, s in sources.items()
    }
    edges = [
        Edge("a.py", "b.py", ImportKind.STATIC, 1),
        Edge("b.py", "a.py", ImportKind.STATIC, 1),
    ]
    graph = DependencyGraph(
        nodes=sorted(sources),
        edges=edges,
        adjacency={"a.py": ["b.py"], "b.py": ["a.py"]},
        reverse_adjacency={"a.py": ["b.py"], "b.py": ["a.py"]},
    )
    cycles = CycleReport(
        cycles=[["a.py", "b.py"]],
        circular_edges={("a.py", "b.py"), ("b.py", "a.py")},
        circular_nodes={"a.py", "b.py"},
        scc_id_by_node={"a.py": 0, "b.py": 0},
    )
    metrics = {
        "a.py": NodeMetrics("a.py", 1, 1, FileRole.STANDARD, True, 0, 0.4),
        "b.py": NodeMetrics("b.py", 1, 1, FileRole.STANDARD, True, 0, 0.4),
        "c.py": NodeMetrics("c.py", 0, 0, FileRole.ISOLATED, False, None, 0.2),
    }
    return AnalysisResult(files, graph, cycles, metrics, unresolved_imports=2, external_imports=3)


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_service, "analyze_sources", fake_analyze)


async def fetch(db: AsyncSession, analysis_id: uuid.UUID) -> Analysis:
    a = await db.get(Analysis, analysis_id, populate_existing=True)
    assert a is not None
    return a


async def count(db: AsyncSession, model: type[FileNode] | type[EdgeRow], aid: uuid.UUID) -> int:
    n = await db.scalar(select(func.count()).select_from(model).where(model.analysis_id == aid))
    return int(n or 0)


async def enqueue(db: AsyncSession, gh: GitHubClient, *, force: bool = False) -> Analysis:
    return await enqueue_analysis(
        db, repo_url="https://github.com/octo/repo", branch=None, force=force, user_id=None, gh=gh
    )


async def make_analysis(
    db: AsyncSession,
    status: AnalysisStatus = AnalysisStatus.PENDING,
    *,
    locked_at_offset: timedelta | None = None,
    attempts: int = 0,
    created_offset: timedelta = timedelta(0),
) -> uuid.UUID:
    repo = await db.scalar(select(Repository).where(Repository.owner == "Octo"))
    if repo is None:
        repo = Repository(owner="Octo", name="Repo", default_branch="main")
        db.add(repo)
        await db.flush()
    now = utcnow()
    a = Analysis(
        repository_id=repo.id,
        branch="main",
        commit_sha=uuid.uuid4().hex,
        status=status,
        attempts=attempts,
        locked_at=now + locked_at_offset if locked_at_offset is not None else None,
        created_at=now + created_offset,
    )
    db.add(a)
    await db.commit()
    return a.id


# ---------- enqueue ----------


async def test_enqueue_creates_and_dedupes(db_session: AsyncSession) -> None:
    gh = FakeGitHub()
    first = await enqueue(db_session, gh)
    assert first.status == AnalysisStatus.PENDING
    assert (first.repository.owner, first.repository.name) == ("Octo", "Repo")
    assert first.commit_sha == SHA and first.branch == "main"

    gh.stars = 99
    second = await enqueue(db_session, gh)
    assert second.id == first.id
    assert second.repository.stars == 99
    total = await db_session.scalar(select(func.count()).select_from(Analysis))
    assert total == 1
    assert await db_session.scalar(select(func.count()).select_from(Repository)) == 1


async def test_enqueue_invalid_url(db_session: AsyncSession) -> None:
    with pytest.raises(AppError) as exc:
        await enqueue_analysis(
            db_session,
            repo_url="not a url",
            branch=None,
            force=False,
            user_id=None,
            gh=FakeGitHub(),
        )
    assert exc.value.code == ErrorCode.INVALID_REPO_URL


async def test_enqueue_concurrent_race_yields_single_row(db_session: AsyncSession) -> None:
    sm = get_sessionmaker()
    gh = FakeGitHub()

    async def go() -> uuid.UUID:
        async with sm() as s:
            return (await enqueue(s, gh)).id

    ids = await asyncio.gather(go(), go(), go())
    assert len(set(ids)) == 1


async def test_force_rerun_resets_completed(db_session: AsyncSession, engine: None) -> None:
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    assert (await fetch(db_session, a.id)).status == AnalysisStatus.COMPLETED
    assert await count(db_session, FileNode, a.id) == 3

    cached = await enqueue(db_session, gh)  # no force -> cached result
    assert cached.status == AnalysisStatus.COMPLETED

    again = await enqueue(db_session, gh, force=True)
    assert again.id == a.id
    assert again.status == AnalysisStatus.PENDING
    assert again.edge_count is None and again.finished_at is None
    assert await count(db_session, FileNode, a.id) == 0
    assert await count(db_session, EdgeRow, a.id) == 0


async def test_failed_is_requeued_and_in_progress_untouched(db_session: AsyncSession) -> None:
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    a.status, a.error_code = AnalysisStatus.FAILED, "GITHUB_UNAVAILABLE"
    await db_session.commit()
    retry = await enqueue(db_session, gh)
    assert retry.status == AnalysisStatus.PENDING and retry.error_code is None

    retry.status = AnalysisStatus.PARSING_AST
    await db_session.commit()
    forced = await enqueue(db_session, gh, force=True)
    assert forced.status == AnalysisStatus.PARSING_AST


# ---------- run_analysis ----------


async def test_run_analysis_persists_results(db_session: AsyncSession, engine: None) -> None:
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    done = await fetch(db_session, a.id)
    assert done.status == AnalysisStatus.COMPLETED
    assert done.started_at is not None and done.finished_at is not None
    assert done.locked_at is None and done.error_code is None
    assert (done.total_source_files, done.analyzed_files, done.truncated) == (5, 3, True)
    assert (done.edge_count, done.cycle_count, done.parse_warning_count) == (2, 1, 1)
    assert (done.unresolved_imports, done.external_imports) == (2, 3)
    assert done.language_breakdown == {"python": 3}
    assert done.cycles == [["a.py", "b.py"]]

    nodes = (
        await db_session.scalars(
            select(FileNode).where(FileNode.analysis_id == a.id).order_by(FileNode.path)
        )
    ).all()
    assert [n.path for n in nodes] == ["a.py", "b.py", "c.py"]
    c = nodes[2]
    assert (c.role, c.is_circular, c.scc_id, c.parse_warning) == (
        FileRole.ISOLATED,
        False,
        None,
        "recovered",
    )
    assert c.functions == ["f"] and c.loc == 2
    assert c.content_sha256 == hashlib.sha256(SOURCES["c.py"].encode()).hexdigest()
    content = await db_session.scalar(select(FileNode.content).where(FileNode.id == c.id))
    assert content == SOURCES["c.py"]
    assert nodes[0].is_circular and nodes[0].scc_id == 0

    edges = (await db_session.scalars(select(EdgeRow).where(EdgeRow.analysis_id == a.id))).all()
    assert {(e.source_path, e.target_path, e.is_circular) for e in edges} == {
        ("a.py", "b.py", True),
        ("b.py", "a.py", True),
    }


async def test_run_analysis_no_sources(db_session: AsyncSession, engine: None) -> None:
    empty = Snapshot(sources={}, config_files={}, total_source_files=0, truncated=False)
    gh = FakeGitHub(snapshot=empty)
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    done = await fetch(db_session, a.id)
    assert done.status == AnalysisStatus.FAILED
    assert done.error_code == ErrorCode.NO_SOURCE_FILES.value
    assert done.finished_at is not None and done.locked_at is None


async def test_run_analysis_maps_app_error(db_session: AsyncSession, engine: None) -> None:
    gh = FakeGitHub(error=AppError(ErrorCode.REPO_TOO_LARGE, "too big"))
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    done = await fetch(db_session, a.id)
    assert (done.status, done.error_code, done.error_message) == (
        AnalysisStatus.FAILED,
        "REPO_TOO_LARGE",
        "too big",
    )


async def test_run_analysis_unexpected_error_is_internal(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(sources: dict[str, str], config_files: dict[str, str]) -> AnalysisResult:
        raise RuntimeError("secret detail")

    monkeypatch.setattr(analysis_service, "analyze_sources", boom)
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    done = await fetch(db_session, a.id)
    assert done.status == AnalysisStatus.FAILED
    assert done.error_code == ErrorCode.INTERNAL_ERROR.value
    assert done.error_message is not None and "secret" not in done.error_message
    assert await count(db_session, FileNode, a.id) == 0


async def test_run_analysis_with_real_engine(db_session: AsyncSession) -> None:
    """End-to-end with the real engine; until it is implemented this verifies the
    INTERNAL_ERROR path instead."""
    try:
        pipeline.analyze_sources({"x.py": "x = 1\n"}, {})
        implemented = True
    except NotImplementedError:
        implemented = False
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    done = await fetch(db_session, a.id)
    if implemented:
        assert done.status == AnalysisStatus.COMPLETED, done.error_message
        assert done.analyzed_files == 3
        assert await count(db_session, FileNode, a.id) == 3
    else:
        assert done.status == AnalysisStatus.FAILED
        assert done.error_code == ErrorCode.INTERNAL_ERROR.value


# ---------- ensure_completed_analysis ----------


async def test_ensure_completed_reuses_and_runs_inline(
    db_session: AsyncSession, engine: None
) -> None:
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    await run_analysis(db_session, a.id, gh)
    repo = a.repository
    reused = await ensure_completed_analysis(db_session, repo, "main", SHA, gh)
    assert reused.id == a.id and gh.downloads == 1

    new_sha = "d" * 40
    fresh = await ensure_completed_analysis(db_session, repo, "main", new_sha, gh)
    assert fresh.status == AnalysisStatus.COMPLETED and fresh.commit_sha == new_sha
    assert gh.downloads == 2 and fresh.attempts == 1


async def test_ensure_completed_raises_stored_error(db_session: AsyncSession, engine: None) -> None:
    ok = FakeGitHub()
    a = await enqueue(db_session, ok)
    bad = FakeGitHub(error=AppError(ErrorCode.GITHUB_UNAVAILABLE, "down"))
    with pytest.raises(AppError) as exc:
        await ensure_completed_analysis(db_session, a.repository, "main", "e" * 40, bad)
    assert exc.value.code == ErrorCode.GITHUB_UNAVAILABLE and exc.value.message == "down"


# ---------- worker queue ----------


async def test_claim_next_fifo_and_skip_locked(db_session: AsyncSession) -> None:
    older = await make_analysis(db_session, created_offset=timedelta(seconds=-10))
    newer = await make_analysis(db_session)
    sm = get_sessionmaker()
    async with sm() as holder, sm() as claimer:
        # `holder` row-locks the oldest job; the claimer must skip it rather than block.
        await holder.execute(select(Analysis).where(Analysis.id == older).with_for_update())
        assert await asyncio.wait_for(claim_next(claimer), timeout=5) == newer
        await holder.rollback()
        assert await claim_next(claimer) == older
        assert await claim_next(claimer) is None
    claimed = await fetch(db_session, older)
    assert claimed.attempts == 1 and claimed.locked_at is not None
    assert claimed.status == AnalysisStatus.PENDING


async def test_concurrent_claims_never_share_a_row(db_session: AsyncSession) -> None:
    ids = {await make_analysis(db_session) for _ in range(3)}
    sm = get_sessionmaker()

    async def claim() -> uuid.UUID | None:
        async with sm() as s:
            return await claim_next(s)

    results = await asyncio.gather(*(claim() for _ in range(5)))
    claimed = [r for r in results if r is not None]
    assert len(claimed) == len(set(claimed)) == 3
    assert set(claimed) == ids


async def test_stale_lock_recovery(db_session: AsyncSession) -> None:
    await make_analysis(db_session, AnalysisStatus.PARSING_AST, locked_at_offset=timedelta(0))
    await make_analysis(db_session, AnalysisStatus.PENDING, locked_at_offset=timedelta(seconds=-5))
    stale = await make_analysis(
        db_session, AnalysisStatus.COMPUTING_GRAPH, locked_at_offset=timedelta(hours=-2)
    )
    await make_analysis(db_session, AnalysisStatus.COMPLETED)
    assert await claim_next(db_session) == stale
    assert await claim_next(db_session) is None


async def test_attempts_cap_marks_failed(db_session: AsyncSession) -> None:
    aid = await make_analysis(
        db_session, AnalysisStatus.FETCHING_TREE, locked_at_offset=timedelta(hours=-2), attempts=3
    )
    assert await claim_next(db_session) is None
    a = await fetch(db_session, aid)
    assert a.status == AnalysisStatus.FAILED
    assert a.error_code == ErrorCode.INTERNAL_ERROR.value
    assert a.error_message == "Gave up after 3 attempts"


async def test_worker_loop_drains_queue(db_session: AsyncSession, engine: None) -> None:
    gh = FakeGitHub()
    a = await enqueue(db_session, gh)
    stop = asyncio.Event()
    task = asyncio.create_task(worker_loop(stop, gh=gh, sessionmaker=get_sessionmaker()))
    try:
        for _ in range(100):
            if (await fetch(db_session, a.id)).status == AnalysisStatus.COMPLETED:
                break
            await db_session.commit()
            await asyncio.sleep(0.05)
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=5)
    assert (await fetch(db_session, a.id)).status == AnalysisStatus.COMPLETED
