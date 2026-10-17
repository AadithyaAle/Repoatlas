# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/AadithyaAle/Repoatlas/security/advisories/new).
Include steps to reproduce, affected endpoints/components and impact. You will receive an
acknowledgement within 72 hours.

## Security model (summary)

- RepoAtlas only analyzes **public** GitHub repositories; private repositories are rejected.
- Repository archives are extracted in memory with path-traversal, symlink and size guards.
  Analyzed code is parsed, never executed.
- Authentication uses Supabase Auth (GitHub OAuth). The API verifies JWT signatures (JWKS or
  HS256 secret), audience and expiry on every authenticated request.
- Authorization is enforced server-side: only tour owners can edit, sync or delete tours, and
  checkpoint answers are never sent to trainees before they answer correctly.
- Secrets are supplied through environment variables only; `.env` files are git-ignored. In the
  API they are typed as secret values and masked in logs and error output.
- All database access goes through the API. Every table has PostgreSQL Row Level Security enabled
  with no policies, so Supabase's Data API cannot be used to read or modify data with the
  browser-visible key. The frontend build fails if a Supabase secret key is placed in a
  `NEXT_PUBLIC_` variable.
- Dependencies are monitored by Dependabot and code is scanned by CodeQL in CI.
