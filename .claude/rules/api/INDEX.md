---
description: "API Rules"
paths: ["apps/api/**/*.py", "src/api/**/*.py", "**/api/**/*.py", "**/routers/**/*.py", "**/routes/**/*.py", "**/schemas/**/*.py", ".claude/agents/**", ".claude/rules/**"]
---

# API Rules

## Files

- `fastapi.md` — Mother: core principles, app factory, lifespan, APIRouter, dependency injection
- `fastapi-routing.md` — Route handlers, response models, status codes, thin endpoints
- `fastapi-dependencies.md` — Dependency injection patterns, auth dependencies, scoped resources
- `fastapi-security-errors.md` — Security middleware, error handling, structured error responses, auth boundary
- `fastapi-db-transactions.md` — Database session lifecycle, transaction scope, Tortoise ORM integration
- `fastapi-testing.md` — Test client, dependency overrides, async test fixtures, route coverage
- `fastapi-sse.md` — Mother: SSE wire format, Last-Event-ID resume, heartbeat, idle timeout, response headers, no in-process LangGraph, terminal events, after-TTL fallback
- `fastapi-sse-endpoints.md` — Split: dispatch endpoint pattern, cancel endpoint, CORS configuration; full heartbeat and after-TTL code examples

## Triggers

Inject these rules when working on: FastAPI, REST, async endpoints, `apps/api/**`,
`src/api/**`, `APIRouter`, `Depends`, `HTTPException`, `Pydantic`, `lifespan`,
`@router.get`, `@router.post`, HTTP APIs, webhook receivers,
SSE, EventSource, `Last-Event-ID`, `StreamingResponse` for SSE, heartbeat.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../common/design-patterns.md` (pattern selection + framework-idiom precedence)
- `../db/INDEX.md` (ORM and database rules used by API layer)
