---
description: FastAPI dependency injection, lifespan, and resource cleanup rules
paths:
  - "apps/api/**/dependencies/**/*.py"
  - "apps/api/**/deps/**/*.py"
  - "apps/api/**/main.py"
  - "apps/api/**/factory.py"
  - "apps/api/**/lifespan.py"
  - "src/api/**/dependencies/**/*.py"
  - "src/api/**/deps/**/*.py"
  - "**/api/**/*.py"
---

# FastAPI Dependency Rules

## Lifespan

- Use `FastAPI(lifespan=...)` for application-wide startup and shutdown resources.
- Initialize shared pools and clients in lifespan, not at import time.
- Close every shared resource in the lifespan finalizer.
- Store application-wide resources on `app.state`; store request metadata on `request.state`.
- New code must not use deprecated startup/shutdown event handlers when lifespan can express the lifecycle.

## Dependency Boundaries

- Use dependencies for auth, current user, tenant selection, database session creation, pagination parsing, and feature flags.
- Keep dependencies small and typed. A dependency should return one clear value or enforce one policy.
- Use `Annotated[T, Depends(...)]` for dependency parameters.
- Compose dependencies instead of duplicating auth and tenant checks route-by-route.
- Do not hide request-specific state in module globals.

## Yield Dependencies

- Use `yield` dependencies for resources that require per-request cleanup.
- Put commit, rollback, close, and cancellation behavior in the dependency or unit-of-work layer, not in each endpoint.
- Never swallow exceptions inside cleanup blocks unless the error is logged and intentionally converted.
- Tests must override dependencies through `app.dependency_overrides`, then clear overrides after the test.

## Async Boundaries

- Dependencies used by `async def` endpoints must use async clients when performing I/O.
- Blocking SDK calls, filesystem work, CPU-heavy serialization, and synchronous database drivers must not run on the event loop.
- If a synchronous library is unavoidable, isolate it with a worker thread, background job, or service boundary and test cancellation behavior.
