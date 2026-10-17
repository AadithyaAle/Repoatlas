# RepoAtlas API (backend)

FastAPI service that analyzes public GitHub repositories into dependency graphs, simulates the
blast radius of changes and serves self-healing onboarding tours. See the repository-wide
[CONTRIBUTING.md](../CONTRIBUTING.md) for architecture rules and the Git workflow.

## Setup

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/) and Docker (for Postgres).

```bash
docker compose up -d db          # from the repo root: Postgres 16 on localhost:5433
cd backend
cp .env.example .env             # then fill in what you need (see below)
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

Interactive API docs: <http://localhost:8000/docs> (OpenAPI JSON at `/openapi.json`).

## Commands

| Task | Command |
|---|---|
| Format / lint | `uv run ruff format . && uv run ruff check .` |
| Type-check | `uv run mypy app` |
| Tests (integration tests need the docker DB, database `repoatlas_test`) | `uv run pytest` |
| New migration (after editing `app/db/models.py`) | `uv run alembic revision --autogenerate -m "describe change"` |
| Apply / roll back migrations | `uv run alembic upgrade head` / `uv run alembic downgrade -1` |
| Dump the OpenAPI document (no DB needed) | `uv run python -m app.scripts.dump_openapi > openapi.json` |
| Standalone worker (`WORKER_MODE=standalone`) | `uv run python -m app.workers.analysis_worker` |
| Container image | `docker build -t repoatlas-api .` then `docker run -p 8000:8000 --env-file .env repoatlas-api` |

The container runs `alembic upgrade head` and then uvicorn on `$PORT` (default 8000); see
[`scripts/start.sh`](scripts/start.sh) and the [`Dockerfile`](Dockerfile).

## Configuration

All settings are environment variables (or `backend/.env`), validated by
[`app/core/config.py`](app/core/config.py). [`.env.example`](.env.example) lists them with
comments.

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` switches logs to single-line JSON |
| `LOG_LEVEL` | `INFO` | Root log level |
| `DATABASE_URL` | local docker DB | Async SQLAlchemy URL (`postgres://` is rewritten to asyncpg); Supabase: pooler URL |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed browser origins, comma-separated or a JSON list |
| `GITHUB_TOKEN` | – | Optional; raises the GitHub rate limit from 60 to 5000 req/h |
| `SUPABASE_URL` | – | Used to fetch the JWKS for verifying access tokens (RS256/ES256) |
| `SUPABASE_JWT_SECRET` | – | Only for projects still on legacy HS256 JWT secrets |
| `SUPABASE_JWT_AUDIENCE` | `authenticated` | Expected `aud` claim |
| `MAX_FILES` / `MAX_FILE_BYTES` / `MAX_TARBALL_BYTES` | `1500` / `300000` / `80000000` | Ingestion limits |
| `WORKER_MODE` | `embedded` | `embedded` (job loop inside the API), `standalone` (separate process) or `off` |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | – / `gemini-2.5-flash` | Optional AI authoring features |

## Project layout

```text
app/
  main.py            app factory: middleware, exception handlers, lifespan (embedded worker)
  core/              config, errors, Supabase JWT auth, logging + error envelopes, version
  api/v1/routes/     thin HTTP routes (validate -> service -> ok(data))
  schemas/           Pydantic API contract (source of the frontend's generated types)
  services/          IO + orchestration (database, GitHub)
  engine/            pure, deterministic analysis algorithms (no IO)
  db/                SQLAlchemy models and async session
  workers/           DB-backed analysis job queue worker
  scripts/           CLI helpers (OpenAPI dump)
migrations/          Alembic migrations (async env, autogenerate-ready)
tests/unit/          pure unit tests
tests/integration/   API tests against a real Postgres
```

## Conventions

- Every response is an envelope: `{"success": true, "data": ...}` or
  `{"success": false, "error": {"code", "message", "details"}}`. Raise
  `AppError(ErrorCode.X, "message")` from [`app/core/errors.py`](app/core/errors.py); never
  return stack traces.
- Each response carries an `X-Request-ID` header (an incoming one is reused when valid); logs
  include it.
- Auth: send `Authorization: Bearer <Supabase access token>`; use the `AuthUser` /
  `OptionalUser` dependencies from [`app/api/deps.py`](app/api/deps.py).
