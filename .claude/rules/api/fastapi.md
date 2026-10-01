---
description: FastAPI API rule index for routing, dependencies, security, database boundaries, and tests
paths:
  - "apps/api/**/*.py"
  - "src/api/**/*.py"
  - "**/api/**/*.py"
  - "**/routers/**/*.py"
  - "**/routes/**/*.py"
  - "**/schemas/**/*.py"
---

# FastAPI Rules

Use this file as the compact index for FastAPI work. Read the focused rule file that matches the changed code before editing.

## Mandatory References

- Routing and schemas: `.claude/rules/api/fastapi-routing.md`
- Dependencies and lifespan resources: `.claude/rules/api/fastapi-dependencies.md`
- Security and error contracts: `.claude/rules/api/fastapi-security-errors.md`
- Database and transaction boundaries: `.claude/rules/api/fastapi-db-transactions.md`
- API test strategy: `.claude/rules/api/fastapi-testing.md`
- SSE / streaming endpoints: `.claude/rules/api/fastapi-sse.md`
- Shared ORM rules: `.claude/rules/db/orm.md`

## Core Rules

- FastAPI path functions are thin HTTP adapters. Business logic belongs in services, use cases, or repositories.
- Use `APIRouter` with explicit `prefix`, `tags`, `response_model`, and status codes for every public route.
- Use Pydantic v2 schemas for request and response boundaries. Never return raw ORM objects from public endpoints.
- Use `lifespan` for application-wide resources. Do not open database engines or HTTP clients at import time.
- Use `yield` dependencies for request-scoped resources that require cleanup.
- Use async-only database and HTTP clients inside `async def` endpoints. Blocking work must move to a thread or job queue.
- Keep auth, tenant, pagination, sorting, and feature-flag policy in dependencies or service boundaries, not inline route code.
- Return one consistent error envelope for expected API errors. Never expose stack traces, secrets, internal IDs, or unnecessary PII.
- Apply pagination and sorting allowlists to every list endpoint. Unbounded list endpoints are banned.
- Test OpenAPI drift when route signatures, schemas, auth, status codes, or error responses change.

## Review Checklist

- Does each changed endpoint have explicit request, response, auth, error, pagination, and status-code behavior?
- Are resource lifetimes scoped to `lifespan` or `yield` dependencies, never hidden globals?
- Are transaction boundaries owned by one layer and visible in tests?
- Are dependency overrides used in tests instead of monkeypatching framework internals?
- Did tests cover happy path, validation failure, auth failure, and domain error translation?

References: FastAPI lifespan events, dependencies with `yield`, security utilities, and testing docs.
