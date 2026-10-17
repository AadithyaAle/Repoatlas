# RepoAtlas API image. Build: docker build -t repoatlas-api backend

FROM ghcr.io/astral-sh/uv:0.9.5 AS uv

# ---------- builder: resolve the locked environment into /app/.venv ----------
FROM python:3.12-slim AS builder
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
# Dependencies first (cached layer), then the project itself.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache
COPY app ./app
RUN uv sync --frozen --no-dev --no-cache

# ---------- runtime ----------
FROM python:3.12-slim AS runtime
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    PORT=8000
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --home-dir /app app
WORKDIR /app
COPY --from=builder --chown=app:app /app/.venv ./.venv
COPY --chown=app:app app ./app
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app scripts/start.sh ./scripts/start.sh
RUN chmod 755 ./scripts/start.sh
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/v1/meta', timeout=4)" || exit 1
CMD ["./scripts/start.sh"]
