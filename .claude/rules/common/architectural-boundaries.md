---
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
---

# Architectural Boundaries

## Layer Ownership

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| React / Next.js UI | Presentation, user interactions, route composition | Domain invariants, secrets, DB access |
| Electron Renderer | Desktop UI | Node APIs, filesystem, shell, secrets |
| Electron Preload | Typed bridge to safe IPC | Business logic, broad IPC access |
| Electron Main | Native desktop capabilities | UI business state unless OS-specific |
| FastAPI API | HTTP contracts, auth boundary, orchestration | Long prompt logic embedded in route handlers |
| Service Layer | Domain logic, transactions, permissions | HTTP-specific response formatting |
| Repository Layer | ORM/database access | Authorization decisions by itself |
| LangChain | Model integration, simple tool agents | Durable workflow state |
| LangGraph | Stateful orchestration | Unbounded autonomous behavior without safety gates |
| DeepAgents | Long-horizon agent harness | Simple deterministic service logic |
| PostgreSQL | Durable source-of-truth data | Ephemeral cache-only values |
| Redis | Cache, coordination, TTL state | Long-term source-of-truth records |
| Kubernetes | Runtime orchestration | Application business rules |

## Dependency Direction

Preferred direction:

```text
UI / Renderer
  -> API client
    -> FastAPI routers
      -> services
        -> repositories
          -> Tortoise ORM / PostgreSQL
        -> Redis clients
        -> AI orchestration
          -> LangChain / LangGraph / DeepAgents
```

Rules:

- UI code MUST call API clients, not service or repository modules.
- API routers MUST call service functions, not contain deep business logic.
- Services MAY call repositories, Redis, AI orchestration, and other services.
- Repositories MUST NOT call FastAPI routers, UI code, or agents.
- AI tools MUST call service-layer functions where permissions and validation are enforced.
- Electron renderer MUST communicate with main through preload-exposed APIs only.

## Recommended Repository Layout

```text
src/
  api/
    main.py / app.py / lifespan.py
    routers/ / dependencies/ / middleware/ / errors.py
  core/
    config.py / logging.py / security.py / constants.py
  db/
    models/ / migrations/ / repositories/ / transactions.py
  schemas/
    requests/ / responses/ / internal/
  services/
  ai/
    langchain/ / langgraph/ / deepagents/ / prompts/ / tools/ / memory/
  workers/
  tests/

apps/
  web/
    app/ / components/ / features/ / lib/ / hooks/ / styles/ / tests/
  desktop/
    src/
      main/ / preload/ / renderer/ / shared/
    tests/

infra/
  k8s/
    base/ / overlays/
  docker/ / scripts/
```

Rules:

- MUST keep AI workflow code out of FastAPI routers.
- MUST keep ORM models out of frontend or Electron renderer code.
- MUST keep desktop main/preload/renderer code separated by directory.
- MUST keep Kubernetes manifests out of application source directories.
- MUST keep reusable UI primitives separate from domain feature components.
- MUST keep generated files, build outputs, and vendored artifacts out of source modules.

## Immutability and State

- Prefer immutable data structures.
- Use `const` in TypeScript/JavaScript by default.
- Use `readonly` for immutable TypeScript properties.
- Use `as const` for literal maps where appropriate.
- Use frozen dataclasses or Pydantic frozen config for immutable Python data.
- Mutate only when performance, library API, or state-management ergonomics require it.

Rules:

- MUST NOT mutate React props or state directly.
- MUST NOT mutate LangGraph state in place.
- MUST NOT mutate shared module-level objects at request time.
- MUST NOT rely on `const` as deep immutability in JavaScript/TypeScript.
- MUST document intentional mutation in complex code paths.

## State Ownership

| State Type | Preferred Owner |
| --- | --- |
| UI interaction state | React component or custom hook |
| URL-visible state | Next.js route/search params |
| Authenticated server data | FastAPI / backend service |
| Durable business data | PostgreSQL |
| Short-lived cache | Redis |
| Agent workflow state | LangGraph checkpoint / DeepAgents backend |
| Desktop native state | Electron main process service |

Rules:

- MUST NOT store durable business state only in frontend state.
- MUST NOT store frontend UI state in PostgreSQL unless it is user preference or product data.
- MUST NOT store agent scratchpad data in public API response models.
