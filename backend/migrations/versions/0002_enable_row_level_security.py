"""enable row level security

Supabase exposes the `public` schema through its Data API using the browser-visible publishable
key. All access goes through the FastAPI backend (which connects as the table owner and is not
subject to RLS), so enabling RLS with no policies denies direct anon/authenticated access.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17 00:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "repositories",
    "analyses",
    "file_nodes",
    "edges",
    "tours",
    "tour_steps",
    "tour_sync_runs",
    "user_step_progress",
    "alembic_version",
)


def upgrade() -> None:
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
