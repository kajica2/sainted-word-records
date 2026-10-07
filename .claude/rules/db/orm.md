---
description: ORM policy SSOT — Tortoise-first default, SQLAlchemy opt-in, raw SQL exception protocol. Backend-agnostic transaction and boundary rules.
paths:
  - "**/models/**/*.py"
  - "**/repositories/**/*.py"
  - "**/dao/**/*.py"
  - "**/db/**/*.py"
  - "**/database/**/*.py"
  - "**/migrations/**/*.py"
  - "**/alembic/**/*.py"
---

# ORM Rules

Backend-agnostic policy. For backend-specific patterns, see:
- `db/orm-tortoise.md` — Tortoise patterns (default backend)
- `db/orm-sqlalchemy.md` — SQLAlchemy 2.0 patterns (opt-in backend)

## Backend Selection

The active ORM backend is declared via `OMB_ORM_BACKEND` (in `.claude/settings.json` `env`):

| Value | Active backend file(s) |
|-------|------------------------|
| `tortoise` (default when unset) | `db/orm-tortoise.md` |
| `sqlalchemy` | `db/orm-sqlalchemy.md` |
| `both` | both files |

If `OMB_ORM_BACKEND` is not set, treat the project as **Tortoise** per `common/stack-selection.md`.

## ORM Exception Protocol (HARD)

- **[HARD] Raw SQL is FORBIDDEN in application code unless pre-approved in the active plan's §2 "Raw SQL exceptions" table.** Raw SQL covers: `Model.raw(...)`, `connection.execute(...)`, `tortoise.connections.get(...).execute_query(...)`, `session.execute(text(...))`, `sqlalchemy.text(...)`, and any equivalent string-based query escape hatch. Migrations using `op.execute(...)` under `migrations/` or `alembic/` are exempt by category (still require code review).
- **[HARD] An exception entry MUST specify** file path + line range (or `path::ClassName.method` qualname), justification, and reviewer. See `workflow/01-plan.md` §2 template.
- **[HARD] If implementation appears to require raw SQL and the path/range is not listed, STOP and emit `<omb>BLOCKED</omb>`** with blocker text: `"raw SQL needed but not pre-approved in plan §2"`. Do not write the raw SQL and a TODO; do not silently rewrite into ORM if the schema does not actually support it.

## Pre-flight ORM Identification (HARD for implement agents)

Before any Write/Edit on `**/models/**`, `**/repositories/**`, `**/dao/**`, or `**/db/**`:
1. Read at least one existing model file in the target tree.
2. Identify the ORM library by import:
   - `from tortoise.models import Model` → Tortoise
   - `from sqlalchemy.orm import DeclarativeBase` (or `Mapped`, `mapped_column`) → SQLAlchemy
3. If the identified backend conflicts with `OMB_ORM_BACKEND` or with the plan's §2 declaration, emit `<omb>BLOCKED</omb>` with the mismatch.
4. If no existing model is present (greenfield), use the backend declared in plan §2 (or `OMB_ORM_BACKEND` default).

## Async Session / Connection Scope

- Use one request-scoped or task-scoped unit of work.
- Never share a session/connection across concurrent tasks. Each task creates its own scope.
- Do not keep ORM sessions in module globals, class attributes, background closures, or long-lived singletons.
- Background jobs, scheduled tasks, and WebSocket tasks must create their own scope.

## Transactions

- Write operations need explicit transaction boundaries (`async with in_transaction():` for Tortoise, `async with session.begin():` for SQLAlchemy).
- Keep commit/rollback ownership in one layer (typically the service or repository façade, not the route handler).
- Use nested transactions/savepoints only when partial rollback is required.
- Roll back failed transactions before reusing or closing the session.

## Query Discipline

- Implicit lazy loading is banned in async paths. Select required relationships explicitly (`prefetch_related`/`select_related` for Tortoise; `selectinload`/`joinedload` for SQLAlchemy).
- Apply pagination limits and sort allowlists before hitting the database.
- Do not interpolate user input into SQL text, identifiers, ordering, filters, or raw fragments. Use the ORM's parameterization.

## Model Design

- Use the typed model API for the active backend.
- Every relationship must declare loading strategy and ownership semantics.
- PostgreSQL-specific naming, indexes, migrations follow `db/postgres.md`.
- Do not return ORM objects across the API boundary. Convert through DTOs / Pydantic schemas.

## Testing

- Repository tests use a real test DB session when possible.
- Use rollback-per-test, savepoints, disposable schemas, or disposable databases for isolation.
- Cover uniqueness, FK violations, transaction rollback, eager loading, pagination, and concurrent task session separation.
