## Summary

<!-- What does this change and why? Link the issue: Closes #123 -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor / performance
- [ ] Docs / CI / chore

## How was this tested?

- [ ] Backend: `uv run ruff check . && uv run mypy app && uv run pytest`
- [ ] Frontend: `npm run lint && npm run typecheck && npm run test && npm run build`
- [ ] Manually verified in the browser (screenshots below if UI changed)

## Checklist

- [ ] API schema changes are reflected in `frontend/src/lib/api/schema.d.ts` (`npm run gen:api`)
- [ ] Database changes include an Alembic migration
- [ ] Docs updated (`docs/`) if behaviour changed
- [ ] No secrets, tokens or `.env` files committed
