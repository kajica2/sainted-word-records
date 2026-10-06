---
name: omb-improve-plan
description: "Plan improvement guide — targeted fixes for location, evidence, change-shape, handoff, verification, and density tickets."
user-invocable: false
---

## Herdr amendment-only caller exception

When the existing plan-improver is invoked by `omb-plan-review --apply-findings-only`,
apply only its validated findings to the explicit Plan. Return the finding-disposition
table and before/after digests without running Evaluation or following this skill's
ordinary re-evaluation next-step hint. Record `evaluation not rerun after Herdr amendments`.
This exception applies only to that caller mode; normal improve-plan behavior is unchanged.

# Plan Improvement Guide

This read/write reference is loaded by `plan-improver`. It fixes EP/CP/WP tickets without
turning the plan into a verbose template. The plan remains an adaptive, code-location-first
execution spec governed by `.claude/rules/workflow/01-plan.md`.

<role>
Cluster review tickets by root cause, apply one evidence-backed fix per cluster, and prove no
regression. Preserve valid decisions and compact structure. Add executable information where it
is missing; remove boilerplate where it obscures the change map.
</role>

<constraints>
- Edit only the target plan under `.omb/plans/`.
- Use surgical edits; do not overwrite an unaffected plan or add sections merely to satisfy a ticket.
- Verify new `file:line`/`file::symbol` citations before writing them.
- Fix P0, then P1. Address P2/P3 only after blockers are resolved.
- Reference every fixed ticket ID in the improvement report, not as noise throughout the plan body.
- Preserve the plan's documentation language and all valid scope decisions.
- Emit `<omb>BLOCKED</omb>` when a P0/P1 needs unavailable repository evidence or a user decision.
</constraints>

## Workflow

1. Read the current plan, evaluation tickets, and consensus findings.
2. Cluster tickets by root cause using the table below.
3. Inspect only the repository seams required to close each cluster.
4. Apply targeted plan edits in P0 -> P1 order.
5. Run a density pass so new evidence does not duplicate tasks or background prose.
6. Re-check every previously passing item and produce a regression diff table.
7. Report applied fixes, unresolved tickets, and zero regressions.

## Root-Cause Categories

| Category | Typical IDs/signals | Targeted fix |
|----------|---------------------|--------------|
| INTENT-GAP | `intent.*` | Clarify observable outcome, governing decision/non-goal, and outcome-to-proof trace |
| EVIDENCE-GAP | `evidence.*` | Verify exact file/line/symbol, current seam/root cause, callers, and nearest tests |
| SHAPE-GAP | `shape.*` | Name create/modify/delete operations and add target signature/schema/pseudocode/boundary behavior |
| HANDOFF-GAP | `task.*` | Repair the single Execution Structure table with concrete domain slices, dependencies, and deliverables |
| DELEGATION-ERROR | `agent.*`, `skill.*` | Verify repository agent/skill names and assign one owner per domain task |
| PROOF-GAP | `test.*` | Add exact test files/cases, RED gap, commands, assertions, and phase gates |
| ORDERING-GAP | `phase.*`, `release.*` | Correct dependency order, safe parallelism, critical path, rollout/rollback |
| SOT-RISK-GAP | `docs.*`, `risk.*` | Name exact stale docs and concrete mitigation/user-verification items |
| DENSITY-FAILURE | `density.*`, `complete.*` | Remove restatement/tutorials/duplicate tables; replace placeholders with executable facts or blockers |

## Fix Strategies

### INTENT-GAP

- Prefer a one- or two-sentence outcome at the relevant change unit over a standalone requirements essay.
- State cross-cutting invariants once near the top and reference them implicitly thereafter.
- Add non-goals only where adjacent scope is genuinely plausible.
- Repair the evaluator's outcome trace by connecting the change unit to its execution row and test.

### EVIDENCE-GAP

- Read the cited module and use the smallest exact `file:line-range` or stable `file::symbol` anchor.
- Quote only the lines that establish the current seam/defect.
- For changed contracts, search producers, consumers, fixtures, monkeypatches, and docs.
- If evidence cannot be verified, write `TBD (blocked: reason)` and return BLOCKED for P0/P1.

### SHAPE-GAP

- Replace "update/refactor/add support" with explicit operations:
  `Modify path::symbol`, `Create path::symbol`, `Delete path::symbol after zero-caller proof`.
- Add a short target signature, schema, event example, or pseudocode when prose admits multiple designs.
- Define validation, errors, compatibility fallback, migration, and deletion order only when the boundary changes.
- For an impacted file near 800 lines, record current size and a local split strategy; never restore a global speculative size table.

### HANDOFF-GAP / DELEGATION-ERROR

- Maintain exactly one `# Execution Structure` table; do not create a second TODO checklist.
- Each row names its change unit plus concrete path/symbol, one domain, one valid agent, one valid skill,
  task-ID dependencies, and exact deliverables.
- Split a multi-domain row into domain-specific rows and preserve dependency order.

### PROOF-GAP

- Add exact test file and named cases with condition/input -> observable assertion.
- For a bug or changed behavior, state why the first new case is RED against current code.
- Use repository-valid focused commands plus broader lint/typecheck/build commands as relevant.
- Add manual/live verification only when tests cannot prove a runtime boundary; use a compact matrix.

### ORDERING-GAP

- Put contract/producers before dependent consumers, then regression verification.
- Group independent work in one phase and mark the real critical path.
- Add rollout/rollback for data/protocol/production changes; otherwise keep it absent or state a concise N/A.

### SOT-RISK-GAP

- List exact stale `docs/`/`openwiki/` paths and create/update action, or a one-line N/A reason.
- Add only risks tied to the proposed shape, each with an actionable mitigation.
- Escalate only high-impact unresolved assumptions to the user.

### DENSITY-FAILURE

- Delete request restatement, framework explanations, generic stack tables, empty sections, generic risks,
  repeated tasks, and speculative line budgets.
- Merge duplicated decisions into the relevant change unit.
- Never fix completeness by restoring the legacy fixed 8-section template.

## Regression Check

```markdown
| Item ID | Before | After | Delta | Evidence |
|---------|--------|-------|-------|----------|
| evidence.location | FAIL | PASS | +1 | Added verified `src/x.py:42-55` |
| density.unique | PASS | PASS | 0 | Execution task remains single-source |
```

Any PASS -> FAIL is a regression and must be repaired before DONE.

## Output Contract

```markdown
## Improvement Report

### Root Cause Diagnosis
### Fixes Applied
| Ticket | Root Cause | Fix | Change Unit / Section |
|--------|------------|-----|-----------------------|

### Regression Diff Table
| Item ID | Before | After | Delta | Evidence |
|---------|--------|-------|-------|----------|

Regressions: 0
```

<omb>DONE</omb>

```result
summary: "<root-cause clusters fixed and P0/P1 delta>"
artifacts:
  - "<plan file path>"
changed_files:
  - "<plan file path>"
concerns:
  - "<deferred P2/P3 tickets or empty list>"
blockers: []
retryable: true
next_step_hint: "Re-run @plan-evaluator to confirm 0 P0/P1 remain."
```
