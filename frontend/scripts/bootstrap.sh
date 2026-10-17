#!/usr/bin/env bash
# One-time dependency bootstrap honouring the supply-chain policy (CONTRIBUTING.md):
# every package must have been published at least 7 days ago. `--before` makes npm resolve
# the newest version older than the cutoff; `.npmrc` (save-exact=true) pins it exactly.
# After the first run, use `npm ci` — package-lock.json is the source of truth.
set -euo pipefail
cd "$(dirname "$0")/.."

BEFORE="${NPM_BEFORE:-2026-10-10}"

# Major-version guards keep the toolchain mutually compatible (Next 16 / React 19 /
# Tailwind 4 / ESLint 9 flat config / TypeScript 5 / Zod 4).
npm install --before="$BEFORE" \
  next@16 react@19 react-dom@19 \
  @tanstack/react-query@5 \
  @supabase/ssr @supabase/supabase-js@2 \
  openapi-fetch \
  @xyflow/react@12 @dagrejs/dagre @monaco-editor/react \
  react-markdown remark-gfm \
  sonner next-themes zod@4 lucide-react \
  radix-ui class-variance-authority clsx tailwind-merge

npm install --before="$BEFORE" --save-dev \
  typescript@5 @types/node@22 @types/react@19 @types/react-dom@19 \
  tailwindcss@4 @tailwindcss/postcss@4 tw-animate-css \
  eslint@9 eslint-config-next@16 \
  openapi-typescript@7 \
  vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event

# Regenerate the typed API contract from the backend (falls back to app.openapi()).
if [ -f ../backend/app/scripts/dump_openapi.py ]; then
  npm run gen:api
else
  npm run gen:api:fallback
fi
