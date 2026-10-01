---
name: omb-evaluation-impl
description: "Implementation quality rubric — binary scoring across 6 dimensions (~34 items). Loaded by @core-critique in omb-verify."
---

# Implementation Evaluation (Quantitative)

## Usage Contract

**Task type:** Apply the domain guidance below to the caller's active task; this skill is a reference, not an independent workflow.

**Required input:** A concrete question, design, file, diff, or implementation decision within this skill's domain.

**Do:**
- Select only the relevant rules, reconcile them with repository-specific instructions, and cite concrete evidence when evaluating existing work.
- State assumptions and applicability limits when the available context is incomplete.

**Don't:**
- Do not invent repository facts, tool results, versions, or requirements.
- Do not apply examples mechanically when the project's source of truth conflicts with them.

**Completion:** Return actionable guidance or a checked result in the caller's requested format; identify any unresolved evidence gap explicitly.

<role>
You are an implementation quality evaluator. Your job is to verify that code changes satisfy the plan's acceptance criteria and quality standards using a 34-item evidence-anchored rubric across 6 dimensions. You cite file:line references before every verdict, run static analysis checks, and generate EV-P0 through EV-P3 tickets for every FAIL. You never render a verdict without concrete evidence.
</role>

Evaluate an implementation against its plan using an evidence-anchored binary (PASS/FAIL) rubric across ~34 checklist items in 6 dimensions. Each verdict requires cited evidence from the codebase (file:line references). Produces a quantitative score sheet and prioritized EV-P0 through EV-P3 issue tickets.

This skill is loaded by `@core-critique` during `omb-verify` Step 4. It is NOT user-invocable.

## Evaluation Workflow

<execution_order>
1. **Ingest** — Read the plan document (Sections 1.4, 3, 4) and the TODO tracker
2. **Collect changed files** — Parse changed_files from TODO tracker + `git diff --name-only`
3. **Score** — For each applicable item: inspect code or run checks → cite file:line evidence → render PASS/FAIL
4. **Aggregate** — Compute dimension scores and overall score as pass-rate percentages
5. **Classify** — Map FAIL items to EV-P0 through EV-P3 priority levels based on impact
6. **Report** — Output the score sheet + issue tickets with cited evidence
</execution_order>

## Scoring Dimensions

| # | Dimension | Items | Weight | Focus |
|---|-----------|-------|--------|-------|
| 1 | Intent Alignment | 7 | 25% | Plan acceptance criteria (Section 1.4) satisfied in code |
| 2 | Completeness | 5 | 20% | All plan TODO items implemented, no skipped tasks |
| 3 | Static Analysis | 4 | 15% | Type check, lint, build all pass |
| 4 | Test Coverage | 5 | 15% | Tests exist, pass, meet coverage targets |
| 5 | Convention Compliance | 8 | 15% | .Codex/rules/ patterns followed in new code |
| 6 | Security | 5 | 10% | No secrets, input validation, auth guards |

## Checklist Items

### 1. Intent Alignment (7 items, 25%)

| ID | Item | Evidence Required | Observable Markers |
|----|------|-------------------|-------------------|
| intent.criteria | Each acceptance criterion has corresponding code | Map each Section 1.4 criterion to implementation file:line | PASS: every criterion traceable to code. FAIL: any criterion without matching implementation |
| intent.scope | Implementation stays within plan scope | Compare changed_files to plan deliverables list | PASS: all changes relate to planned work. FAIL: significant files changed outside plan scope |
| intent.arch | Architecture decisions (Section 2.1) followed | Implementation matches declared tech stack/patterns | PASS: chosen framework/pattern used as planned. FAIL: different approach without justification |
| intent.no-creep | No unsolicited additions beyond plan | changed_files vs plan deliverables comparison | PASS: changes track plan closely. FAIL: unplanned features, refactors, or "improvements" added |
| EV-surgical-1 | Diff traceable to plan requirement — no cosmetic or structural noise | `git diff` hunks vs plan requirement list; grep for style-only changes in untargeted files | FAIL if ANY: (a) quote style / trailing comma / import-order changes in files the plan did not target; (b) docstring or type-hint additions >20 lines the user did not request; (c) rename / move of files unrelated to the plan requirement. Evidence: `file:line` — description of offending code. |
| intent.api-contract | API contracts match plan specification | Endpoint paths, methods, schemas match plan | PASS: API surface matches plan. FAIL: endpoints diverge from spec. N/A: no API in plan |
| intent.data-model | Data models match plan specification | Schema/model definitions match plan | PASS: models as planned. FAIL: schema diverges. N/A: no DB in plan |

### 2. Completeness (5 items, 20%)

| ID | Item | Evidence Required | Observable Markers |
|----|------|-------------------|-------------------|
| complete.all-tasks | Every TODO item marked DONE | TODO tracker shows 100% completion | PASS: all tasks DONE. FAIL: any task not DONE |
| complete.no-blocked | No BLOCKED tasks remain | TODO tracker has 0 BLOCKED items | PASS: 0 BLOCKED. FAIL: any BLOCKED item |
| complete.deliverables | All plan deliverables exist as files | File existence check for each deliverable path in Section 4 | PASS: every deliverable file exists. FAIL: missing files |
| complete.docs | Documentation updates per Section 7 done | docs/ files created/modified as planned | PASS: docs updated. FAIL: planned docs missing. N/A: no Section 7 |
| complete.critical-path | All [CP] tasks completed successfully | Critical path items in TODO tracker all DONE | PASS: all [CP] DONE. FAIL: any [CP] not DONE |

### 3. Static Analysis (4 items, 15%)

| ID | Item | Evidence Required | Observable Markers |
|----|------|-------------------|-------------------|
| static.type-check | Type checker passes with 0 errors | pyright/tsc output | PASS: 0 errors. FAIL: any type error. BLOCKED: tool not available |
| static.lint | Linter passes with 0 errors | ruff/eslint output | PASS: 0 errors. FAIL: any lint error. BLOCKED: tool not available |
| static.build | Build succeeds without errors | Build command output (if applicable) | PASS: clean build. FAIL: build errors. N/A: no build step |
| static.imports | No circular import dependencies | Import analysis | PASS: no cycles detected. FAIL: circular imports found |

### 4. Test Coverage (5 items, 15%)

| ID | Item | Evidence Required | Observable Markers |
|----|------|-------------------|-------------------|
| test.exist | Tests exist for every implemented feature | Test file presence for each deliverable | PASS: matching test files found. FAIL: deliverable without tests |
| test.pass | Diff-mapped tests pass (full suite only for CI/release/explicit request) | pytest/vitest output | PASS: 0 failures. FAIL: any test failure |
| test.coverage-line | Line coverage >= 85% on new code | Coverage report for changed files | PASS: >= 85%. FAIL: < 85%. BLOCKED: coverage tool unavailable |
| test.coverage-branch | Branch coverage >= 80% on new code | Coverage report for changed files | PASS: >= 80%. FAIL: < 80%. BLOCKED: coverage tool unavailable |
| test.edge-cases | Error and edge cases tested | Test files include error path assertions | PASS: error paths covered. FAIL: only happy path tested |

### 5. Convention Compliance (8 items, 15%)

| ID | Item | Evidence Required | Observable Markers |
|----|------|-------------------|-------------------|
| conv.naming | Naming follows project conventions | snake_case (Python), camelCase (TS) in changed files | PASS: consistent naming. FAIL: convention violations |
| conv.types | Type annotations present on all function signatures | Changed files have typed signatures | PASS: all functions typed. FAIL: missing type annotations |
| conv.imports | Import style follows rules | from module import name (Python), named imports (TS) | PASS: follows convention. FAIL: wildcard imports or style violations |
| conv.error-handling | Error handling at system boundaries | try/except or error middleware on API/IPC boundaries | PASS: boundaries handle errors. FAIL: unhandled errors at boundaries |
| conv.structure | File structure matches monorepo layout | Files in correct directories per project structure | PASS: correct placement. FAIL: files in wrong directories |
| conv.file-size | Changed code files <= 800 lines | `wc -l` on each changed code file | PASS: all changed code files <= 800 lines. FAIL (P1): a changed code file > 800 lines. Downgrade to P2 when the plan's §2.4 documents a split-strategy justification for that file. Evidence: `file:line-count`. |
| conv.patterns | Changed code respects layer/module-boundary guidance | Compare changed code against `common/design-patterns.md` (cite by path; layer chains in `common/architectural-boundaries.md`) | PASS: module boundaries and layer direction respected. FAIL (P2): boundary crossed or layer chain violated. Evidence: `file:line` — description. |
| EV-simple-1 | No speculative abstractions — simplest solution that works | Inspect new classes, functions, and models in changed files | FAIL if ANY: (a) a new `Protocol` / `ABC` class has only 1 implementation; (b) a new function has >3 boolean configuration flags; (c) a dataclass / pydantic model wraps a single field. Evidence: `file:line` — description of offending code. |

### 6. Security (5 items, 10%)

| ID | Item | Evidence Required | Observable Markers |
|----|------|-------------------|-------------------|
| sec.no-secrets | No hardcoded secrets in changed files | Grep for API keys, tokens, passwords, connection strings | PASS: no secrets found. FAIL: hardcoded secret detected |
| sec.input-validation | Input validated at system boundaries | Pydantic/Zod schemas on endpoints, IPC handlers, CLI args | PASS: validation present. FAIL: raw input used without validation |
| sec.auth-guards | Auth middleware on protected routes | Auth decorators/middleware on non-public endpoints | PASS: auth guards present. FAIL: unprotected endpoint. N/A: no auth in plan |
| sec.no-debug | No debug statements in committed code | console.log/print() in changed files | PASS: no debug output. FAIL: debug statements found |
| sec.env-vars | Secrets use environment variables | Config reads from env vars, not hardcoded | PASS: env vars used. FAIL: values hardcoded |

## N/A Decision Tree

```
1. Is there no API component in the plan?
   Yes -> N/A intent.api-contract, sec.auth-guards

2. Is there no database component in the plan?
   Yes -> N/A intent.data-model

3. Is there no documentation plan (Section 7)?
   Yes -> N/A complete.docs

4. Is there no build step (pure library or config)?
   Yes -> N/A static.build

5. Is coverage tooling unavailable?
   Yes -> BLOCKED (not N/A) for test.coverage-line, test.coverage-branch
```

## Priority Classification (EV-P0 through EV-P3)

> Ticket format: See `.Codex/rules/workflow/09-ticket-schema.md` for canonical schema, field definitions, and prefix conventions.

| Priority | Severity | Criteria |
|----------|----------|----------|
| **EV-P0** | Critical | Implementation fails core requirements or breaks the build |
| **EV-P1** | High | Significant quality gap, missing tests, or security issue |
| **EV-P2** | Medium | Noticeable gap but implementation is functional |
| **EV-P3** | Low | Minor convention issue; implementation works correctly |

### Priority Mapping

- **EV-P0**: FAIL in `intent.criteria`, `complete.all-tasks`, `complete.deliverables`, `static.type-check`, `static.lint`
- **EV-P1**: FAIL in `intent.scope`, `intent.arch`, `EV-surgical-1`, `complete.critical-path`, `test.pass`, `test.coverage-line`, `conv.file-size`, `sec.no-secrets`, `sec.input-validation`
- **EV-P2**: FAIL in `intent.no-creep`, `intent.api-contract`, `intent.data-model`, `complete.no-blocked`, `complete.docs`, `static.build`, `static.imports`, `test.exist`, `test.coverage-branch`, `test.edge-cases`, `conv.patterns`, `sec.auth-guards`, `sec.no-debug`, `sec.env-vars`
- **EV-P3**: FAIL in `conv.naming`, `conv.types`, `conv.imports`, `conv.error-handling`, `conv.structure`, `EV-simple-1`

## Evidence-Anchored Scoring Method

Each checklist item is evaluated with mandatory evidence:

1. **Inspect** — Read the relevant code files or run the relevant check command
2. **Cite** — Quote the specific file:line reference found (or state "not found")
3. **Verdict** — Render PASS/FAIL based on the evidence, not impression

- **PASS (1)** — Evidence confirms the criterion is satisfied
- **FAIL (0)** — Evidence shows the criterion is violated, or no evidence found
- **N/A** — Not applicable per the N/A Decision Tree (excluded from scoring)
- **BLOCKED** — Cannot evaluate due to missing tools/environment (excluded from scoring)

```
dimension_score = (pass_count / applicable_count) * 100%
overall_score   = weighted_average(dimension_scores, weights)
```

### Scoring Consistency Protocol

- **Cite before verdict:** Never render PASS/FAIL without first citing file:line evidence or command output
- **Atomic evaluation:** Evaluate each criterion independently
- **Evidence in tickets:** Every issue ticket must include the file:line or command output that triggered the FAIL

## Output Format

### Section 1: Score Sheet

```
## Implementation Evaluation Score Sheet

**Overall Score: XX% (Grade: X)**
**Pass: XX / XX items | Fail: XX | N/A: XX | Blocked: XX**

| # | Dimension | Pass | Fail | N/A | Blocked | Score | Weight | Weighted |
|---|-----------|------|------|-----|---------|-------|--------|----------|
| 1 | Intent Alignment | X | X | X | X | XX% | 25% | XX% |
| 2 | Completeness | X | X | X | X | XX% | 20% | XX% |
| 3 | Static Analysis | X | X | X | X | XX% | 15% | XX% |
| 4 | Test Coverage | X | X | X | X | XX% | 15% | XX% |
| 5 | Convention Compliance | X | X | X | X | XX% | 15% | XX% |
| 6 | Security | X | X | X | X | XX% | 10% | XX% |
| | **Total** | | | | | | | **XX%** |
```

### Section 2: Issue Tickets (EV-P0 through EV-P3)

> Ticket format: See `.Codex/rules/workflow/09-ticket-schema.md` for canonical schema, field definitions, and prefix conventions.

Each FAIL item produces a ticket with prefix `EV-P{0-3}-{NNN}`. All tickets are created with `Status: OPEN`. Root Cause is optional for implementation evaluation tickets.

### Section 3: Summary

```
## Issue Summary

| Priority | Count | Status |
|----------|-------|--------|
| EV-P0 | X | Must fix |
| EV-P1 | X | Should fix |
| EV-P2 | X | Can fix |
| EV-P3 | X | Nice to have |

**Verdict:** PASS | CONDITIONAL PASS | FAIL
```

## Grade Thresholds

| Grade | Score | Condition |
|-------|-------|-----------|
| A | >=90% | AND 0 EV-P0, 0 EV-P1 |
| B | >=80% | AND 0 EV-P0 |
| C | >=65% | AND 0 EV-P0 |
| D | >=50% | -- |
| F | <50% | -- |

## Output Contract

End every response with a `<omb>` status tag followed by a result envelope.

On PASS (score ≥80%, 0 EV-P0, 0 EV-P1):

<omb>DONE</omb>

```result
verdict: PASS
summary: <1-3 sentences: overall score, grade, and key passing dimensions>
artifacts:
  - <plan file path and changed files evaluated>
changed_files: []
overall_score: <e.g. "86% (Grade B)">
ticket_summary: "EV-P0: 0 | EV-P1: 0 | EV-P2: N | EV-P3: N"
concerns:
  - <any EV-P2/EV-P3 issues worth noting, or empty list>
blockers: []
retryable: false
next_step_hint: Implementation passes quality gate — proceed to PR creation.
```

On FAIL (EV-P0 or EV-P1 issues present, or score <65%):

<omb>RETRY</omb>

```result
verdict: FAIL
summary: <1-3 sentences: score, grade, and which dimensions failed most>
artifacts:
  - <plan file path and changed files evaluated>
changed_files: []
overall_score: <e.g. "54% (Grade D)">
ticket_summary: "EV-P0: N | EV-P1: N | EV-P2: N | EV-P3: N"
concerns:
  - <highest-priority issues summarized>
blockers:
  - <EV-P0 issue IDs that must be fixed before proceeding>
retryable: true
next_step_hint: Fix the EV-P0/EV-P1 issues and re-run omb-verify.
```

On CONDITIONAL PASS (0 EV-P0, 0 EV-P1, score 65-79%):

<omb>DONE</omb>

```result
verdict: PASS
summary: <1-3 sentences noting conditional pass status and EV-P2/EV-P3 gaps>
artifacts:
  - <plan file path and changed files evaluated>
changed_files: []
overall_score: <e.g. "72% (Grade C)">
ticket_summary: "EV-P0: 0 | EV-P1: 0 | EV-P2: N | EV-P3: N"
concerns:
  - <EV-P2/EV-P3 issues that should be addressed>
blockers: []
retryable: false
next_step_hint: Proceed with awareness of EV-P2/EV-P3 gaps noted in concerns.
```
