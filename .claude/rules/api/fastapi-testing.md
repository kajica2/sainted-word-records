---
description: FastAPI API test coverage, dependency override, async test, and OpenAPI drift rules
paths:
  - "tests/api/**/*.py"
  - "apps/api/tests/**/*.py"
  - "**/test_*api*.py"
  - "**/*fastapi*test*.py"
---

# FastAPI Testing Rules

## Required Coverage

- Every public endpoint needs at least one happy-path test and one error-path test.
- Authenticated routes need missing-token, invalid-token, and insufficient-scope tests when auth is in scope.
- Write routes need validation, conflict, rollback, and response-shape assertions.
- List routes need pagination bounds, sort allowlist, and empty-result tests.
- Error handlers need stable envelope assertions.

## Test Isolation

- Use `app.dependency_overrides` for dependency substitution. Clear overrides after each test.
- Use async HTTP clients and async database fixtures when testing async endpoints.
- Do not monkeypatch FastAPI internals or global dependencies unless the project has an established helper for it.
- Use rollback-per-test, transaction savepoints, or disposable databases for DB-backed tests.
- Avoid live external services in unit tests. Use typed fakes, local test servers, or approved integration fixtures.

## OpenAPI Drift

- Assert OpenAPI changes when route signatures, response models, auth requirements, status codes, or error schemas change.
- Generated client contracts must be updated or explicitly marked out of scope when OpenAPI changes.
- Snapshot tests must be stable and intentionally reviewed; do not bless snapshots without reading the diff.

## Mock Discipline

- Mocks must return realistic typed data and assert expected calls.
- Do not use empty `MagicMock()` or empty dict responses for service calls.
- Prefer real database sessions for repository tests. Mocking the ORM hides transaction and query bugs.
