---
description: FastAPI database session, transaction, repository, and async I/O rules
paths:
  - "apps/api/**/database/**/*.py"
  - "apps/api/**/db/**/*.py"
  - "apps/api/**/repositories/**/*.py"
  - "apps/api/**/models/**/*.py"
  - "apps/api/**/dependencies/**/*.py"
  - "src/api/**/database/**/*.py"
  - "src/api/**/db/**/*.py"
  - "src/api/**/repositories/**/*.py"
  - "src/api/**/models/**/*.py"
  - "**/api/**/*.py"
---

# FastAPI Database Transaction Rules

## Session Scope

- Use one request-scoped session or unit of work per incoming request.
- Create sessions with an explicit factory such as `async_sessionmaker`.
- Never create engines, session factories, or HTTP clients per request.
- Never share one SQLAlchemy `AsyncSession` across concurrent tasks.
- Close sessions deterministically with `yield` dependencies or async context managers.

## Transaction Boundaries

- Own commit and rollback in one layer. Do not split transaction control across endpoint, service, and repository code.
- Use `async with session.begin():` or an explicit unit-of-work object for write operations.
- Flush when IDs or constraints are needed before commit; do not commit only to read generated values.
- Read-only endpoints should not start write transactions unless the database layer requires a scoped session.
- Background tasks must create their own session and transaction; they must not capture request-scoped sessions.

## ORM Access

- Use SQLAlchemy 2.0 `select()` statements or the project's established async ORM query API.
- Avoid implicit lazy loading in async code. Load required relationships with explicit eager strategies.
- Prevent N+1 queries with `selectinload`, `joinedload`, projections, or dedicated repository methods.
- Repositories return domain objects, DTOs, or ORM rows according to existing project convention, but public API schemas are built at the API boundary.

## Failure Handling

- Convert integrity errors into domain errors or HTTP 409/400 responses at the correct boundary.
- Roll back failed transactions before the session is reused or closed.
- Tests must cover rollback behavior for write failures and uniqueness conflicts.
