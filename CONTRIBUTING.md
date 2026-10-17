# Contributing to RepoAtlas

Thanks for helping! This guide covers layout, tooling and the rules every change must follow.

## Repository layout

| Path | What lives there |
|---|---|
| [`backend/`](backend/) | FastAPI service (Python 3.12+, managed with [uv](https://docs.astral.sh/uv/)) |
| [`frontend/`](frontend/) | Next.js App Router UI (TypeScript strict) |
| [`docs/`](docs/) | Static HTML documentation site, published to GitHub Pages |
| [`.github/`](.github/) | CI workflows, issue/PR templates, CODEOWNERS, Dependabot |

## Local development

```bash
docker compose up -d db                 # Postgres 16 on localhost:5433 (atlas/atlas/repoatlas)
cd backend && cp .env.example .env && uv sync && uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
cd ../frontend && cp .env.example .env.local && npm ci && npm run dev
```

## Quality gates (CI runs exactly these)

Backend (`backend/`):

```bash
uv run ruff format --check . && uv run ruff check .
uv run mypy app
uv run pytest            # integration tests need the docker DB (test DB: repoatlas_test)
```

Frontend (`frontend/`):

```bash
npm run lint && npm run typecheck && npm run test && npm run build
npm run gen:api          # regenerate API types after changing backend schemas
```

## Supply-chain policy

New dependencies must have been published **at least 7 days ago**.

- Python: `backend/pyproject.toml` sets `[tool.uv] exclude-newer`; add packages with `uv add`.
- npm: `npm install --before=<date 7 days ago> <pkg>`; versions are pinned exactly (`.npmrc`).

## Backend architecture rules

- `app/engine/` is **pure**: no FastAPI, SQLAlchemy, httpx or IO. Shared types are in
  `app/engine/types.py`. Algorithms are iterative and deterministic (sorted outputs) and fully
  unit-tested.
- `app/services/` holds IO and orchestration (DB, GitHub). Routes in `app/api/v1/routes/` stay
  thin: validate → call service → return `ok(data)`.
- Errors: raise `AppError(ErrorCode.X, "message", details=...)` from `app/core/errors.py`. Global
  handlers render `{ "success": false, "error": { "code", "message", "details" } }`. Never leak
  stack traces or secrets.
- `app/schemas/atlas.py` is the API contract. The frontend's types are generated from the
  OpenAPI document — changing a schema means regenerating `frontend/src/lib/api/schema.d.ts`.
- AuthN: Supabase JWT via `AuthUser` / `OptionalUser` (`app/api/deps.py`). AuthZ lives in
  services: non-owners get `FORBIDDEN`; private tours of other users return `NOT_FOUND`.
- Checkpoint answers (`correct_index`, `explanation`) are never sent to non-owners.
- Background jobs: the `analyses` table is the queue, claimed with `FOR UPDATE SKIP LOCKED`.

## Frontend rules

- Never hand-write API types; use the generated schema and the typed client in
  `src/lib/api/`.
- Server state goes through TanStack Query. Every screen handles loading, empty, error and
  success states.
- Supabase Auth (`@supabase/ssr`) with GitHub OAuth; the access token is sent to the API as a
  Bearer token.

## Git workflow

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
- [Conventional Commits](https://www.conventionalcommits.org/): `feat(engine): ...`,
  `fix(api): ...`, `docs: ...`, `ci: ...`, `chore: ...`.
- Small, reviewable PRs using the PR template; CI must be green before merge.
- Never commit secrets or `.env` files. Report vulnerabilities per [SECURITY.md](SECURITY.md).
