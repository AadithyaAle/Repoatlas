# RepoAtlas — frontend

Next.js 16 (App Router) · React 19 · TypeScript (strict + `noUncheckedIndexedAccess`) ·
Tailwind CSS v4 · shadcn/ui (new-york, zinc + indigo) · TanStack Query · Supabase Auth ·
openapi-fetch.

## Setup

```bash
cp .env.example .env.local
npm ci                 # first time ever (no package-lock.json yet): npm run bootstrap
npm run dev            # http://localhost:3000 (backend expected on :8000)
```

`npm run bootstrap` (`scripts/bootstrap.sh`) installs every dependency with
`npm install --before=<cutoff>`, so only versions published at least 7 days before the cutoff
are used (supply-chain policy). `.npmrc` pins exact versions. After that, `package-lock.json`
is the source of truth: use `npm ci`.

## Scripts

| Script | What it does |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `lint` | ESLint (flat config, `eslint-config-next`) |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest (jsdom + Testing Library) |
| `gen:api` | Dump the backend OpenAPI document to `openapi.json` and regenerate `src/lib/api/schema.d.ts` |
| `gen:api:fallback` | Same, via `app.openapi()` if `app.scripts.dump_openapi` is unavailable |

CI runs `npm run lint && npm run typecheck && npm run test && npm run build`.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | FastAPI base URL (paths include `/api/v1`) |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Leave blank to run without auth |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | — | `sb_publishable_…`; legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` also accepted |
| `NEXT_PUBLIC_DOCS_URL` | `https://aadithyaale.github.io/Repoatlas/` | "Docs" nav link |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | metadata base / OAuth fallback origin |

Validated in `src/lib/env.ts` (zod). Invalid or blank values fall back to defaults. Without
Supabase the app still works: graph features are anonymous, and auth UI shows a disabled
"Sign-in not configured" state.

Supabase: enable the GitHub provider and add `<site>/auth/callback` to the redirect URLs.

## Structure

```
src/
  proxy.ts                  Next 16 proxy (ex-middleware): refreshes the Supabase session
  app/                      routes: / · /analyses/[id] · /repos/[owner]/[name] · /tours/[id]
                            · /tours/[id]/edit · /dashboard · /login · /auth/callback
  components/
    ui/                     shadcn/ui primitives
    common/                 ErrorState, EmptyState, PageHeader, RateLimitBanner, RelativeTime
    layout/                 SiteHeader, SiteFooter, ThemeToggle, Logo
    auth/                   AuthProvider/useSession, AuthButton, LoginCard/SignInPrompt
    analysis/               AnalysisView (progress), AnalysisStepper, badges
    explore/                AnalyzeForm, RecentRepos, demo repos
    graph/                  GraphWorkspace (placeholder for the graph feature)
    tours/, repo/, dashboard/
  hooks/                    useIsClient, useNow
  lib/
    api/                    schema.d.ts (generated), client.ts, hooks.ts, errors.ts, types.ts
    supabase/               client.ts (browser), server.ts (RSC/route handlers), proxy.ts
    env.ts, repo-url.ts, analysis-steps.ts, utils.ts
```

Rules: never hand-write API types (generate them and use `src/lib/api/types.ts`). All server
state goes through the hooks in `src/lib/api/hooks.ts`. Every screen handles loading, empty,
error and success states.
