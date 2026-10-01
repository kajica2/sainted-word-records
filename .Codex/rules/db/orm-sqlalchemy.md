---
description: SQLAlchemy 2.0 async patterns — active when OMB_ORM_BACKEND is `sqlalchemy` or `both`. Sessions, models, queries, transactions, eager loading.
paths:
  - "**/models/**/*.py"
  - "**/repositories/**/*.py"
  - "**/dao/**/*.py"
activation_env: OMB_ORM_BACKEND
activation_values: ["sqlalchemy", "both"]
---

# SQLAlchemy 2.0 Async Patterns

Opt-in ORM. Pair with `db/orm.md` (policy SSOT) and `db/postgres.md` (PostgreSQL conventions).

Activate by setting `OMB_ORM_BACKEND=sqlalchemy` (or `both`) in `.claude/settings.json` `env`.

## Async Session Scope

- Use `AsyncSession` with `async_sessionmaker`.
- Yield sessions from a dependency (FastAPI `Depends`) or unit-of-work; never create globally.
- Never share an `AsyncSession` across concurrent tasks — open a new session per task.
- Close sessions with `async with` context managers or framework-managed `yield`.

## Models (DeclarativeBase + Mapped)

```python
from datetime import datetime
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default="now()")

    posts: Mapped[list["Post"]] = relationship(back_populates="author", lazy="raise")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    author: Mapped[User] = relationship(back_populates="posts", lazy="raise")
```

- Always use `Mapped[...]` and `mapped_column()` (SQLAlchemy 2.0 typed API).
- Set `lazy="raise"` (or `"raise_on_sql"`) to surface accidental implicit lazy loads as errors in async code.

## Queries (`select`, scalars, paginate)

```python
from sqlalchemy import select

stmt = (
    select(User)
    .where(User.is_active.is_(True))
    .order_by(User.created_at.desc())
    .limit(20)
)
result = await session.execute(stmt)
users = result.scalars().all()

# Single / optional row
user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
```

- Use `select()` over the legacy `Query` API.
- Use `.scalar_one()` / `.scalar_one_or_none()` for single-row reads (explicit cardinality).

## Eager loading (no N+1)

```python
from sqlalchemy.orm import joinedload, selectinload

# JOIN (good for one-to-one, many-to-one)
stmt = select(Post).options(joinedload(Post.author))

# Separate IN query (good for one-to-many, large parent sets)
stmt = select(User).options(selectinload(User.posts))
```

## Transactions

```python
async with session.begin():           # BEGIN ... COMMIT (or ROLLBACK on exception)
    session.add(user)
    await session.flush()
    session.add(Post(title="Hello", author_id=user.id))
```

- Prefer `async with session.begin():` over manual `commit()` / `rollback()`.
- Use savepoints (`async with session.begin_nested()`) only when partial rollback is needed.

## Raw SQL escape hatch (FORBIDDEN by default)

`session.execute(text(...))`, `sqlalchemy.text(...)`, `connection.execute(...)`, and any string-SQL escape hatch are subject to the **ORM Exception Protocol** in `db/orm.md`. They MUST appear in the active plan's §2 raw SQL exceptions table. Otherwise the implement agent emits `<omb>BLOCKED</omb>` and the PreToolUse `raw_sql_guard` hook blocks the write.

If approved, document inline:

```python
# RAW SQL EXCEPTION — plan §2 entry: apps/api/db/repositories/user_repo.py::UserRepo.bulk_upsert
# Reason: ON CONFLICT DO UPDATE not supported via SQLAlchemy ORM upsert at our version.
# Reviewer: @db-design (2026-05-03)
await session.execute(
    text("INSERT INTO users (email) VALUES (:e) ON CONFLICT (email) DO NOTHING"),
    {"e": email},
)
```

## Testing

- Use a disposable test database or schema; do not run tests against the dev DB.
- Roll back per test via a SAVEPOINT pattern, or recreate the schema per session.
- Cover uniqueness/FK violations, transaction rollback, eager loading, pagination, concurrent task session separation.
