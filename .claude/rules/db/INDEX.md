---
description: "Database Rules"
paths: ["**/models/**/*.py", "**/repositories/**/*.py", "**/dao/**/*.py", "**/db/**/*.py", "**/database/**/*.py", "**/migrations/**/*.py", "**/alembic/**/*.py", ".claude/agents/**", ".claude/rules/**"]
---

# Database Rules

## Files

- `postgres.md` — PostgreSQL conventions: SQLAlchemy 2.0 async, naming, index strategy, migration safety, connection pooling, types, Alembic
- `orm.md` — **ORM policy SSOT**: backend selection (`OMB_ORM_BACKEND`), ORM Exception Protocol (HARD), pre-flight identification, transactions, query discipline. Backend-agnostic.
- `orm-tortoise.md` — Tortoise ORM patterns (default backend). Models, filter/get/exists, Q/F, `select_related`/`prefetch_related`, `in_transaction`/`atomic`, bulk ops.
- `orm-sqlalchemy.md` — SQLAlchemy 2.0 async patterns (opt-in backend). `DeclarativeBase`, `Mapped`/`mapped_column`, `select()`, `selectinload`/`joinedload`, `async with session.begin()`.
- `redis.md` — Redis patterns: cache TTL, namespaced keys, Pub/Sub vs Streams, idempotency keys, distributed locks
- `redis-streams.md` — Mother / SSOT: data plane (Streams) vs control plane (Pub/Sub), dual ConnectionPool, key naming, numeric defaults table, MAXLEN+EXPIRE invariants, anti-patterns. Authoritative source for numeric defaults
- `redis-streams-consumers.md` — Split: multi-reader pattern (independent `XREAD` consumers) and reaper pattern (synthetic terminal events for stalled runs)

## Backend Activation

The active ORM backend is declared via `OMB_ORM_BACKEND` in `.claude/settings.json` `env`:

| Value | Active patterns file |
|-------|----------------------|
| `tortoise` (default if unset) | `db/orm-tortoise.md` |
| `sqlalchemy` | `db/orm-sqlalchemy.md` |
| `both` | both |

`db/orm.md` always applies (policy SSOT).

## Triggers

Inject these rules when working on: PostgreSQL, Tortoise ORM, SQLAlchemy, Redis, `src/db/**`,
`apps/api/db/**`, `migrations/**`, ORM models, repository/DAO classes, raw SQL,
`Model.filter`, `Model.get`, `Model.create`, `prefetch_related`, `select_related`,
`in_transaction`, `@atomic`, `Q expressions`, `F functions`,
`AsyncSession`, `select()`, `selectinload`, `joinedload`, `Mapped`, `mapped_column`,
`session.begin()`, `JSONB`, `redis.set`, `redis.get`, Alembic, schema migrations,
Redis Streams, `XADD`, `XREAD`, dual connection pool, Pub/Sub control plane,
run reaper, MAXLEN, EXPIRE.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../common/design-patterns.md` (pattern selection + framework-idiom precedence)
- `../common/stack-selection.md` (declares Tortoise as backend default)
- `../api/INDEX.md` (API layer that calls into the DB layer)
