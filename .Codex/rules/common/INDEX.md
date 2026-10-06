# Common Rules — Always-Inject Manifest

This file is the canonical entry point for rules that apply across all workflows.
Claude Code loads rules from here first before selecting domain-specific rules.

---

## 1. Always-load (every workflow)

These three files are injected into every agent and skill, regardless of domain.

| File | Description |
|------|-------------|
| `common/coding-principles.md` | Think-before-coding, simplicity-first, surgical changes, goal-driven execution |
| `common/output-contract.md` | Status tag (`DONE` / `RETRY` / `BLOCKED`) + result envelope format — enforced by hook |
| `common/language-settings.md` | All implementation artifacts written in English; user-facing responses follow `OMB_DOCUMENTATION_LANGUAGE` |

`common/coding-principles.md` carries a source-extension `paths:` frontmatter (`**/*.py`,
`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`). `common/output-contract.md`,
`common/language-settings.md`, and `common/file-size-rules.md` carry the same five
extensions plus `.omb/**` and `.claude/**` — a superset of `common/coding-principles.md`'s
set — so all four also auto-load on matching file activity. The workflow manifest below and
the agent routing table in
`../INDEX.md` remain the explicit-injection contract: an agent or skill lists these files in
its `rules.common[]` only when it needs them outside that `paths:` match (e.g. a skill body
with no source-file trigger of its own).

---

## 2. Workflow-conditional manifest

Load the always-load files above, then add the conditional rules for the active skill.

| Skill | Common rules (always) | Conditional rules |
|-------|----------------------|-------------------|
| `omb:plan` | coding-principles, output-contract, language-settings, file-size-rules | workflow/01-plan, workflow/09-ticket-schema, workflow/11-subagent-watchdog, design-patterns (on-demand), `.claude/skills/omb-plan/rules/architecture-reconciliation.md`, `.claude/skills/omb-plan/rules/forward-risk.md`, `.claude/skills/omb-plan/rules/reviewer-delegation.md` |
| `omb:plan-review` | coding-principles, output-contract | workflow/02-review-plan, workflow/09-ticket-schema, workflow/11-subagent-watchdog |
| `omb:fix` | coding-principles, output-contract | workflow/01-plan, workflow/01-plan-fix |
| `omb:run` | coding-principles, output-contract, language-settings | workflow/03-implement, workflow/04-verify, workflow/07-worktree-protocol, workflow/07-worktree-scripts, workflow/11-subagent-watchdog, design-patterns (on-demand) |
| `omb:verify` | coding-principles, output-contract, testing-strategy, security-cross-stack | workflow/04-verify, workflow/09-ticket-schema, workflow/11-subagent-watchdog, design-patterns (on-demand) |
| `omb:herdr`, `omb:herdr-review`, `omb:herdr-verify` | output-contract | workflow/11-subagent-watchdog |
| `omb:wiki` | language-settings, output-contract | (domain-agnostic) |
| `omb:doc` | language-settings, output-contract | workflow/05-doc, workflow/11-subagent-watchdog |
| `omb:pr` | language-settings, output-contract | workflow/06-create-pr, git/* |

Additional common files (cite by path; `common/design-patterns.md` also loads globally):

| File | Description |
|------|-------------|
| `common/design-patterns.md` | Framework-idiom precedence (HARD), pattern selection table, god-file prohibition; loads globally at session start, cited by path |
| `common/operational-memory.md` | Bounded shared memory loading and direct correction routing; globally loaded, detailed policy in `omb-memory` |
| `common/file-size-rules.md` | Function ≤50 lines, file 200-400 lines, 800+ requires justification |
| `common/api-contracts.md` | JSON field naming, error shape, pagination conventions |
| `common/naming-general.md` | Cross-language naming rules (booleans, collections, functions, IDs, time) |
| `common/naming-python.md` | Python-specific naming (snake_case, type hints, async patterns) |
| `common/naming-typescript.md` | TypeScript-specific naming (camelCase, discriminated unions, path aliases) |
| `common/stack-selection.md` | AI/backend/frontend/desktop stack selection decision table |
| `common/architectural-boundaries.md` | Layer ownership and dependency direction rules |
| `common/env-config.md` | `UPPER_SNAKE_CASE` env vars, centralized config, no secrets in code |
| `common/security-cross-stack.md` | Cross-stack security: validate inputs, treat model output as untrusted |
| `common/observability.md` | Structured logs, metrics, tracing — what to log and what to redact |
| `common/testing-strategy.md` | Backend, AI, frontend, Electron, Kubernetes testing patterns |
| `../testing/test-execution.md` | Test-execution timeout SSOT (globally loaded — listed here for discoverability) |
| `common/explanation-style.md` | User-facing explanation contract — comprehension + structure + accuracy HARD rules (globally loaded — listed here for discoverability) |
| `common/sot-authoring.md` | SoT authoring contract — durable evidence only, hard delete on change, normative statements name an enforcing mechanism (`paths:`-scoped — see §3) |

---

## 3. Domain-conditional auto-load (via `paths:` frontmatter)

Files in sub-domains (`api/`, `db/`, `ui/`, etc.) use `paths:` frontmatter to activate
automatically when Claude works on matching files. No manual injection needed.

The following common files use `paths:` scoping and self-activate on matching content:
- `common/coding-principles.md` — activates on `**/*.py`, `**/*.ts`, `**/*.tsx`, `**/*.js`,
  `**/*.jsx`
- `common/file-size-rules.md`, `common/output-contract.md`, `common/language-settings.md` —
  activate on `**/*.py`, `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `.omb/**`, `.claude/**`
  (a superset of `common/coding-principles.md`'s set). Explicit injection via an agent's
  `rules.common[]` is additive, not the only activation path.
- `common/naming-python.md` — activates on `**/*.py`
- `common/naming-typescript.md` — activates on `**/*.ts`, `**/*.tsx`
- `common/api-contracts.md` — activates on `src/api/**`, `apps/api/**`
- `common/security-cross-stack.md` — activates on security-sensitive paths
- `common/testing-strategy.md` — activates on `tests/**`, `**/test_*.py`, `**/*.test.ts`
- `common/observability.md` — activates on logging/metrics-related paths
- `common/sot-authoring.md` — activates on `docs/**/*.md`, `**/CLAUDE.md`, `README.md`, `.claude/rules/**/*.md`

Domain sub-index files define additional `paths:`-scoped activation — see `../INDEX.md`.

---

## 4. See also

- `../INDEX.md` — root mother index (sub-domain catalog + agent routing table)
- `../workflow/INDEX.md` — workflow step rules
- `../harness/INDEX.md` — harness configuration reference
