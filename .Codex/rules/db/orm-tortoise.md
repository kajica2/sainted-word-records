---
description: Tortoise ORM patterns — active when OMB_ORM_BACKEND is `tortoise`, `both`, or unset (default). Models, queries, transactions, eager loading.
paths:
  - "**/models/**/*.py"
  - "**/repositories/**/*.py"
  - "**/dao/**/*.py"
activation_env: OMB_ORM_BACKEND
activation_values: ["tortoise", "both", ""]
---

# Tortoise ORM Patterns

Default ORM per `common/stack-selection.md`. Pair with `db/orm.md` (policy SSOT) and `db/postgres.md` (PostgreSQL conventions).

Official docs: https://tortoise.github.io/

## Models

```python
from tortoise import fields
from tortoise.models import Model


class User(Model):
    id = fields.IntField(pk=True)
    email = fields.CharField(max_length=255, unique=True, index=True)
    is_active = fields.BooleanField(default=True)
    created_at = fields.DatetimeField(auto_now_add=True)
    updated_at = fields.DatetimeField(auto_now=True)

    posts: fields.ReverseRelation["Post"]

    class Meta:
        table = "users"
        indexes = [("is_active", "created_at")]


class Post(Model):
    id = fields.IntField(pk=True)
    title = fields.CharField(max_length=200)
    author: fields.ForeignKeyRelation[User] = fields.ForeignKeyField(
        "models.User", related_name="posts", on_delete=fields.CASCADE,
    )

    class Meta:
        table = "posts"
```

Rules:
- Use `IntField(pk=True)` or `UUIDField(pk=True)` explicitly; do not rely on implicit PKs.
- Use `index=True` on the field, or `Meta.indexes` for composite indexes.
- Set `on_delete` explicitly on every FK.
- Define reverse relations with `ReverseRelation` typing for IDE/type-checker support.

## Queries (filter, get, exists)

```python
# Filter
active_users = await User.filter(is_active=True).order_by("-created_at").limit(20)

# Get-or-None
user = await User.filter(email=email).first()           # returns Model | None

# Get-or-Raise
user = await User.get(id=user_id)                       # raises DoesNotExist

# Exists
has_email = await User.filter(email=email).exists()

# Count
n = await User.filter(is_active=True).count()
```

- Prefer `.filter(...).first()` over `.get_or_none(...)` for clarity.
- Use `.only("id", "email")` for projection when reading large rows.
- Use `.values("id", "email")` or `.values_list("id", flat=True)` when you need dicts/scalars instead of Model instances.

## Q expressions and F functions

```python
from tortoise.expressions import Q, F

# OR / NOT
users = await User.filter(Q(email__icontains="@example.com") | Q(is_admin=True))

# Atomic numeric update via F (no read-modify-write race)
await Post.filter(id=post_id).update(view_count=F("view_count") + 1)
```

## Eager loading (no N+1)

```python
# select_related — JOIN for ForeignKey/OneToOne
posts = await Post.all().select_related("author")

# prefetch_related — separate query for reverse/M2M
users = await User.all().prefetch_related("posts")

# Combined
posts = await Post.all().select_related("author").prefetch_related("tags")
```

Rules:
- **[HARD] Never await a relation lazily inside a loop.** Always pre-load via `select_related` / `prefetch_related`.
- Use `prefetch_related(Prefetch("posts", queryset=Post.filter(is_published=True)))` to filter the prefetched set.

## Transactions (`in_transaction` / `atomic`)

```python
from tortoise.transactions import in_transaction, atomic

# Function-level decorator
@atomic()
async def transfer(from_id: int, to_id: int, amount: int) -> None:
    sender = await Account.select_for_update().get(id=from_id)
    receiver = await Account.select_for_update().get(id=to_id)
    sender.balance -= amount
    receiver.balance += amount
    await sender.save()
    await receiver.save()

# Context manager
async def bulk_create_users(rows: list[dict]) -> None:
    async with in_transaction() as conn:
        for row in rows:
            await User.create(**row, using_db=conn)
```

Rules:
- Use `select_for_update()` inside a transaction for row-level locks.
- Never start a transaction in a route handler then pass the connection across requests — keep transactions scoped to a single unit of work.

## Bulk operations

```python
# Bulk create
await User.bulk_create([User(email=e) for e in emails], batch_size=500)

# Bulk update on a queryset (no per-row hooks)
await Post.filter(is_draft=True, created_at__lt=cutoff).update(is_archived=True)

# Bulk delete on a queryset
await Post.filter(author_id=user_id).delete()
```

`bulk_create` and queryset `update`/`delete` skip `save()` signals — mention this in code review when signals are part of the contract.

## Raw escape hatch (FORBIDDEN by default)

`Model.raw(...)`, `tortoise.connections.get(...).execute_query(...)`, and `connection.execute(...)` are subject to the **ORM Exception Protocol** in `db/orm.md`. They MUST appear in the active plan's §2 raw SQL exceptions table with file:line range, justification, and reviewer. Otherwise the implement agent emits `<omb>BLOCKED</omb>` and the PreToolUse `raw_sql_guard` hook blocks the write.

If approved, document inline:

```python
# RAW SQL EXCEPTION — plan §2 entry: apps/api/reports/aggregator.py:45-78
# Reason: 10M-row aggregate; ORM produces N+1 on the join.
# Reviewer: @db-design (2026-05-03)
rows = await connections.get("default").execute_query_dict(
    "SELECT date_trunc('day', created_at) AS d, count(*) FROM events WHERE ... GROUP BY 1",
    [...],
)
```

## Testing

- Use `tortoise.contrib.test` `initializer`/`finalizer` or pytest fixtures with a disposable test database (e.g., `test_*` schema or per-test SQLite-in-memory if portable).
- Wrap each test in a transaction that rolls back on teardown.
- Do not use the production Tortoise config in tests — load a separate `TORTOISE_TEST_CONFIG`.
