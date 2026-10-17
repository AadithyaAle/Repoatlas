"""Pydantic v2 request/response contracts. The frontend's TypeScript types are generated from
the OpenAPI document produced by these models (`npm run gen:api` in /frontend)."""

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator, model_validator

from app.db.models import AnalysisStatus, TourVisibility
from app.engine.types import DriftStatus, FileRole, ImportKind, Language
from app.schemas.common import Schema

_GITHUB_URL = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/"
    r"(?P<name>[A-Za-z0-9._-]{1,100}?)(?:\.git)?/?(?:/tree/(?P<branch>[^?#]+))?/?$"
)
_SHORT = re.compile(r"^(?P<owner>[A-Za-z0-9][A-Za-z0-9-]{0,38})/(?P<name>[A-Za-z0-9._-]{1,100})$")

NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def parse_repo_url(value: str) -> tuple[str, str, str | None]:
    """Accept `https://github.com/o/r`, `github.com/o/r/tree/branch` or `o/r`.

    Returns (owner, name, branch_or_None)."""
    v = value.strip()
    m = _GITHUB_URL.match(v) or _SHORT.match(v)
    if not m:
        raise ValueError(
            "Expected a public GitHub repository URL like https://github.com/owner/repo"
        )
    groups = m.groupdict()
    return groups["owner"], groups["name"], groups.get("branch")


# ---------- Repositories & analyses ----------


class AnalyzeRequest(Schema):
    repo_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
    branch: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None = None
    force: bool = Field(default=False, description="Re-analyze even if this commit is cached")

    @field_validator("repo_url")
    @classmethod
    def _valid_url(cls, v: str) -> str:
        parse_repo_url(v)
        return v


class RepositoryOut(Schema):
    id: uuid.UUID
    owner: str
    name: str
    default_branch: str | None
    description: str | None
    stars: int | None
    html_url: str


class AnalysisOut(Schema):
    id: uuid.UUID
    repository: RepositoryOut
    branch: str
    commit_sha: str
    status: AnalysisStatus
    error_code: str | None
    error_message: str | None
    total_source_files: int | None
    analyzed_files: int | None
    truncated: bool
    edge_count: int | None
    cycle_count: int | None
    parse_warning_count: int | None
    unresolved_imports: int | None
    external_imports: int | None
    language_breakdown: dict[str, int] | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RepositorySummaryOut(Schema):
    repository: RepositoryOut
    latest_analysis: AnalysisOut | None
    tour_count: int


class GraphNodeOut(Schema):
    path: str
    language: Language
    loc: int
    in_degree: int
    out_degree: int
    role: FileRole
    pagerank: float
    is_circular: bool
    scc_id: int | None
    parse_warning: str | None
    exports: list[str]
    functions: list[str]
    classes: list[str]


class GraphEdgeOut(Schema):
    source: str
    target: str
    kind: ImportKind
    line: int
    is_circular: bool


class GraphOut(Schema):
    analysis_id: uuid.UUID
    commit_sha: str
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]
    cycles: list[list[str]]


class FileContentOut(Schema):
    path: str
    language: Language
    commit_sha: str
    content: str
    loc: int
    html_url: str  # permalink to the file on GitHub at commit_sha


class BlastRadiusOut(Schema):
    target: str
    direct_dependents: list[str]
    transitive_dependents: list[str]
    depth_by_path: dict[str, int]
    max_depth: int
    impact_percentage: float
    risk_score: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    total_files: int


class RateLimitOut(Schema):
    limit: int | None
    remaining: int | None
    reset_at: datetime | None
    authenticated: bool


# ---------- Tours ----------


class CheckpointIn(Schema):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]
    options: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    ] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0)
    explanation: Annotated[str, StringConstraints(max_length=1000)] | None = None

    @model_validator(mode="after")
    def _index_in_range(self) -> "CheckpointIn":
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index must point at one of the options")
        return self


class CheckpointPublicOut(Schema):
    """Checkpoint as seen by trainees — never includes the answer."""

    question: str
    options: list[str]


class CheckpointOwnerOut(CheckpointPublicOut):
    correct_index: int
    explanation: str | None


class TourCreate(Schema):
    analysis_id: uuid.UUID
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
    description: Annotated[str, StringConstraints(max_length=5000)] | None = None
    visibility: TourVisibility = TourVisibility.PUBLIC


class TourUpdate(Schema):
    title: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
        | None
    ) = None
    description: Annotated[str, StringConstraints(max_length=5000)] | None = None
    visibility: TourVisibility | None = None


class StepCreate(Schema):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    body_markdown: Annotated[str, StringConstraints(max_length=20000)] = ""
    file_path: NonEmpty
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    checkpoint: CheckpointIn | None = None
    position: int | None = Field(default=None, ge=0, description="Insert position; default append")

    @model_validator(mode="after")
    def _range(self) -> "StepCreate":
        if self.end_line < self.start_line:
            raise ValueError("end_line must be >= start_line")
        if self.end_line - self.start_line > 400:
            raise ValueError("A step may pin at most 400 lines")
        return self


class StepUpdate(Schema):
    title: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    body_markdown: Annotated[str, StringConstraints(max_length=20000)] | None = None
    checkpoint: CheckpointIn | None = None
    remove_checkpoint: bool = False


class StepReorder(Schema):
    step_ids: list[uuid.UUID] = Field(min_length=1)


class StepOut(Schema):
    id: uuid.UUID
    position: int
    title: str
    body_markdown: str
    file_path: str
    start_line: int
    end_line: int
    snippet_snapshot: str
    snippet_hash: str
    checkpoint: CheckpointOwnerOut | CheckpointPublicOut | None
    drift_status: DriftStatus
    drift_similarity: float | None
    proposed_start_line: int | None
    proposed_end_line: int | None
    proposed_snippet: str | None
    drift_diff: str | None
    last_checked_at: datetime | None


class TourSummaryOut(Schema):
    id: uuid.UUID
    title: str
    description: str | None
    visibility: TourVisibility
    repository: RepositoryOut
    analysis_id: uuid.UUID
    base_commit_sha: str
    owner_user_id: uuid.UUID
    owner_login: str | None
    step_count: int
    health: dict[DriftStatus, int]
    last_synced_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TourOut(TourSummaryOut):
    steps: list[StepOut]
    is_owner: bool


class ResolveDriftRequest(Schema):
    action: Literal["accept_proposed", "keep_original", "repin"]
    start_line: int | None = Field(default=None, ge=1)
    end_line: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _repin_needs_lines(self) -> "ResolveDriftRequest":
        if self.action == "repin":
            if self.start_line is None or self.end_line is None:
                raise ValueError("repin requires start_line and end_line")
            if self.end_line < self.start_line:
                raise ValueError("end_line must be >= start_line")
        return self


class SyncStepResult(Schema):
    step_id: uuid.UUID
    position: int
    title: str
    file_path: str
    previous_status: DriftStatus
    status: DriftStatus
    old_start_line: int
    old_end_line: int
    new_start_line: int | None
    new_end_line: int | None
    similarity: float


class SyncReportOut(Schema):
    tour_id: uuid.UUID
    from_commit_sha: str
    to_commit_sha: str
    new_analysis_id: uuid.UUID
    up_to_date: bool  # True when the latest commit equals the tour's base commit
    counts: dict[DriftStatus, int]
    steps: list[SyncStepResult]
    synced_at: datetime


# ---------- Progress (trainees) ----------


class AnswerRequest(Schema):
    selected_index: int | None = Field(
        default=None, ge=0, description="None for steps without checkpoint"
    )


class AnswerOut(Schema):
    step_id: uuid.UUID
    correct: bool
    completed: bool
    attempts: int
    explanation: str | None  # revealed only once answered correctly


class TourProgressOut(Schema):
    tour_id: uuid.UUID
    completed_step_ids: list[uuid.UUID]
    total_steps: int
    percent_complete: float


# ---------- Dashboard ----------


class RepoAnalyticsOut(Schema):
    repository: RepositoryOut
    analysis_id: uuid.UUID
    commit_sha: str
    analyzed_files: int
    edge_count: int
    cycle_count: int
    god_modules: int
    entry_points: int
    riskiest_files: list[BlastRadiusOut]  # top 5 by risk score
    role_breakdown: dict[FileRole, int]
    language_breakdown: dict[str, int]


class TraineeProgressOut(Schema):
    user_id: uuid.UUID
    user_login: str | None
    completed_steps: int
    total_steps: int
    first_try_accuracy: float | None  # 0..1 over answered checkpoints
    last_activity_at: datetime | None


class TourHealthOut(Schema):
    tour: TourSummaryOut
    health_score: float  # % of steps HEALTHY or DRIFTED_AUTO_FIXED
    sync_history: list[dict[str, object]]  # [{created_at, from, to, counts}], newest first, max 10
    trainees: list[TraineeProgressOut]


class DashboardOut(Schema):
    repos: list[RepoAnalyticsOut]  # repos the user analyzed or owns tours for
    tours: list[TourHealthOut]  # tours owned by the user
    learning: list[TourProgressOut]  # tours the user is taking


# ---------- AI (optional) ----------


class AIStepDraftRequest(Schema):
    analysis_id: uuid.UUID
    file_path: NonEmpty
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)


class AIStepDraftOut(Schema):
    title: str
    body_markdown: str
    checkpoint: CheckpointIn | None
    model: str
    cached: bool


class MetaOut(Schema):
    version: str
    ai_enabled: bool
    max_files: int
    github_authenticated: bool
