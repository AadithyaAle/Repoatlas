"""PostgreSQL data model.

repositories 1─* analyses 1─* file_nodes
                          1─* edges
repositories 1─* tours 1─* tour_steps 1─* user_step_progress
             tours 1─* tour_sync_runs
`analyses` doubles as the durable job queue (status PENDING is claimed with
SELECT ... FOR UPDATE SKIP LOCKED by the worker).
User identity comes from Supabase Auth: `*_user_id` columns hold the JWT `sub` (UUID).
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from app.db.base import Base, TimestampMixin, utcnow
from app.engine.types import DriftStatus, FileRole, ImportKind, Language


class AnalysisStatus(StrEnum):
    PENDING = "PENDING"
    FETCHING_TREE = "FETCHING_TREE"
    PARSING_AST = "PARSING_AST"
    COMPUTING_GRAPH = "COMPUTING_GRAPH"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class TourVisibility(StrEnum):
    PUBLIC = "PUBLIC"
    PRIVATE = "PRIVATE"


def _enum(e: type[StrEnum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x])


class Repository(TimestampMixin, Base):
    __tablename__ = "repositories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    default_branch: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    stars: Mapped[int | None] = mapped_column(Integer)

    analyses: Mapped[list["Analysis"]] = relationship(back_populates="repository")
    tours: Mapped[list["Tour"]] = relationship(back_populates="repository")

    __table_args__ = (UniqueConstraint("owner", "name", name="uq_repositories_owner_name"),)


class Analysis(TimestampMixin, Base):
    __tablename__ = "analyses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[AnalysisStatus] = mapped_column(
        _enum(AnalysisStatus, "analysis_status"), default=AnalysisStatus.PENDING, nullable=False
    )
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    # Job-queue bookkeeping
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Results summary
    total_source_files: Mapped[int | None] = mapped_column(Integer)  # before cap
    analyzed_files: Mapped[int | None] = mapped_column(Integer)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    edge_count: Mapped[int | None] = mapped_column(Integer)
    cycle_count: Mapped[int | None] = mapped_column(Integer)
    parse_warning_count: Mapped[int | None] = mapped_column(Integer)
    unresolved_imports: Mapped[int | None] = mapped_column(Integer)
    external_imports: Mapped[int | None] = mapped_column(Integer)
    language_breakdown: Mapped[dict[str, int] | None] = mapped_column(JSONB(none_as_null=True))
    cycles: Mapped[list[list[str]] | None] = mapped_column(JSONB(none_as_null=True))

    repository: Mapped[Repository] = relationship(back_populates="analyses")
    files: Mapped[list["FileNode"]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("repository_id", "commit_sha", name="uq_analyses_repo_commit"),
        Index("ix_analyses_status_created", "status", "created_at"),
    )


class FileNode(Base):
    __tablename__ = "file_nodes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    language: Mapped[Language] = mapped_column(_enum(Language, "language"), nullable=False)
    loc: Mapped[int] = mapped_column(Integer, nullable=False)
    in_degree: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    out_degree: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    role: Mapped[FileRole] = mapped_column(_enum(FileRole, "file_role"), nullable=False)
    pagerank: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_circular: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scc_id: Mapped[int | None] = mapped_column(Integer)
    parse_warning: Mapped[str | None] = mapped_column(Text)
    exports: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    functions: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    classes: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = deferred(mapped_column(Text, nullable=False))

    analysis: Mapped[Analysis] = relationship(back_populates="files")

    __table_args__ = (UniqueConstraint("analysis_id", "path", name="uq_file_nodes_analysis_path"),)


class EdgeRow(Base):
    __tablename__ = "edges"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    target_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    kind: Mapped[ImportKind] = mapped_column(_enum(ImportKind, "import_kind"), nullable=False)
    line: Mapped[int] = mapped_column(Integer, nullable=False)
    is_circular: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "analysis_id", "source_path", "target_path", name="uq_edges_analysis_source_target"
        ),
    )


class Tour(TimestampMixin, Base):
    __tablename__ = "tours"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analyses.id", ondelete="RESTRICT"), nullable=False
    )  # snapshot the tour currently points at (moves forward on sync)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    owner_login: Mapped[str | None] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[TourVisibility] = mapped_column(
        _enum(TourVisibility, "tour_visibility"), default=TourVisibility.PUBLIC, nullable=False
    )
    base_commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    repository: Mapped[Repository] = relationship(back_populates="tours")
    steps: Mapped[list["TourStep"]] = relationship(
        back_populates="tour", cascade="all, delete-orphan", order_by="TourStep.position"
    )
    sync_runs: Mapped[list["TourSyncRun"]] = relationship(
        back_populates="tour", cascade="all, delete-orphan"
    )


class TourStep(TimestampMixin, Base):
    __tablename__ = "tour_steps"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tour_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tours.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, default="", nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    snippet_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    snippet_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    # {"question": str, "options": [str, ...], "correct_index": int, "explanation": str | None}
    checkpoint: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))

    drift_status: Mapped[DriftStatus] = mapped_column(
        _enum(DriftStatus, "drift_status"), default=DriftStatus.UNVERIFIED, nullable=False
    )
    drift_similarity: Mapped[float | None] = mapped_column(Float)
    proposed_start_line: Mapped[int | None] = mapped_column(Integer)
    proposed_end_line: Mapped[int | None] = mapped_column(Integer)
    proposed_snippet: Mapped[str | None] = mapped_column(Text)
    drift_diff: Mapped[str | None] = mapped_column(Text)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_checked_commit_sha: Mapped[str | None] = mapped_column(String(40))

    tour: Mapped[Tour] = relationship(back_populates="steps")

    __table_args__ = (
        UniqueConstraint(
            "tour_id",
            "position",
            name="uq_tour_steps_tour_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("start_line >= 1 AND end_line >= start_line", name="valid_line_range"),
    )


class TourSyncRun(Base):
    __tablename__ = "tour_sync_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tour_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tours.id", ondelete="CASCADE"), nullable=False, index=True
    )
    triggered_by_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    from_commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    to_commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    counts: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)  # DriftStatus -> n
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    tour: Mapped[Tour] = relationship(back_populates="sync_runs")


class UserStepProgress(Base):
    __tablename__ = "user_step_progress"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    user_login: Mapped[str | None] = mapped_column(String(100))
    tour_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tours.id", ondelete="CASCADE"), nullable=False
    )
    step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tour_steps.id", ondelete="CASCADE"), nullable=False
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    first_try_correct: Mapped[bool | None] = mapped_column(Boolean)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "step_id", name="uq_user_step_progress_user_step"),
        Index("ix_user_step_progress_tour_user", "tour_id", "user_id"),
    )
