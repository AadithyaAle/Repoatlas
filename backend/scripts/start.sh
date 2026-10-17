#!/bin/sh
# Container entrypoint: apply migrations, then serve. PORT is injected by the host (default 8000).
set -eu

alembic upgrade head
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --no-access-log
