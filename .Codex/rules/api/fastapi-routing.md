---
description: FastAPI routing, schema, response model, and OpenAPI contract rules
paths:
  - "apps/api/**/routers/**/*.py"
  - "apps/api/**/routes/**/*.py"
  - "apps/api/**/schemas/**/*.py"
  - "src/api/**/routers/**/*.py"
  - "src/api/**/routes/**/*.py"
  - "src/api/**/schemas/**/*.py"
  - "**/api/**/*.py"
---

# FastAPI Routing Rules

## Route Shape

- Group endpoints by resource with `APIRouter`.
- Use stable resource paths: `/users`, `/orders`, `/documents`. Avoid verbs unless the action is not a resource.
- Every public endpoint must declare `response_model`, `status_code`, and an explicit return type annotation.
- Use route names and summaries that describe the domain operation, not implementation details.
- Keep route handlers under 50 lines. If a handler needs branching business logic, move it to a service.

## Schemas

- Use Pydantic v2 models for request and response boundaries.
- Use `Field(...)`, validators, and constrained types for boundary validation.
- Use `model_validate()` at ORM/domain boundaries when constructing response schemas.
- Use separate create, update, read, and internal schemas when fields differ.
- Never expose password hashes, secret flags, internal status fields, or raw database errors in response schemas.

## Parameters

- Use `Annotated[..., Query(...)]`, `Path(...)`, `Header(...)`, and `Cookie(...)` for all constrained parameters.
- Validate pagination with bounded `limit` and non-negative `offset` or cursor semantics.
- Validate sort fields through an allowlist. Never pass caller-provided field names directly into SQL or ORM ordering.
- Keep request bodies as Pydantic models. Do not accept raw dict payloads for stable public APIs.

## OpenAPI Contract

- Keep generated OpenAPI accurate: route status codes, response schemas, auth dependencies, and documented error responses must match runtime behavior.
- Add `responses={...}` for domain errors that clients must handle.
- Treat OpenAPI drift as a test failure when the API is consumed by other services or generated clients.

## SSE / Streaming Endpoints

`StreamingResponse` for Server-Sent Events has additional contracts: Last-Event-ID resume, heartbeat, idle timeout, terminal-event close, and **no in-process LangGraph execution** inside the SSE handler. See `api/fastapi-sse.md` for the full wire-format and dispatcher patterns.
