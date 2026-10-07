---
description: Agent-to-rule routing map for Claude Code subagents and domain specialists
paths:
  - ".claude/agents/omb/*.md"
  - ".claude/rules/**/*.md"
---

# Agent Rule Routing

> **NOTE**: This file is superseded by [.claude/rules/INDEX.md](../INDEX.md#agent--rules-routing). Kept for path-scoped auto-load fallback.

Agents must read the rules matching the changed files and the target stack. Keep individual agent prompts short and point here for routing.

## API Agents

Applies to `api-design`, `api-implement`, and `api-verify`.

- FastAPI work: `.claude/rules/api/fastapi.md`
- FastAPI details: `.claude/rules/api/fastapi-routing.md`, `.claude/rules/api/fastapi-dependencies.md`, `.claude/rules/api/fastapi-security-errors.md`, `.claude/rules/api/fastapi-db-transactions.md`, `.claude/rules/api/fastapi-testing.md`
- ORM session or repository work from API code: `.claude/rules/db/orm.md`

## Database Agents

Applies to `db-design`, `db-implement`, and `db-verify`.

- PostgreSQL schema, migration, index, or SQLAlchemy model work: `.claude/rules/db/postgres.md`
- Redis cache, lock, queue, or pub/sub work: `.claude/rules/db/redis.md`
- Async ORM session, transaction, eager loading, and repository work: `.claude/rules/db/orm.md`

## UI Agents

Applies to `ui-design`, `ui-implement`, and `ui-verify`.

- React component, hook, state, effect, Suspense, or accessibility API work: `.claude/rules/ui/react.md`
- Tailwind styling, tokens, responsive behavior, dark mode, or focus indicators: `.claude/rules/ui/tailwind.md`
- Next.js App Router, Server Components, Server Actions, Route Handlers, metadata, or caching: `.claude/rules/ui/nextjs.md`
- Accessibility audits: `.claude/rules/ui/accessibility.md`
- UI pattern and design-system choices: `.claude/rules/design/ui-patterns.md`

## AI Agents

Applies to `ai-design`, `ai-implement`, and `ai-verify`.

- LangGraph workflows: `.claude/rules/ai/langgraph.md` (mother), then load splits as needed
- DeepAgents harnesses: `.claude/rules/ai/deepagents.md` (mother), then load splits as needed

## Electron Agents

Applies to `electron-design`, `electron-implement`, and `electron-verify`.

- Electron security, IPC, preload, BrowserWindow: `.claude/rules/electron/electron.md`

## Infra Agents

Applies to `infra-design`, `infra-implement`, and `infra-verify`.

- Docker: `.claude/rules/infra/docker.md`
- Kubernetes: `.claude/rules/infra/kubernetes.md`
- CI/CD: `.claude/rules/infra/ci-cd.md`
- Terraform: `.claude/rules/infra/terraform.md`

## Harness Agents

Applies to `harness-design`, `harness-implement`, and `harness-verify`.

- Claude Code harness reference: `.claude/rules/harness/claude-code-harness.md`
- Agent routing: `.claude/rules/harness/agent-rule-routing.md` (this file)

## Plan and Fix Agents

Applies to `plan-writer`, `plan-improver`, `plan-evaluator`.

- Plan writing rules: `.claude/rules/workflow/01-plan.md`
- Ticket schema: `.claude/rules/workflow/09-ticket-schema.md`
- Plan review: `.claude/rules/workflow/02-review-plan.md`

## Security Agents

Applies to `security-audit`, `security-implement`.

- Security checklist: `.claude/rules/security/security-checklist.md`
- Security errors: `.claude/rules/api/fastapi-security-errors.md`
- Cross-stack security: `.claude/rules/common/security-cross-stack.md`

## Code Quality Agents

Applies to `code-review`, `code-test`.

- Common: `.claude/rules/common/testing-strategy.md`, `.claude/rules/common/security-cross-stack.md`
- Domain rules: load API, DB, UI, or AI rules matching the changed files

## Cross-Cutting Review Agents

Applies to `code-review`, `security-audit`, and `security-implement`.

- Identify changed file domains first, then apply the matching API, DB, and UI rules above.
- Security-sensitive API changes must also apply `.claude/rules/api/fastapi-security-errors.md`.
- Data access changes must apply `.claude/rules/db/orm.md` and the database-specific rule.
- Frontend changes touching secrets, server/client boundaries, forms, or rendering untrusted content must apply `.claude/rules/ui/react.md`, `.claude/rules/ui/nextjs.md`, and `.claude/rules/ui/tailwind.md` when relevant.
