---
description: Code-location-first implementation plan structure, evidence rules, and delegation notation
paths: ["*.md", ".omb/plans/*.md"]
---
# Plan Writing Rules

An implementation plan is an executable code-change map: what behavior changes, where it changes,
the target code shape, and how to prove it works. It is not a requirements report or generic template.

`omb-run` reads plans in a new session with empty context, so a plan must be self-sufficient. Density
(quality 4) therefore means removing what does not change an execution decision, not writing tersely.

## File Naming

```text
.omb/plans/YYYY-MM-DD-kebab-case-name.md
```

- Use the creation date and a short English kebab-case slug.
- Plan prose follows `OMB_DOCUMENTATION_LANGUAGE`.
- File paths, symbols, code, commands, `@agent` names, and `Skill()` calls stay in English.

## Core Quality Contract

Every non-trivial plan MUST satisfy all four qualities:

1. **Location** — name the exact existing `file:line` or `file::symbol` that anchors each
   change. For a new file, name its exact target path and intended exported symbol.
2. **Change shape** — show what will be added, removed, or rewritten. Use a short current-code
   excerpt, target pseudocode, type signature, schema, or before/after example when prose alone
   could be implemented in more than one materially different way.
3. **Proof** — name exact test files, cases, commands, and observable pass conditions.
4. **Density** — keep only information that changes implementation or review decisions.
   Do not repeat the request, explain common technology, or add a section only to satisfy a template.

Never invent a line number, symbol, dependency, or current behavior. Use `TBD (blocked: reason)` only
when the evidence cannot be discovered from the repository; unresolved high-impact TBDs block approval.

## Required Plan Shape

Headings are adaptive, but the following information is mandatory. Combine sections when that
makes the document easier to execute.

### 1. Header and Governing Decisions

Start with:

```markdown
# Plan: {specific outcome}
```

Immediately record any decision or non-goal that prevents scope drift. Add a compact metadata
table only for decision-relevant facts such as repositories, branches, upstream interview/spec,
or rollout boundary. Status and evaluation score are review metadata and are not required in the
plan body.

If the work depends on a cross-cutting invariant, protocol, data shape, or source-of-truth rule,
state it once near the top and use it consistently. Omit this block when no such invariant exists.

### 2. Problem / Change Units

This is the core of the plan. Create one unit per independently verifiable behavior, bug, or
architectural change. Use descriptive headings; numbering and priority labels are optional.

Each unit MUST contain:

- **Outcome or symptom** — one or two sentences defining the observable behavior to change.
- **Current evidence** — exact `file:line-range` or `file::symbol`, the verified current behavior,
  and a small excerpt when it makes the defect or seam clearer.
- **Implementation shape** — exact files and symbols to create/modify/delete, the responsibility
  of each edit, important control/data flow, boundary validation, compatibility behavior, and a
  short target-code sketch when useful.
- **Tests** — exact test file(s), named cases, fixtures/mocks that must change, and the expected
  RED failure for a bug fix or behavior change.

Use this compact pattern:

````markdown
## {Problem or change name}

**Outcome:** {observable target behavior}

**Current evidence** — `path/to/file.py:120-146` (`Class.method`):
```python
# smallest excerpt that proves the current seam or defect
```

**Implementation shape:**
- Modify `path/to/file.py::Class.method` to {specific logic and boundary behavior}.
- Create `path/to/new_file.py::NewType` with {public API/responsibility}.
- Delete `path/to/old_file.py::unused_helper` after verifying zero callers.

```python
# concise target shape or pseudocode when needed
```

**Tests** — `tests/path/test_feature.py`:
1. `{test_name}` — {input} -> {observable result}; RED currently because {reason}.
2. `{test_name}` — {edge/failure case} -> {observable result}.
````

Rules:

- Prefer the smallest excerpt that establishes the change seam; do not paste whole functions.
- Distinguish verified facts from design decisions and unresolved assumptions.
- Name all call sites affected by a signature, schema, event, IPC, CLI, or file-format change.
- For runtime DB work under `models/`, `repositories/`, `dao/`, or `db/`, state the ORM choice
  and migration/index/rollback shape inside the relevant change unit. Raw SQL requires a concrete
  ORM limitation and reviewer owner. A plan touching only files under `migrations/` or `alembic/`
  does not need a runtime ORM declaration, but still names migration and rollback behavior.
- File-size limits and near-limit split strategy: `.claude/rules/common/file-size-rules.md`. Do not add a speculative line-budget table.

### 3. Execution Structure

After the change units, provide phases ordered by dependency. The task table is the machine-readable
handoff consumed by `omb-run`. Every task row must be independently verifiable; horizontal tasks that
merely sweep one layer are forbidden, and the first task is the thinnest end-to-end slice that pierces
the highest-risk integration point. A task description states a decision already made (good: "parse
Markdown with the CommonMark library"); restating the goal is the failure signal (bad: "add a Markdown
parser", "improve styling").

```markdown
# Execution Structure

## Phase 1 — {outcome}

| # | Task | Domain | Agent | Skill | Dependencies | Deliverable |
|---|------|--------|-------|-------|--------------|-------------|
| 1 [CP] | {specific edit/test slice} | UI | @ui-implement | Skill("omb-orch-ui") | — | `src/...`, `tests/...` |
```

- Every row maps to exactly one domain and one valid implementation/review agent.
- Split cross-domain work into separate rows even when described in one change unit.
- Mark critical-path rows with `[CP]`.
- Group independent tasks in the same phase and state cross-phase dependencies explicitly.
- The task description must point back to a named change unit and identify concrete files or symbols.

### 4. Verification

Provide exact, repository-valid commands and phase gates. Reference `Skill("omb-tdd")` for source
changes and use RED -> GREEN -> IMPROVE. State coverage targets only when the repository measures
coverage; default targets are 85% line / 80% branch and 95% line / 90% branch for critical paths.
Name the observable output that means each command passed, separating automated pass criteria
(exit code, assertion, coverage number) from manual pass criteria (what a human sees).

Add a live/manual verification matrix only when behavior crosses a runtime boundary that unit tests
cannot prove (for example streaming, browser UI, IPC, deployment, or external integration).

### 5. Documentation and Risks

- List exact `docs/` or `openwiki/` paths only when the change makes them stale; otherwise omit the
  documentation section or write one line: `Documentation: N/A — {reason}`.
- Keep a compact risk table with concrete mitigations. Probability/impact columns are optional unless they affect sequencing or release decisions.
- Put unresolved, high-impact assumptions in a short user-verification list. Do not pad the plan with generic risks such as "tests may fail."
- Apply `.claude/skills/omb-plan/rules/architecture-reconciliation.md` and `.claude/skills/omb-plan/rules/forward-risk.md`; untriggered, one line each suffices — or omit entirely.

## Optional Content

Include an architecture/sequence diagram (`Skill("omb-mermaid")`) for three or more interacting components, a rollout/rollback plan, a compatibility matrix, or a prior-art decision note — only when it materially improves execution, never by default.

## Content to Omit

Do not require or generate these by default, grouped by failure family:

- **Restatement/tutorial** — a standalone restatement of all user requirements, a generic technology-stack inventory, or definitions/narrative explanations of common frameworks or the planning process.
- **Duplication** — separate TODO and phase sections holding the same tasks twice, and content already governed by `CLAUDE.md`/`AGENTS.md` (pre-injected into every session; do not restate it).
- **Empty section / orphaned criteria** — architecture, documentation, ORM, or risk sections kept only to satisfy a template, and boilerplate acceptance criteria disconnected from a named change unit and test.

## Delegation and Domain Mapping

`@agent-name` must exist under `.claude/agents/omb/`; `Skill("name")` must exist under
`.claude/skills/`. Do not invent names.

| Domain | Implement Agent | Review/Verify Agent | Orchestration Skill |
|--------|-----------------|---------------------|---------------------|
| API | @api-implement | @api-verify | Skill("omb-orch-api") |
| DB | @db-implement | @db-verify | Skill("omb-orch-db") |
| UI | @ui-implement | @ui-verify | Skill("omb-orch-ui") |
| Electron | @electron-implement | @electron-verify | Skill("omb-orch-electron") |
| AI | @ai-implement | @ai-verify | Skill("omb-orch-ai") |
| Infra | @infra-implement | @infra-verify | Skill("omb-orch-infra") |
| Security | @security-implement | @security-audit | Skill("omb-orch-security") |
| Code | @code-test | @code-review | Skill("omb-orch-code") |
| Harness | @harness-implement | @harness-design | Skill("omb-orch-harness") |
| Documentation | @doc-writer | — | Skill("omb-doc") |

## Final Author Check

Before saving, verify:

- Every change unit has current repository evidence and an implementation shape.
- Every existing-code claim resolves to a real file and line/symbol.
- Every created/modified/deleted file is named.
- Every behavior change maps to a test case and an execution task.
- Execution rows use valid agents/skills and have explicit dependencies/deliverables.
- Repeated request prose, generic background, empty sections, and duplicated task lists are removed.
- No placeholder remains unless it is an explicit blocker with a reason.

<!-- Instruction-count recalibration (2026-08-08): additions 6, removals/merges 7, measured count 40 -> 33 (net -7 by the counting rule; more consolidation than the minimum -1 target). -->
