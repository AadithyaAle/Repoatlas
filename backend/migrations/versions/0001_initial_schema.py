"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-17 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ANALYSIS_STATUS = sa.Enum(
    "PENDING",
    "FETCHING_TREE",
    "PARSING_AST",
    "COMPUTING_GRAPH",
    "COMPLETED",
    "FAILED",
    name="analysis_status",
)
LANGUAGE = sa.Enum("python", "javascript", "typescript", name="language")
FILE_ROLE = sa.Enum(
    "ENTRY_POINT", "CORE_UTILITY", "GOD_MODULE", "LEAF", "ISOLATED", "STANDARD", name="file_role"
)
IMPORT_KIND = sa.Enum("static", "reexport", "dynamic", "require", "type_only", name="import_kind")
TOUR_VISIBILITY = sa.Enum("PUBLIC", "PRIVATE", name="tour_visibility")
DRIFT_STATUS = sa.Enum(
    "UNVERIFIED",
    "HEALTHY",
    "DRIFTED_AUTO_FIXED",
    "OUTDATED_NEEDS_REVIEW",
    "BROKEN_FILE_DELETED",
    name="drift_status",
)
ENUMS = (ANALYSIS_STATUS, LANGUAGE, FILE_ROLE, IMPORT_KIND, TOUR_VISIBILITY, DRIFT_STATUS)


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "repositories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("default_branch", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("stars", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_repositories")),
        sa.UniqueConstraint("owner", "name", name="uq_repositories_owner_name"),
    )
    op.create_table(
        "analyses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("repository_id", sa.Uuid(), nullable=False),
        sa.Column("branch", sa.String(length=255), nullable=False),
        sa.Column("commit_sha", sa.String(length=40), nullable=False),
        sa.Column("status", ANALYSIS_STATUS, nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_source_files", sa.Integer(), nullable=True),
        sa.Column("analyzed_files", sa.Integer(), nullable=True),
        sa.Column("truncated", sa.Boolean(), nullable=False),
        sa.Column("edge_count", sa.Integer(), nullable=True),
        sa.Column("cycle_count", sa.Integer(), nullable=True),
        sa.Column("parse_warning_count", sa.Integer(), nullable=True),
        sa.Column("unresolved_imports", sa.Integer(), nullable=True),
        sa.Column("external_imports", sa.Integer(), nullable=True),
        sa.Column("language_breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("cycles", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["repository_id"],
            ["repositories.id"],
            name=op.f("fk_analyses_repository_id_repositories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_analyses")),
        sa.UniqueConstraint("repository_id", "commit_sha", name="uq_analyses_repo_commit"),
    )
    op.create_index("ix_analyses_status_created", "analyses", ["status", "created_at"])
    op.create_table(
        "file_nodes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("analysis_id", sa.Uuid(), nullable=False),
        sa.Column("path", sa.String(length=1024), nullable=False),
        sa.Column("language", LANGUAGE, nullable=False),
        sa.Column("loc", sa.Integer(), nullable=False),
        sa.Column("in_degree", sa.Integer(), nullable=False),
        sa.Column("out_degree", sa.Integer(), nullable=False),
        sa.Column("role", FILE_ROLE, nullable=False),
        sa.Column("pagerank", sa.Float(), nullable=False),
        sa.Column("is_circular", sa.Boolean(), nullable=False),
        sa.Column("scc_id", sa.Integer(), nullable=True),
        sa.Column("parse_warning", sa.Text(), nullable=True),
        sa.Column("exports", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("functions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("classes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["analysis_id"],
            ["analyses.id"],
            name=op.f("fk_file_nodes_analysis_id_analyses"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_file_nodes")),
        sa.UniqueConstraint("analysis_id", "path", name="uq_file_nodes_analysis_path"),
    )
    op.create_table(
        "edges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("analysis_id", sa.Uuid(), nullable=False),
        sa.Column("source_path", sa.String(length=1024), nullable=False),
        sa.Column("target_path", sa.String(length=1024), nullable=False),
        sa.Column("kind", IMPORT_KIND, nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("is_circular", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["analysis_id"],
            ["analyses.id"],
            name=op.f("fk_edges_analysis_id_analyses"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_edges")),
        sa.UniqueConstraint(
            "analysis_id", "source_path", "target_path", name="uq_edges_analysis_source_target"
        ),
    )
    op.create_index(op.f("ix_edges_analysis_id"), "edges", ["analysis_id"])
    op.create_table(
        "tours",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("repository_id", sa.Uuid(), nullable=False),
        sa.Column("analysis_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("owner_login", sa.String(length=100), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("visibility", TOUR_VISIBILITY, nullable=False),
        sa.Column("base_commit_sha", sa.String(length=40), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["analysis_id"],
            ["analyses.id"],
            name=op.f("fk_tours_analysis_id_analyses"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["repository_id"],
            ["repositories.id"],
            name=op.f("fk_tours_repository_id_repositories"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tours")),
    )
    op.create_index(op.f("ix_tours_owner_user_id"), "tours", ["owner_user_id"])
    op.create_index(op.f("ix_tours_repository_id"), "tours", ["repository_id"])
    op.create_table(
        "tour_steps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tour_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column("file_path", sa.String(length=1024), nullable=False),
        sa.Column("start_line", sa.Integer(), nullable=False),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("snippet_hash", sa.String(length=64), nullable=False),
        sa.Column("snippet_snapshot", sa.Text(), nullable=False),
        sa.Column("checkpoint", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("drift_status", DRIFT_STATUS, nullable=False),
        sa.Column("drift_similarity", sa.Float(), nullable=True),
        sa.Column("proposed_start_line", sa.Integer(), nullable=True),
        sa.Column("proposed_end_line", sa.Integer(), nullable=True),
        sa.Column("proposed_snippet", sa.Text(), nullable=True),
        sa.Column("drift_diff", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_checked_commit_sha", sa.String(length=40), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "start_line >= 1 AND end_line >= start_line",
            name=op.f("ck_tour_steps_valid_line_range"),
        ),
        sa.ForeignKeyConstraint(
            ["tour_id"],
            ["tours.id"],
            name=op.f("fk_tour_steps_tour_id_tours"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tour_steps")),
        # Deferred so steps can be reordered inside one transaction without collisions.
        sa.UniqueConstraint(
            "tour_id",
            "position",
            name="uq_tour_steps_tour_position",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    op.create_table(
        "tour_sync_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tour_id", sa.Uuid(), nullable=False),
        sa.Column("triggered_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("from_commit_sha", sa.String(length=40), nullable=False),
        sa.Column("to_commit_sha", sa.String(length=40), nullable=False),
        sa.Column("counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["tour_id"],
            ["tours.id"],
            name=op.f("fk_tour_sync_runs_tour_id_tours"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tour_sync_runs")),
    )
    op.create_index(op.f("ix_tour_sync_runs_tour_id"), "tour_sync_runs", ["tour_id"])
    op.create_table(
        "user_step_progress",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("user_login", sa.String(length=100), nullable=True),
        sa.Column("tour_id", sa.Uuid(), nullable=False),
        sa.Column("step_id", sa.Uuid(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("first_try_correct", sa.Boolean(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["step_id"],
            ["tour_steps.id"],
            name=op.f("fk_user_step_progress_step_id_tour_steps"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tour_id"],
            ["tours.id"],
            name=op.f("fk_user_step_progress_tour_id_tours"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_step_progress")),
        sa.UniqueConstraint("user_id", "step_id", name="uq_user_step_progress_user_step"),
    )
    op.create_index("ix_user_step_progress_tour_user", "user_step_progress", ["tour_id", "user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_step_progress_tour_user", table_name="user_step_progress")
    op.drop_table("user_step_progress")
    op.drop_index(op.f("ix_tour_sync_runs_tour_id"), table_name="tour_sync_runs")
    op.drop_table("tour_sync_runs")
    op.drop_table("tour_steps")
    op.drop_index(op.f("ix_tours_repository_id"), table_name="tours")
    op.drop_index(op.f("ix_tours_owner_user_id"), table_name="tours")
    op.drop_table("tours")
    op.drop_index(op.f("ix_edges_analysis_id"), table_name="edges")
    op.drop_table("edges")
    op.drop_table("file_nodes")
    op.drop_index("ix_analyses_status_created", table_name="analyses")
    op.drop_table("analyses")
    op.drop_table("repositories")
    bind = op.get_bind()
    for enum in ENUMS:
        enum.drop(bind, checkfirst=True)
