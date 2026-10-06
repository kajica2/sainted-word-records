# Reviewer Delegation Table (SSOT)

Single source of truth for the keyword -> reviewer mapping used by both `omb-plan`
(`.claude/skills/omb-plan/SKILL.md`) and `omb-plan-review`
(`.claude/skills/omb-plan-review/SKILL.md`). This file merges the two tables that were
previously duplicated in each skill; both skills cite this file by path instead of
inlining the table.

## Scope Note

This file holds only the keyword -> reviewer mapping shared by both skills. Per-skill
differences stay in each skill's own Team Composition Rules section, not here.
Specifically: `@plan-evaluator` runs at Step 3 always in `omb-plan`, but runs standalone
at Step 2 in `omb-plan-review` — that scheduling difference is owned by each skill, not
this file.

## Table

<reviewer_delegation>

| Domain Signal (plan keywords) | Reviewer | Review Strengths | Key Review Focus |
|------|---------|-----------|-------------|
| *(always included)* | @plan-evaluator (opus) | Quantitative rubric scoring, 44-item checklist across 9 dimensions | Location/change-shape/proof/density scoring, @agent/Skill() verification, repository evidence checks, P0-P3 classification |
| *(always included)* | @core-critique (opus) | Architecture pre-mortem, assumption verification | Design contradictions, unverified assumptions, missing risk mitigation, edge case gaps, code-vs-claim verification |
| API, endpoints, REST, middleware, FastAPI, Express | @api-design (sonnet) | API contract design, REST/GraphQL architecture | Endpoint paths/methods/status codes, request/response schemas, auth/authz, error handling, rate limiting, pagination |
| Database, models, migrations, SQLAlchemy, Alembic, queries | @db-design (sonnet) | PostgreSQL schema and ORM design | Table definitions, index strategy (B-tree/GIN/GiST), migration safety, query optimization, JSONB patterns, Redis caching |
| React, components, hooks, frontend, Tailwind, UI | @ui-design (sonnet) | Component architecture and accessibility | Component tree, hook API, composition patterns, ARIA/keyboard accessibility, responsive layout, design tokens |
| LangGraph, LangChain, agents, prompts, RAG, AI | @ai-design (sonnet) | LLM workflow and agent architecture | Framework selection (LangChain/LangGraph/Deep Agents), state schema, node/tool design, prompt templates, RAG pipeline |
| Electron, IPC, preload, BrowserWindow, desktop | @electron-design (sonnet) | Electron IPC and security boundaries | IPC channel types, preload API surface, security config (contextIsolation/sandbox), window management |
| Docker, CI/CD, K8s, Terraform, deploy, infra | @infra-design (sonnet) | Infrastructure design | Container config, CI/CD pipelines, K8s manifests, Terraform modules, deployment strategy |
| Infrastructure cost, scaling, resilience | @infra-critique (opus) | Infrastructure cost/scalability/resilience critique | Security misconfigs, over-provisioning, single points of failure, monitoring coverage, compliance |
| Auth, OWASP, secrets, security | @security-audit (opus) | OWASP Top 10 audit | Injection, broken auth, sensitive data exposure, XSS, access control, dependency vulnerabilities, security logging |
| Code quality, testing, linting, refactoring | @code-review (opus) | Code correctness/security/performance review | Logic errors, N+1 queries, naming conventions, type correctness, edge cases, regressions, duplicate function/module detection vs existing codebase |
| settings.json, CLAUDE.md, hooks, skills, agents, rules, harness | @harness-design (sonnet) | Claude Code harness config design | Agent frontmatter, skill structure, hook setup, permission design, MCP config, memory architecture |
| Any plan (gated: `[ -f openwiki/index.md ]`) | @wiki-reviewer (sonnet) | Wiki spec alignment — Topic 8 ONLY | Plan consistency with openwiki/ blueprint; mismatched concepts, undocumented terms, wiki update needs. Assigned exclusively to @wiki-reviewer; other reviewers do NOT cover this topic. |
| Any plan with code changes (gated: `omb env is-enabled OMB_USE_CODEX` AND health probe) | Codex adversarial reviewer (via Bash) | Adversarial code analysis via OpenAI Codex CLI | Failure modes, race conditions, auth bypass, data loss, rollback safety, observability gaps. Included when **enabled AND healthy**. If enabled-but-unhealthy, surface `Codex: enabled, unavailable: {redacted-reason}` in the team announcement instead of silent skip. `--codex` force-includes this reviewer (the two-step gate still applies). |

</reviewer_delegation>
