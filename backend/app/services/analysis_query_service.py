"""Read-side queries over a COMPLETED analysis: graph, file content and blast radius."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.db.models import EdgeRow, FileNode
from app.engine.graph_algorithms import blast_radius, risk_level
from app.schemas.atlas import BlastRadiusOut, FileContentOut, GraphEdgeOut, GraphNodeOut, GraphOut
from app.services import graph_service, serializers


async def get_graph(db: AsyncSession, analysis_id: uuid.UUID) -> GraphOut:
    analysis = await graph_service.get_completed_analysis(db, analysis_id)
    nodes = await db.scalars(  # `content` is deferred and never loaded here
        select(FileNode).where(FileNode.analysis_id == analysis_id).order_by(FileNode.path)
    )
    edges = await db.scalars(
        select(EdgeRow)
        .where(EdgeRow.analysis_id == analysis_id)
        .order_by(EdgeRow.source_path, EdgeRow.target_path)
    )
    return GraphOut(
        analysis_id=analysis.id,
        commit_sha=analysis.commit_sha,
        nodes=[GraphNodeOut.model_validate(n) for n in nodes],
        edges=[
            GraphEdgeOut(
                source=e.source_path,
                target=e.target_path,
                kind=e.kind,
                line=e.line,
                is_circular=e.is_circular,
            )
            for e in edges
        ],
        cycles=analysis.cycles or [],
    )


async def get_file(db: AsyncSession, analysis_id: uuid.UUID, path: str) -> FileContentOut:
    analysis = await graph_service.get_completed_analysis(db, analysis_id)
    node = await graph_service.get_file_node(db, analysis_id, path)
    repo = analysis.repository
    return FileContentOut(
        path=node.path,
        language=node.language,
        commit_sha=analysis.commit_sha,
        content=node.content,
        loc=node.loc,
        html_url=serializers.file_permalink(repo.owner, repo.name, analysis.commit_sha, node.path),
    )


async def get_blast_radius(db: AsyncSession, analysis_id: uuid.UUID, path: str) -> BlastRadiusOut:
    await graph_service.get_completed_analysis(db, analysis_id)
    graph = await graph_service.load_graph(db, analysis_id)
    if path not in graph.reverse_adjacency:
        raise AppError(
            ErrorCode.FILE_NOT_IN_SNAPSHOT,
            f"'{path}' is not part of this analysis",
            details={"path": path},
        )
    result = blast_radius(graph, path)
    return BlastRadiusOut(
        target=result.target,
        direct_dependents=result.direct_dependents,
        transitive_dependents=result.transitive_dependents,
        depth_by_path=result.depth_by_path,
        max_depth=result.max_depth,
        impact_percentage=result.impact_percentage,
        risk_score=result.risk_score,
        risk_level=risk_level(result.risk_score),
        total_files=len(graph.nodes),
    )
