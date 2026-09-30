---
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
---

# Stack Selection Rules

## Rule Precedence

When rules conflict, apply them in this order:

1. Security, privacy, compliance, and data-safety requirements.
2. Explicit user or product requirements for the current task.
3. Project-specific rules in this file.
4. Stack-specific rules such as LangGraph, DeepAgents, FastAPI, Electron, or Next.js rules.
5. Language-specific rules in `.claude/rules/languages/`.
6. General best practices.

## Supported Project Stack

- **AI / Agent Layer**: LangChain (model adapters, prompts, tools, simple agents), LangGraph (durable stateful workflows), DeepAgents (long-running harnesses with filesystem, skills, memory).
- **Backend / API Layer**: FastAPI (HTTP APIs, async by default), Pydantic v2 (request/response/DTO), Tortoise ORM (async DB), PostgreSQL (primary relational DB), Redis (cache, ephemeral state, rate limiting).
- **Infrastructure**: Kubernetes for deployment.
- **Desktop**: Electron (context isolation enabled, `nodeIntegration` disabled).
- **Frontend**: Next.js App Router, React functional components + hooks, TypeScript, Tailwind CSS, Vitest + Testing Library.

## AI Stack Selection

| Requirement | Use |
| --- | --- |
| Simple model call, prompt, parser, or model abstraction | LangChain |
| Simple tool-calling agent without durable workflow needs | LangChain agent |
| Stateful workflow with branches, loops, retries, checkpoints, or interrupts | LangGraph |
| Long-horizon autonomous task with planning, filesystem, memory, skills, and subagents | DeepAgents |
| Human approval before external side effects | LangGraph or DeepAgents with interrupt/checkpointer |
| Deterministic service operation with no LLM reasoning | FastAPI service layer, not an agent |
| Batch/background non-agent job | Worker/job module |

Rules:

- MUST NOT use DeepAgents for a simple one-step model call.
- MUST NOT use LangGraph when a plain service function is enough.
- MUST NOT hide deterministic business logic inside prompts.
- MUST NOT make LLMs decide permissions, billing, authorization, or irreversible actions without server-side validation.
- MUST use structured outputs for classification, routing, extraction, validation, and tool arguments.
- MUST version important prompts and agent instructions.
- MUST keep prompts, tools, memory, graph state, and runtime configuration separate.

## Backend Stack Selection

Use **FastAPI** for: public and internal HTTP APIs, authenticated service endpoints, webhook receivers, API-facing orchestration of AI workflows.

Use **Tortoise ORM** for: normal database queries, model relationships, repository/service layer persistence, transactional application logic.

Use **raw SQL** only for: performance-critical queries, database-specific features, complex reporting queries, carefully reviewed migrations. **Raw SQL in application code requires plan-time declaration** — see `db/orm.md` "ORM Exception Protocol" and `workflow/01-plan.md` §2 raw SQL exceptions table. Without an entry there, the implement agent emits `<omb>BLOCKED</omb>` and the PreToolUse `raw_sql_guard` hook blocks the write.

Use **Redis** for: cache with TTL, rate limiting counters, short-lived locks, idempotency keys, ephemeral workflow/session state.

Use **PostgreSQL** for: source-of-truth data, relational integrity, durable workflow metadata, audit trails, user/tenant/billing records.

Rules:

- MUST NOT store source-of-truth business data only in Redis.
- MUST NOT put business rules in Next.js route handlers when the backend service owns the domain.
- MUST NOT bypass FastAPI service authorization by calling ORM models directly from AI tools.
- MUST NOT let frontend, Electron renderer, or agent tools connect directly to PostgreSQL or Redis.

## Frontend Stack Selection

### Framework Selection Criteria

- **Next.js (App Router)** — SSR/SEO required, Edge runtime, full-stack Server Actions, multi-page routing.
- **Vite + React 19+ SPA** — pure CSR, authenticated internal apps, fast dev server, static hosting.
- Both environments use the TanStack stack defined below.

### Data and State Libraries (apply to both Next.js and Vite SPA)

- **Server state**: TanStack Query v5+ (single entry point — swr/axios interceptor caching forbidden).
- **Forms**: TanStack Form v1+ + Zod (react-hook-form forbidden for new code).
- **Tables**: TanStack Table v8 (headless + shadcn conditional — shadcn ADR required before combining).
- **Virtualization**: TanStack Virtual v3 `useVirtualizer` (100+ items: required, 50+ items: recommended).
- **Lightweight global state**: React Context first → `zustand` fallback (see `.claude/rules/ui/zustand.md` and `.claude/rules/ui/tanstack.md`; `@tanstack/react-store`/redux/recoil/jotai new imports forbidden).
- **Routing**: Next.js → `app/` + `next/link`/`next/navigation`. Vite → react-router-dom v7. TanStack Router new imports forbidden in both environments until a dedicated ADR approves it for Vite.

### Styling and Testing

- **Styling**: Tailwind CSS v4 (+ shadcn/ui primitives — apply after shadcn adoption ADR).
- **Testing**: Vitest + `@testing-library/react` + msw.

### Rules

- MUST keep Client Components as small as possible.
- MUST NOT add `'use client'` at the top of broad layout files unless every child truly needs client execution.
- MUST NOT use inline styles for normal styling.
- MUST NOT duplicate backend domain logic in React components.
- MUST NOT fetch secrets or privileged backend credentials in frontend code.
- MUST use `useQuery`/`useMutation` for all new API calls — no `useEffect+fetch` patterns.
- MUST centralize query keys in `lib/query-keys.ts` factory — no inline string keys.
- MUST apply `useVirtualizer` to any list that may render 100+ items (50+ recommended).
- MUST NOT introduce swr, `@tanstack/react-store`, redux, recoil, jotai, react-hook-form, formik, or axios interceptor caching in new code.

See `.claude/rules/ui/tanstack.md` (Mother) for full TanStack enforcement rules.

## Electron Stack Selection

Use **main process** for: window lifecycle, native menus, tray integration, OS-level dialogs, secure filesystem access, auto-update orchestration.

Use **preload scripts** for: narrow, typed, validated IPC bridges.

Use **renderer process** for: UI rendering, user interaction, non-privileged client logic.

Rules:

- MUST NOT expose `ipcRenderer` wholesale to the renderer.
- MUST NOT enable Node.js integration in renderer windows.
- MUST NOT pass arbitrary shell commands, filesystem paths, URLs, or IPC channel names from renderer to main without validation.
- MUST NOT store secrets in renderer-accessible storage.
