# .claude/rules/ — Root Index

## Purpose

This file is the progressive-disclosure entry point for all rules in `.claude/rules/`.
Load this index first to identify which domain sub-indexes to read.
Do not bulk-load all rule files — read only the sub-indexes and files relevant to the task.
Always-inject rules live in `common/INDEX.md`.

---

## Always-load via `common/INDEX.md`

Every workflow injects these three files unconditionally:

- `common/coding-principles.md` — Think-before-coding, simplicity-first, surgical changes
- `common/output-contract.md` — `<omb>DONE|RETRY|BLOCKED</omb>` tag + result envelope
- `common/language-settings.md` — English for all artifacts; user-facing follows `OMB_DOCUMENTATION_LANGUAGE`

These three, plus `common/file-size-rules.md`, additionally carry `paths:` frontmatter
scoped to source extensions — `common/coding-principles.md` activates on `**/*.py`,
`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`; `common/output-contract.md`,
`common/language-settings.md`, and `common/file-size-rules.md` carry the same five
extensions plus `.omb/**` and `.claude/**` — that `paths:` scoping is
domain-independent, keyed on file extension rather than a component domain like `api/` or
`ui/`, so it self-activates regardless of which domain sub-index also loads. Explicit
injection through an agent or skill's `rules.common[]` list is a separate, additive
mechanism that applies whenever the file is not already covered by its `paths:` match. See
`common/INDEX.md` for the full workflow-conditional manifest and additional common files.

`common/sot-authoring.md` — SoT authoring contract (durable evidence only, hard delete on
change, normative statements name an enforcing mechanism). It carries `paths:` frontmatter
(`docs/**/*.md`, `**/CLAUDE.md`, `README.md`, `.claude/rules/**/*.md`) and self-activates on
matching files — see `common/INDEX.md` §3.

The following files load globally at session start (no `paths:` frontmatter) and are listed
in their domain sub-indexes for discoverability:

- `testing/test-execution.md` — test-run timeout SSOT.
- `workflow/11-subagent-watchdog.md` — sub-agent spawn-bounding watchdog SSOT (`OMB_SUBAGENT_*` thresholds).
- `workflow/12-subagent-bash-hygiene.md` — sub-agent Bash command hygiene SSOT (allow-grammar, Class A/B/C agent enforcement).
- `workflow/13-pr-watch.md` — post-PR watch SSOT (`OMB_PR_WATCH_*` defaults, session-tail termination contract, trust boundary).
- `common/explanation-style.md` — user-facing explanation contract (comprehension + structure + accuracy HARD rules).
- `common/design-patterns.md` — globally loaded design-pattern selection guidance.

---

## Sub-domain Catalog

| Domain | INDEX | Triggers |
|--------|-------|----------|
| Common | `common/INDEX.md` | always |
| AI | `ai/INDEX.md` | LangGraph, DeepAgents, agents, workflows, cross-pod streaming transport |
| API | `api/INDEX.md` | FastAPI, REST, async endpoints, SSE, EventSource, Last-Event-ID |
| DB | `db/INDEX.md` | PostgreSQL, Tortoise ORM, Redis, Redis Streams, dual connection pool |
| UI | `ui/INDEX.md` | React, Next.js, Tailwind, accessibility, TanStack Query/Table/Form/Virtual, zustand, EventSource consumer |
| Electron | `electron/INDEX.md` | Electron, IPC, preload, main/renderer |
| Infra | `infra/INDEX.md` | Docker, K8s, CI/CD, Terraform, streaming workload, no-sticky |
| Harness | `harness/INDEX.md` | agents, skills, hooks, harness config |
| Workflow | `workflow/INDEX.md` | plan/implement/verify/PR workflow steps, sub-agent spawn watchdog |
| Languages | `languages/` | per-language conventions (Python, TS, shell, …) |
| Git | `git/` | branch naming, commit conventions, collaboration |
| Tools | `tools/` | LSP, Chrome, Pencil, ast-grep |
| Testing | `testing/INDEX.md` | pytest, vitest, integration test patterns, test-execution timeouts |
| Security | `security/` | security checklist |
| Design | `design/` | UI patterns, web design system |

---

## Agent → Rules Routing

Read the rules matching the agent prefix and the changed files. Always load common rules.

| Agent prefix | Common rules (always) | Domain rules |
|---|---|---|
| `api-*` (design, implement, verify, explorer) | coding-principles, output-contract, language-settings | `api/fastapi.md`, `api/fastapi-routing.md`, `api/fastapi-dependencies.md`, `api/fastapi-security-errors.md`, `api/fastapi-db-transactions.md`, `api/fastapi-testing.md` |
| `db-*` (design, implement, verify, explorer) | coding-principles, output-contract, language-settings | `db/postgres.md`, `db/redis.md`, `db/orm.md` |
| `ui-*` (design, implement, verify, explorer) | coding-principles, output-contract, language-settings | `ui/react.md`, `ui/nextjs.md`, `ui/tailwind.md`, `ui/accessibility.md`, `ui/tanstack.md` (mother — splits via paths auto-load) |
| `ai-*` (design, implement, verify, explorer) | coding-principles, output-contract, language-settings | `ai/langgraph.md`, `ai/deepagents.md` (then load splits as needed) |
| `electron-*` (design, implement, verify, explorer) | coding-principles, output-contract, language-settings | `electron/electron.md` |
| `infra-*` (design, implement, verify, explorer) | coding-principles, output-contract, language-settings | `infra/docker.md`, `infra/kubernetes.md`, `infra/ci-cd.md`, `infra/terraform.md` |
| `harness-*` (design, implement, verify) | coding-principles, output-contract | `harness/claude-code-harness.md`, `harness/agent-rule-routing.md` |
| `code-*` (review, test) | coding-principles, output-contract, testing-strategy, security-cross-stack | Domain rules matching changed files |
| `security-*` (audit, implement) | coding-principles, output-contract, security-cross-stack | `security/security-checklist.md`, `api/fastapi-security-errors.md` + domain files for changed paths |
| `plan-*` / `fix-*` (writer, improver) | coding-principles, output-contract, language-settings, file-size-rules | `workflow/01-plan.md`, `workflow/09-ticket-schema.md` |
| `*-verify` | coding-principles, output-contract, testing-strategy, security-cross-stack | `workflow/04-verify.md`, `workflow/09-ticket-schema.md` + domain files |
| `doc-*` / `wiki-*` | language-settings, output-contract | `workflow/05-doc.md` |
| `general-explorer` | coding-principles, output-contract | (task-dependent — follow trigger keywords) |
| `plan-evaluator` | coding-principles, output-contract | `workflow/09-ticket-schema.md`, `workflow/02-review-plan.md` |
| `core-critique` | coding-principles, output-contract | `workflow/02-review-plan.md` |

### Cross-cutting review agents

`code-review`, `security-audit`, `security-implement`:

1. Identify which domain files changed.
2. Load the domain rules from the matching row above.
3. Security-sensitive API changes: always add `api/fastapi-security-errors.md`.
4. Data access changes: always add `db/orm.md` and the database-specific rule.
5. Frontend changes touching server/client boundaries or rendering untrusted content: add `ui/react.md`, `ui/nextjs.md`.

> **Canonical expanded table**: this section absorbs and extends `harness/agent-rule-routing.md`.
> The routing file is preserved for its `paths:` auto-load frontmatter — see `harness/agent-rule-routing.md`.
