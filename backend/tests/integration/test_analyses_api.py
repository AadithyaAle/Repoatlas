import hashlib
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Analysis, AnalysisStatus, EdgeRow, FileNode, Repository
from app.engine.types import FileRole, ImportKind, Language

SHA = "b" * 40
# Diamond: a -> b, a -> c, b -> d, c -> d
EDGES = [("a.py", "b.py", 1), ("a.py", "c.py", 2), ("b.py", "d.py", 1), ("c.py", "d.py", 1)]
ROLES = {
    "a.py": FileRole.ENTRY_POINT,
    "b.py": FileRole.STANDARD,
    "c.py": FileRole.STANDARD,
    "d.py": FileRole.LEAF,
}


def source(path: str) -> str:
    return f"# {path}\nx = 1\n"


async def seed(db: AsyncSession, status: AnalysisStatus = AnalysisStatus.COMPLETED) -> uuid.UUID:
    repo = Repository(owner="Octo", name="Diamond", default_branch="main")
    db.add(repo)
    await db.flush()
    a = Analysis(
        repository_id=repo.id,
        branch="main",
        commit_sha=SHA,
        status=status,
        cycles=[] if status == AnalysisStatus.COMPLETED else None,
    )
    db.add(a)
    await db.flush()
    if status == AnalysisStatus.COMPLETED:
        for path, role in ROLES.items():
            content = source(path)
            db.add(
                FileNode(
                    analysis_id=a.id,
                    path=path,
                    language=Language.PYTHON,
                    loc=2,
                    in_degree=sum(1 for _, t, _ in EDGES if t == path),
                    out_degree=sum(1 for s, _, _ in EDGES if s == path),
                    role=role,
                    pagerank=0.25,
                    is_circular=False,
                    scc_id=None,
                    exports=[],
                    functions=["f"] if path == "a.py" else [],
                    classes=[],
                    content_sha256=hashlib.sha256(content.encode()).hexdigest(),
                    content=content,
                )
            )
        for s, t, line in EDGES:
            db.add(
                EdgeRow(
                    analysis_id=a.id,
                    source_path=s,
                    target_path=t,
                    kind=ImportKind.STATIC,
                    line=line,
                    is_circular=False,
                )
            )
    await db.commit()
    return a.id


def url(aid: uuid.UUID | str, suffix: str = "") -> str:
    return f"/api/v1/analyses/{aid}{suffix}"


async def test_get_analysis(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    aid = await seed(db_session, AnalysisStatus.PENDING)
    res = await client.get(url(aid))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["id"] == str(aid) and data["status"] == "PENDING"
    assert data["repository"]["owner"] == "Octo" and data["commit_sha"] == SHA


async def test_unknown_analysis_404(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    for suffix in ("", "/graph", "/file?path=a.py", "/blast-radius?path=a.py"):
        res = await client.get(url(uuid.uuid4(), suffix))
        assert res.status_code == 404, suffix
        assert res.json()["error"]["code"] == "NOT_FOUND"


async def test_bad_uuid_422(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    res = await client.get(url("not-a-uuid", "/graph"))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_not_ready_409(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    aid = await seed(db_session, AnalysisStatus.PENDING)
    for suffix in ("/graph", "/file?path=a.py", "/blast-radius?path=a.py"):
        res = await client.get(url(aid, suffix))
        assert res.status_code == 409, suffix
        error = res.json()["error"]
        assert error["code"] == "ANALYSIS_NOT_READY"
        assert error["details"] == {"status": "PENDING"}


async def test_graph(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    aid = await seed(db_session)
    res = await client.get(url(aid, "/graph"))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["analysis_id"] == str(aid) and data["commit_sha"] == SHA
    assert data["cycles"] == []
    assert [n["path"] for n in data["nodes"]] == ["a.py", "b.py", "c.py", "d.py"]
    a = data["nodes"][0]
    assert a == {
        "path": "a.py",
        "language": "python",
        "loc": 2,
        "in_degree": 0,
        "out_degree": 2,
        "role": "ENTRY_POINT",
        "pagerank": 0.25,
        "is_circular": False,
        "scc_id": None,
        "parse_warning": None,
        "exports": [],
        "functions": ["f"],
        "classes": [],
    }
    assert data["nodes"][3]["in_degree"] == 2 and data["nodes"][3]["role"] == "LEAF"
    assert [(e["source"], e["target"], e["line"]) for e in data["edges"]] == EDGES
    assert all(e["kind"] == "static" and e["is_circular"] is False for e in data["edges"])


async def test_file_content_and_permalink(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    aid = await seed(db_session)
    res = await client.get(url(aid, "/file"), params={"path": "b.py"})
    assert res.status_code == 200
    assert res.json()["data"] == {
        "path": "b.py",
        "language": "python",
        "commit_sha": SHA,
        "content": source("b.py"),
        "loc": 2,
        "html_url": f"https://github.com/Octo/Diamond/blob/{SHA}/b.py",
    }


async def test_file_not_in_snapshot(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    aid = await seed(db_session)
    for suffix in ("/file", "/blast-radius"):
        res = await client.get(url(aid, suffix), params={"path": "missing.py"})
        assert res.status_code == 404, suffix
        error = res.json()["error"]
        assert error["code"] == "FILE_NOT_IN_SNAPSHOT"
        assert error["details"] == {"path": "missing.py"}


async def test_file_path_required(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    aid = await seed(db_session)
    res = await client.get(url(aid, "/file"))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_blast_radius_diamond(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    aid = await seed(db_session)
    res = await client.get(url(aid, "/blast-radius"), params={"path": "d.py"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["target"] == "d.py"
    assert data["direct_dependents"] == ["b.py", "c.py"]
    assert data["transitive_dependents"] == ["a.py"]
    assert data["depth_by_path"] == {"a.py": 2, "b.py": 1, "c.py": 1}
    assert data["max_depth"] == 2
    assert data["impact_percentage"] == 100.0
    # (1/1 + 1/1 + 1/2) / 3 * 100
    assert data["risk_score"] == 83.33
    assert data["risk_level"] == "CRITICAL"
    assert data["total_files"] == 4


async def test_blast_radius_root_has_no_dependents(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    aid = await seed(db_session)
    res = await client.get(url(aid, "/blast-radius"), params={"path": "a.py"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["direct_dependents"] == [] and data["transitive_dependents"] == []
    assert data["depth_by_path"] == {} and data["max_depth"] == 0
    assert (data["risk_score"], data["risk_level"]) == (0.0, "LOW")
